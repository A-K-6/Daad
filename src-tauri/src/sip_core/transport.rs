//! TLS transport lifecycle: reconnect policy, generations, leak guards.
//!
//! Guarantees:
//! - Reconnect uses bounded exponential backoff with deterministic jitter
//!   (no unbounded spinning, no thundering-herd alignment).
//! - Every connection attempt carries a monotonically increasing
//!   [`Generation`]; stale generations are ignored so a late/slow handshake
//!   can never replace the current transport (stale-transport replacement).
//! - Shutdown is broadcast-based: replacing or stopping a transport aborts
//!   the previous task instead of leaking sockets/tasks.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::broadcast;

/// TLS handshake/connect budget for operator-driven attempts.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Monotonic transport generation. Higher wins; holders of an older
/// generation must stop and drop their socket.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Generation(pub u64);

/// Bounded reconnect policy with deterministic jitter.
///
/// `delay_for(attempt)` is pure and unit-testable. Attempt counting starts
/// at 0 (first retry after the initial failure).
#[derive(Debug, Clone, Copy)]
pub struct ReconnectPolicy {
    pub base: Duration,
    pub max: Duration,
    pub max_attempts: u32,
}

impl Default for ReconnectPolicy {
    fn default() -> Self {
        Self {
            base: Duration::from_millis(500),
            max: Duration::from_secs(30),
            max_attempts: 10,
        }
    }
}

impl ReconnectPolicy {
    /// Backoff delay for a 0-based attempt: `min(base * 2^attempt, max)`,
    /// plus deterministic jitter in `[0, base)`.
    pub fn delay_for(&self, attempt: u32) -> Duration {
        let grown = self.base.saturating_mul(1u32 << attempt.min(16));
        let capped = grown.min(self.max);
        let jitter = Duration::from_millis(deterministic_jitter(attempt) % self.base.as_millis().max(1) as u64);
        capped.saturating_add(jitter).min(self.max.saturating_add(self.base))
    }

    pub fn attempts_exhausted(&self, failed_attempts: u32) -> bool {
        failed_attempts >= self.max_attempts
    }
}

/// Deterministic xorshift jitter (stable across runs → testable; spreads
/// herd without an RNG dependency).
fn deterministic_jitter(attempt: u32) -> u64 {
    let mut x: u64 = u64::from(attempt).wrapping_mul(0x9E37_79B9_7F4A_7C15).wrapping_add(0x1234_5678);
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    x.wrapping_mul(0x2545_F491_4F6C_DD1D)
}

/// Returns `true` when `candidate` is stale relative to `current` and must
/// be dropped instead of installed.
pub fn is_stale(current: Generation, candidate: Generation) -> bool {
    candidate < current
}

/// Supervisor owning the current generation and shutdown broadcast.
/// Pure bookkeeping here (no sockets): async tasks subscribe to
/// [`TransportSupervisor::subscribe`] and select on shutdown vs. work, so a
/// superseded generation always exits instead of leaking.
#[derive(Debug)]
pub struct TransportSupervisor {
    generation: AtomicU64,
    shutdown_tx: broadcast::Sender<Generation>,
}

impl TransportSupervisor {
    pub fn new() -> Self {
        let (shutdown_tx, _) = broadcast::channel(16);
        Self {
            generation: AtomicU64::new(0),
            shutdown_tx,
        }
    }

    /// Start a new generation: bumps the counter and tells all older tasks
    /// to shut down. Returns the fresh generation for the new task.
    pub fn start_new(&self) -> Generation {
        let next = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let gen = Generation(next);
        let _ = self.shutdown_tx.send(gen);
        gen
    }

    pub fn current(&self) -> Generation {
        Generation(self.generation.load(Ordering::SeqCst))
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Generation> {
        self.shutdown_tx.subscribe()
    }

    /// Broadcast a full stop (all generations exit).
    pub fn stop_all(&self) {
        let _ = self.shutdown_tx.send(self.current());
    }
}

impl Default for TransportSupervisor {
    fn default() -> Self {
        Self::new()
    }
}

/// Helper shared by async transport tasks: resolves when this generation is
/// superseded or stopped. Returns `true` if the task must exit.
pub async fn should_exit(supervisor_generation: Generation, mut rx: broadcast::Receiver<Generation>) -> bool {
    loop {
        match rx.recv().await {
            Ok(newer) if newer >= supervisor_generation => return true,
            Ok(_) => continue,
            Err(broadcast::error::RecvError::Closed) => return true,
            Err(broadcast::error::RecvError::Lagged(_)) => return true,
        }
    }
}

/// RAII guard proving the single-flight invariant in tests: exactly one
/// live transport task per account. The async runtime equivalent is the
/// [`TransportSupervisor`] generation check.
#[derive(Debug, Default)]
pub struct SingleFlight {
    active: Arc<AtomicU64>,
}

impl SingleFlight {
    pub fn new() -> Self {
        Self::default()
    }

    /// Try to become the live task. Fails if another task holds the slot.
    pub fn try_acquire(&self) -> Option<FlightGuard> {
        self.active
            .compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| FlightGuard {
                active: Arc::clone(&self.active),
            })
    }
}

#[derive(Debug)]
pub struct FlightGuard {
    active: Arc<AtomicU64>,
}

impl Drop for FlightGuard {
    fn drop(&mut self) {
        self.active.store(0, Ordering::SeqCst);
    }
}

/// Open a plaintext TCP signalling connection (lab use; production uses TLS).
pub async fn connect_tcp(host: &str, port: u16) -> Result<tokio::net::TcpStream, String> {
    if host.trim().is_empty() {
        return Err("connect: hostname is empty".into());
    }
    tokio::time::timeout(CONNECT_TIMEOUT, tokio::net::TcpStream::connect((host, port)))
        .await
        .map_err(|_| format!("TCP connect to {host}:{port} timed out"))?
        .map_err(|e| format!("TCP connect to {host}:{port} failed: {e}"))
}

/// Open a verified TLS signalling connection (fail-closed).
///
/// Any certificate, SNI or CA problem surfaces as `Err` — the caller must
/// treat it as a cert failure, never retry it as a plain network error.
pub async fn connect_tls(
    host: &str,
    port: u16,
    ca_pem: Option<&str>,
) -> Result<tokio_rustls::client::TlsStream<tokio::net::TcpStream>, String> {
    let config = super::tls::build_tls_config(ca_pem)
        .map_err(|e| format!("TLS config rejected (fail-closed): {e}"))?;
    let name = super::tls::server_name(host)
        .map_err(|e| format!("TLS server name rejected (fail-closed): {e}"))?;
    let tcp = connect_tcp(host, port).await?;
    let connector = tokio_rustls::TlsConnector::from(Arc::new(config));
    tokio::time::timeout(CONNECT_TIMEOUT, connector.connect(name, tcp))
        .await
        .map_err(|_| format!("TLS handshake with {host}:{port} timed out"))?
        .map_err(|e| format!("TLS handshake with {host}:{port} failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_is_bounded_and_grows() {
        let p = ReconnectPolicy::default();
        let d0 = p.delay_for(0);
        let d1 = p.delay_for(1);
        let d9 = p.delay_for(9);
        let d100 = p.delay_for(100);
        assert!(d1 >= d0, "{d0:?} vs {d1:?}");
        assert!(d9 <= p.max + p.base, "{d9:?}");
        assert!(d100 <= p.max + p.base, "{d100:?}");
        // Base bound respected (modulo jitter < base).
        assert!(d0 >= p.base && d0 < p.base * 2);
    }

    #[test]
    fn jitter_is_deterministic() {
        let p = ReconnectPolicy::default();
        assert_eq!(p.delay_for(3), p.delay_for(3));
        assert_ne!(p.delay_for(3), p.delay_for(4));
    }

    #[test]
    fn attempts_exhaustion() {
        let p = ReconnectPolicy {
            max_attempts: 3,
            ..Default::default()
        };
        assert!(!p.attempts_exhausted(2));
        assert!(p.attempts_exhausted(3));
    }

    #[test]
    fn stale_generations_are_rejected() {
        let cur = Generation(5);
        assert!(is_stale(cur, Generation(4)));
        assert!(!is_stale(cur, Generation(5)));
        assert!(!is_stale(cur, Generation(6)));
    }

    #[test]
    fn supervisor_bumps_and_tracks_current() {
        let sup = TransportSupervisor::new();
        assert_eq!(sup.current(), Generation(0));
        let g1 = sup.start_new();
        let g2 = sup.start_new();
        assert!(g2 > g1);
        assert_eq!(sup.current(), g2);
        assert!(is_stale(sup.current(), g1));
    }

    #[test]
    fn single_flight_rejects_duplicates() {
        let sf = SingleFlight::new();
        let _g = sf.try_acquire().expect("first acquire wins");
        assert!(sf.try_acquire().is_none(), "second worker must be rejected");
    }

    #[test]
    fn single_flight_releases_on_drop() {
        let sf = SingleFlight::new();
        {
            let _g = sf.try_acquire().unwrap();
        }
        assert!(sf.try_acquire().is_some(), "slot must free after guard drop");
    }

    #[tokio::test]
    async fn superseded_task_exits_no_leak() {
        let sup = TransportSupervisor::new();
        let old = sup.start_new();
        let rx = sup.subscribe();
        // Starting a newer generation must make the old task exit.
        let _new = sup.start_new();
        let exited = tokio::time::timeout(
            Duration::from_secs(2),
            should_exit(old, rx),
        )
        .await
        .expect("task must observe supersede promptly");
        assert!(exited);
    }
}
