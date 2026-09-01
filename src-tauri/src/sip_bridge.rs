use std::net::SocketAddr;
use std::sync::Arc;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::sync::{broadcast, Mutex};
use tokio_rustls::rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use tokio_rustls::rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use tokio_rustls::rustls::{ClientConfig, DigitallySignedStruct, Error as RustlsError, RootCertStore, SignatureScheme};
use tokio_rustls::TlsConnector;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, Serialize, Deserialize)]
pub struct BridgeInfo {
    pub local_ws_url: String,
    pub transport: String,
    pub remote_target: String,
}

#[derive(Clone, Debug)]
struct NoCertVerifier;

impl ServerCertVerifier for NoCertVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, RustlsError> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::ED25519,
        ]
    }
}

pub struct SipBridgeManager {
    shutdown_tx: Arc<Mutex<Option<broadcast::Sender<()>>>>,
}

impl SipBridgeManager {
    pub fn new() -> Self {
        Self {
            shutdown_tx: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn stop(&self) {
        let mut lock = self.shutdown_tx.lock().await;
        if let Some(tx) = lock.take() {
            let _ = tx.send(());
        }
    }

    pub async fn start(
        &self,
        remote_host: String,
        remote_port: u16,
        transport: String,
        allow_insecure: bool,
    ) -> Result<BridgeInfo, String> {
        self.stop().await;

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind local bridge listener: {}", e))?;

        let local_addr = listener
            .local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?;

        let (shutdown_tx, _) = broadcast::channel::<()>(1);
        {
            let mut lock = self.shutdown_tx.lock().await;
            *lock = Some(shutdown_tx.clone());
        }

        let local_ws_url = format!("ws://127.0.0.1:{}/sip", local_addr.port());
        let remote_target = format!("{}:{}", remote_host, remote_port);
        let trans = transport.to_lowercase();

        let host_clone = remote_host.clone();
        let trans_clone = trans.clone();
        let mut shutdown_rx = shutdown_tx.subscribe();

        tokio::spawn(async move {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    log::info!("SIP bridge shutting down listener");
                }
                res = Self::run_listener(listener, host_clone, remote_port, trans_clone, allow_insecure, shutdown_tx) => {
                    if let Err(e) = res {
                        log::error!("SIP bridge listener error: {}", e);
                    }
                }
            }
        });

        Ok(BridgeInfo {
            local_ws_url,
            transport: trans,
            remote_target,
        })
    }

    async fn run_listener(
        listener: TcpListener,
        remote_host: String,
        remote_port: u16,
        transport: String,
        allow_insecure: bool,
        shutdown_tx: broadcast::Sender<()>,
    ) -> Result<(), String> {
        while let Ok((stream, _)) = listener.accept().await {
            let mut shutdown_rx = shutdown_tx.subscribe();
            let host = remote_host.clone();
            let trans = transport.clone();

            tokio::spawn(async move {
                tokio::select! {
                    _ = shutdown_rx.recv() => {}
                    _ = Self::handle_ws_client(stream, host, remote_port, trans, allow_insecure) => {}
                }
            });
        }
        Ok(())
    }

    async fn handle_ws_client(
        stream: TcpStream,
        remote_host: String,
        remote_port: u16,
        transport: String,
        allow_insecure: bool,
    ) {
        let ws_stream = match accept_async(stream).await {
            Ok(ws) => ws,
            Err(e) => {
                log::error!("WebSocket handshake failed: {}", e);
                return;
            }
        };

        log::info!("Frontend connected to SIP bridge (Transport: {}, Target: {}:{})", transport, remote_host, remote_port);

        match transport.as_str() {
            "tls" => {
                Self::proxy_stream_tls(ws_stream, &remote_host, remote_port, allow_insecure).await;
            }
            "tcp" => {
                Self::proxy_stream_tcp(ws_stream, &remote_host, remote_port).await;
            }
            "udp" => {
                Self::proxy_stream_udp(ws_stream, &remote_host, remote_port).await;
            }
            _ => {
                log::error!("Unknown SIP transport: {}", transport);
            }
        }
    }

    async fn proxy_stream_tcp<S>(ws_stream: S, remote_host: &str, remote_port: u16)
    where
        S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
            + SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error>
            + Send
            + 'static,
    {
        let remote_addr = format!("{}:{}", remote_host, remote_port);
        let tcp = match TcpStream::connect(&remote_addr).await {
            Ok(s) => s,
            Err(e) => {
                log::error!("Failed to connect to remote SIP TCP server {}: {}", remote_addr, e);
                return;
            }
        };

        let (tcp_read, tcp_write) = tokio::io::split(tcp);
        Self::bidirectional_forward(ws_stream, tcp_read, tcp_write).await;
    }

    async fn proxy_stream_tls<S>(ws_stream: S, remote_host: &str, remote_port: u16, allow_insecure: bool)
    where
        S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
            + SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error>
            + Send
            + 'static,
    {
        let remote_addr = format!("{}:{}", remote_host, remote_port);
        let tcp = match TcpStream::connect(&remote_addr).await {
            Ok(s) => s,
            Err(e) => {
                log::error!("Failed to connect to remote SIP TLS host {}: {}", remote_addr, e);
                return;
            }
        };

        let config = if allow_insecure {
            ClientConfig::builder()
                .dangerous()
                .with_custom_certificate_verifier(Arc::new(NoCertVerifier))
                .with_no_client_auth()
        } else {
            let mut root_store = RootCertStore::empty();
            root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            ClientConfig::builder()
                .with_root_certificates(root_store)
                .with_no_client_auth()
        };

        let connector = TlsConnector::from(Arc::new(config));
        let server_name = match ServerName::try_from(remote_host.to_string()) {
            Ok(name) => name,
            Err(_) => ServerName::try_from("asterisk.local").unwrap(),
        };

        let tls_stream = match connector.connect(server_name, tcp).await {
            Ok(s) => s,
            Err(e) => {
                log::error!("TLS handshake with {}:{} failed: {}", remote_host, remote_port, e);
                return;
            }
        };

        let (tls_read, tls_write) = tokio::io::split(tls_stream);
        Self::bidirectional_forward(ws_stream, tls_read, tls_write).await;
    }

    async fn proxy_stream_udp<S>(ws_stream: S, remote_host: &str, remote_port: u16)
    where
        S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
            + SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error>
            + Send
            + 'static,
    {
        let remote_addr: SocketAddr = match format!("{}:{}", remote_host, remote_port).parse() {
            Ok(a) => a,
            Err(e) => {
                log::error!("Invalid UDP socket address {}:{}: {}", remote_host, remote_port, e);
                return;
            }
        };

        let socket = match UdpSocket::bind("0.0.0.0:0").await {
            Ok(s) => Arc::new(s),
            Err(e) => {
                log::error!("Failed to bind local UDP socket: {}", e);
                return;
            }
        };

        if let Err(e) = socket.connect(remote_addr).await {
            log::error!("Failed to connect UDP socket to {}: {}", remote_addr, e);
            return;
        }

        let sock_recv = socket.clone();
        let (mut ws_sink, mut ws_stream_reader) = ws_stream.split();

        // Remote UDP -> WebSocket
        let mut udp_to_ws = tokio::spawn(async move {
            let mut buf = [0u8; 65535];
            loop {
                match sock_recv.recv(&mut buf).await {
                    Ok(n) if n > 0 => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        if ws_sink.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    _ => break,
                }
            }
        });

        // WebSocket -> Remote UDP
        let sock_send = socket.clone();
        let mut ws_to_udp = tokio::spawn(async move {
            while let Some(Ok(msg)) = ws_stream_reader.next().await {
                match msg {
                    Message::Text(text) => {
                        let _ = sock_send.send(text.as_bytes()).await;
                    }
                    Message::Binary(bin) => {
                        let _ = sock_send.send(&bin).await;
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
        });

        tokio::select! {
            _ = &mut udp_to_ws => {}
            _ = &mut ws_to_udp => {}
        }
    }

    async fn bidirectional_forward<S, R, W>(ws_stream: S, mut remote_read: R, mut remote_write: W)
    where
        S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
            + SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error>
            + Send
            + 'static,
        R: AsyncRead + Unpin + Send + 'static,
        W: AsyncWrite + Unpin + Send + 'static,
    {
        let (mut ws_sink, mut ws_stream_reader) = ws_stream.split();

        // Stream from Remote PBX -> WebSocket Frontend
        let mut remote_to_ws = tokio::spawn(async move {
            let mut buf = [0u8; 8192];
            loop {
                match remote_read.read(&mut buf).await {
                    Ok(n) if n > 0 => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        if ws_sink.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    _ => break,
                }
            }
        });

        // Stream from WebSocket Frontend -> Remote PBX
        let mut ws_to_remote = tokio::spawn(async move {
            while let Some(Ok(msg)) = ws_stream_reader.next().await {
                match msg {
                    Message::Text(text) => {
                        if remote_write.write_all(text.as_bytes()).await.is_err() {
                            break;
                        }
                    }
                    Message::Binary(bin) => {
                        if remote_write.write_all(&bin).await.is_err() {
                            break;
                        }
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
        });

        tokio::select! {
            _ = &mut remote_to_ws => {}
            _ = &mut ws_to_remote => {}
        }
    }
}
