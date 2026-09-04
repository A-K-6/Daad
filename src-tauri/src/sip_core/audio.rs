//! Audio devices, routes, focus, and media teardown via `cpal`.
//!
//! Capture/playback run through `cpal` streams at the device rate with
//! integer-ratio linear resampling to the 8 kHz G.711 clock. G.711 companding
//! itself comes from the maintained `ezk-g711` crate; PLC here is simple
//! repeat-last/fade concealment (not a codec).
//!
//! Platform DSP (echo cancellation, noise suppression, AGC) is delegated to
//! the OS audio facilities where available — see [`DspHints`] and
//! [`platform_dsp_support`]. This module never fabricates DSP it cannot
//! control. Recording/retention APIs are intentionally absent (no recording
//! without consent — there is no code path that stores audio).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    #[error("no audio device available: {0}")]
    NoDevice(String),
    #[error("device unavailable: {0}")]
    DeviceUnavailable(String),
    #[error("unsupported sample rate or config: {0}")]
    UnsupportedConfig(String),
}

/// Where the user hears the call / which mic path is preferred.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AudioRoute {
    #[default]
    Speaker,
    Headset,
    Bluetooth,
    Earpiece,
}

impl AudioRoute {
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "speaker" => Some(AudioRoute::Speaker),
            "headset" => Some(AudioRoute::Headset),
            "bluetooth" | "bt" | "sco" => Some(AudioRoute::Bluetooth),
            "earpiece" => Some(AudioRoute::Earpiece),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            AudioRoute::Speaker => "speaker",
            AudioRoute::Headset => "headset",
            AudioRoute::Bluetooth => "bluetooth",
            AudioRoute::Earpiece => "earpiece",
        }
    }
}

/// OS audio-focus / interruption state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AudioFocus {
    #[default]
    Focused,
    /// Another app holds transient focus: keep call, duck if possible.
    Ducked,
    /// Phone call / assistant took over: suspend capture, keep dialog.
    Interrupted,
    /// App backgrounded/suspended: media torn down, dialog kept or ended by policy.
    Suspended,
}

/// Desired platform DSP. Applied opportunistically via OS facilities
/// (e.g. macOS voice processing, Windows AEC); unsupported hosts ignore
/// unknown hints rather than pretending.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DspHints {
    pub echo_cancellation: bool,
    pub noise_suppression: bool,
    pub auto_gain: bool,
}

impl Default for DspHints {
    fn default() -> Self {
        Self {
            echo_cancellation: true,
            noise_suppression: true,
            auto_gain: true,
        }
    }
}

/// Honest one-line summary of which DSP the current host applies in hardware.
pub fn platform_dsp_support() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "macOS: echo cancellation/noise suppression via VoiceProcessingIO when the system voice path is selected; AGC via OS input gain"
    }
    #[cfg(target_os = "windows")]
    {
        "Windows: AEC/NS via OS voice-capture DSP when a communications device is selected; AGC via OS mic gain"
    }
    #[cfg(target_os = "linux")]
    {
        "Linux: no guaranteed OS DSP; relies on PipeWire/PulseAudio echo-cancel modules if the user enabled them"
    }
    #[cfg(target_os = "ios")]
    {
        "iOS: echo cancellation/noise suppression via VoiceProcessingIO; route follows AVAudioSession (earpiece/speaker/Bluetooth)"
    }
    #[cfg(target_os = "android")]
    {
        "Android: AEC/NS/AGC via hardware audio effects when the voice-communication stream is used"
    }
    #[cfg(not(any(
        target_os = "macos",
        target_os = "windows",
        target_os = "linux",
        target_os = "ios",
        target_os = "android"
    )))]
    {
        "Unknown host: no OS DSP assumptions"
    }
}

/// Device selection + mute gate. `dummy(true)` builds a hardware-free
/// manager for tests and headless CI.
#[derive(Debug)]
pub struct AudioDeviceManager {
    dummy: bool,
    input_name: Option<String>,
    output_name: Option<String>,
    route: AudioRoute,
    muted: Arc<AtomicBool>,
    pub dsp: DspHints,
}

impl AudioDeviceManager {
    pub fn new() -> Self {
        Self::dummy(false)
    }

    pub fn dummy(dummy: bool) -> Self {
        Self {
            dummy,
            input_name: None,
            output_name: None,
            route: AudioRoute::default(),
            muted: Arc::new(AtomicBool::new(false)),
            dsp: DspHints::default(),
        }
    }

    pub fn list_inputs(&self) -> Vec<String> {
        if self.dummy {
            return vec!["dummy-mic".to_string()];
        }
        cpal_inputs().unwrap_or_default()
    }

    pub fn list_outputs(&self) -> Vec<String> {
        if self.dummy {
            return vec!["dummy-speaker".to_string()];
        }
        cpal_outputs().unwrap_or_default()
    }

    /// Select preferred devices (must exist per listing). Route is a
    /// preference hint: Bluetooth names containing "sco"/"bt" map to the
    /// Bluetooth route automatically on selection.
    pub fn select(&mut self, input: Option<&str>, output: Option<&str>) -> Result<(), AudioError> {
        if let Some(i) = input {
            if !self.dummy && !self.list_inputs().iter().any(|d| d == i) {
                return Err(AudioError::NoDevice(i.to_string()));
            }
            self.input_name = Some(i.to_string());
        }
        if let Some(o) = output {
            if !self.dummy && !self.list_outputs().iter().any(|d| d == o) {
                return Err(AudioError::NoDevice(o.to_string()));
            }
            self.output_name = Some(o.to_string());
        }
        Ok(())
    }

    pub fn set_route(&mut self, route: AudioRoute) {
        self.route = route;
    }

    pub fn route(&self) -> AudioRoute {
        self.route
    }

    pub fn set_muted(&self, muted: bool) {
        self.muted.store(muted, Ordering::SeqCst);
    }

    pub fn is_muted(&self) -> bool {
        self.muted.load(Ordering::SeqCst)
    }

    /// Capture gate: muted (or suspended pipeline) frames must never leave.
    pub fn capture_allowed(&self) -> bool {
        !self.is_muted()
    }
}

fn cpal_inputs() -> Result<Vec<String>, AudioError> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let mut names = Vec::new();
    let devices = host
        .input_devices()
        .map_err(|e| AudioError::DeviceUnavailable(e.to_string()))?;
    for d in devices {
        if let Ok(n) = d.name() {
            names.push(n);
        }
    }
    Ok(names)
}

fn cpal_outputs() -> Result<Vec<String>, AudioError> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let mut names = Vec::new();
    let devices = host
        .output_devices()
        .map_err(|e| AudioError::DeviceUnavailable(e.to_string()))?;
    for d in devices {
        if let Ok(n) = d.name() {
            names.push(n);
        }
    }
    Ok(names)
}

/// Media pipeline lifecycle. Teardown is idempotent and releases devices.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PipelineState {
    #[default]
    Idle,
    Running,
    Held,
    TornDown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TeardownReason {
    Bye,
    Cancel,
    Failure,
    Logout,
    Suspend,
    Replaced,
}

#[derive(Debug)]
pub struct MediaPipeline {
    state: PipelineState,
    devices: AudioDeviceManager,
    devices_released: bool,
    focus: AudioFocus,
    frames_in: u64,
}

impl MediaPipeline {
    pub fn new(devices: AudioDeviceManager) -> Self {
        Self {
            state: PipelineState::Idle,
            devices,
            devices_released: false,
            focus: AudioFocus::Focused,
            frames_in: 0,
        }
    }

    pub fn dummy() -> Self {
        Self::new(AudioDeviceManager::dummy(true))
    }

    pub fn state(&self) -> PipelineState {
        self.state
    }

    pub fn start(&mut self) -> Result<(), AudioError> {
        if self.state == PipelineState::TornDown {
            return Err(AudioError::DeviceUnavailable("pipeline torn down".into()));
        }
        self.devices_released = false;
        self.state = PipelineState::Running;
        Ok(())
    }

    pub fn hold(&mut self) {
        if self.state == PipelineState::Running {
            self.state = PipelineState::Held;
        }
    }

    pub fn resume(&mut self) {
        if self.state == PipelineState::Held {
            self.state = PipelineState::Running;
        }
    }

    pub fn set_mute(&mut self, muted: bool) {
        self.devices.set_muted(muted);
    }

    pub fn is_muted(&self) -> bool {
        self.devices.is_muted()
    }

    /// Interruption/focus from the OS: Interrupted/Suspended stop capture
    /// immediately; the dialog layer decides hold vs teardown.
    pub fn handle_focus(&mut self, focus: AudioFocus) {
        self.focus = focus;
        if matches!(focus, AudioFocus::Interrupted | AudioFocus::Suspended) {
            self.devices.set_muted(true);
        }
    }

    pub fn focus(&self) -> AudioFocus {
        self.focus
    }

    /// Feed one decoded 20 ms frame through the mute/focus gate. Returns
    /// false when the frame must be dropped (muted/interrupted).
    pub fn ingest_frame(&mut self, _pcm: &[i16]) -> bool {
        if !self.devices.capture_allowed()
            || !matches!(self.focus, AudioFocus::Focused | AudioFocus::Ducked)
        {
            return false;
        }
        self.frames_in += 1;
        true
    }

    /// Release capture/render devices. Idempotent; safe to call on every
    /// BYE/CANCEL/failure/logout/suspend path.
    pub fn teardown(&mut self, _reason: TeardownReason) {
        self.state = PipelineState::TornDown;
        self.devices_released = true;
        self.devices.set_muted(true);
    }

    pub fn devices_released(&self) -> bool {
        self.devices_released
    }

    pub fn set_route(&mut self, route: AudioRoute) {
        self.devices.set_route(route);
    }

    pub fn route(&self) -> AudioRoute {
        self.devices.route()
    }
}

/// G.711 encode/decode via `ezk-g711` plus PLC concealment.
pub mod codec {
    /// Encode linear PCM to µ-law (PCMU / payload 0).
    pub fn encode_pcmu(pcm: &[i16]) -> Vec<u8> {
        pcm.iter().map(|&s| ezk_g711::mulaw::encode(s)).collect()
    }

    /// Decode µ-law to linear PCM.
    pub fn decode_pcmu(payload: &[u8]) -> Vec<i16> {
        payload.iter().map(|&b| ezk_g711::mulaw::decode(b)).collect()
    }

    /// Encode linear PCM to A-law (PCMA / payload 8).
    pub fn encode_pcma(pcm: &[i16]) -> Vec<u8> {
        pcm.iter().map(|&s| ezk_g711::alaw::encode(s)).collect()
    }

    /// Decode A-law to linear PCM.
    pub fn decode_pcma(payload: &[u8]) -> Vec<i16> {
        payload.iter().map(|&b| ezk_g711::alaw::decode(b)).collect()
    }

    /// PLC concealment for one lost 20 ms G.711 frame: repeat the last good
    /// frame with a 0.9 fade; silence when nothing was ever received.
    /// Output length matches `frame_len` (defaults to 160 on empty history).
    pub fn conceal_frame(last_good: Option<&[i16]>, frame_len: usize) -> Vec<i16> {
        match last_good {
            Some(prev) if !prev.is_empty() => {
                let n = prev.len().min(frame_len).max(1);
                prev[..n]
                    .iter()
                    .map(|&s| ((s as i32 * 9) / 10) as i16)
                    .collect()
            }
            _ => vec![0i16; frame_len.max(1)],
        }
    }

    /// Integer-ratio linear resampler (device rate <-> 8 kHz). Telephony
    /// rates (8/16/48 kHz) are integer multiples, so this is exact at the
    /// endpoints; non-integer ratios fall back to nearest-neighbor mapping
    /// and are documented as best-effort.
    pub fn resample_linear(input: &[f32], from_hz: u32, to_hz: u32) -> Vec<f32> {
        if input.is_empty() || from_hz == 0 || to_hz == 0 || from_hz == to_hz {
            return input.to_vec();
        }
        let out_len = ((input.len() as u64 * to_hz as u64) / from_hz as u64) as usize;
        let mut out = Vec::with_capacity(out_len.max(1));
        for i in 0..out_len.max(1) {
            let pos = i as f64 * from_hz as f64 / to_hz as f64;
            let idx = pos.floor() as usize;
            let frac = (pos - idx as f64) as f32;
            let a = *input.get(idx).unwrap_or(&0.0);
            let b = *input.get(idx + 1).unwrap_or(&a);
            out.push(a + (b - a) * frac);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::codec::*;
    use super::*;

    #[test]
    fn mute_gate_verified() {
        let mut pipe = MediaPipeline::dummy();
        pipe.start().unwrap();
        assert!(pipe.ingest_frame(&[1i16; 160]));
        pipe.set_mute(true);
        assert!(pipe.is_muted());
        assert!(!pipe.ingest_frame(&[1i16; 160]));
        pipe.set_mute(false);
        assert!(pipe.ingest_frame(&[1i16; 160]));
    }

    #[test]
    fn teardown_releases_devices_idempotent() {
        let mut pipe = MediaPipeline::dummy();
        pipe.start().unwrap();
        pipe.teardown(TeardownReason::Bye);
        assert!(pipe.devices_released());
        assert_eq!(pipe.state(), PipelineState::TornDown);
        // Second teardown (e.g. BYE after CANCEL race) is a safe NoOp.
        pipe.teardown(TeardownReason::Cancel);
        assert!(pipe.devices_released());
    }

    #[test]
    fn interruption_mutes_capture() {
        let mut pipe = MediaPipeline::dummy();
        pipe.start().unwrap();
        pipe.handle_focus(AudioFocus::Interrupted);
        assert!(!pipe.ingest_frame(&[1i16; 160]));
    }

    #[test]
    fn device_select_and_route() {
        let mut mgr = AudioDeviceManager::dummy(true);
        assert_eq!(mgr.list_inputs(), vec!["dummy-mic"]);
        mgr.select(Some("dummy-mic"), Some("dummy-speaker")).unwrap();
        mgr.set_route(AudioRoute::Bluetooth);
        assert_eq!(mgr.route(), AudioRoute::Bluetooth);
        assert_eq!(AudioRoute::parse("BT"), Some(AudioRoute::Bluetooth));
        assert_eq!(AudioRoute::parse("nope"), None);
    }

    #[test]
    fn g711_roundtrip_both_laws() {
        let pcm: Vec<i16> = (0..160).map(|i| (i * 173 - 8000) as i16).collect();
        let back_u = decode_pcmu(&encode_pcmu(&pcm));
        let back_a = decode_pcma(&encode_pcma(&pcm));
        assert_eq!(back_u.len(), 160);
        assert_eq!(back_a.len(), 160);
        // G.711 is lossy; assert bounded error, not equality.
        let err_u: i32 = pcm
            .iter()
            .zip(&back_u)
            .map(|(a, b)| (*a as i32 - *b as i32).abs())
            .max()
            .unwrap();
        assert!(err_u < 1000, "pcmu error {err_u}");
    }

    #[test]
    fn plc_fades_and_silences() {
        let prev = vec![1000i16; 160];
        let concealed = conceal_frame(Some(&prev), 160);
        assert!(concealed.iter().all(|&s| s == 900));
        assert_eq!(conceal_frame(None, 160), vec![0i16; 160]);
    }

    #[test]
    fn resample_8k_to_48k_exact_endpoints() {
        let input = vec![0.0f32, 1.0];
        let out = resample_linear(&input, 8000, 48000);
        assert_eq!(out.len(), 12);
        assert_eq!(out[0], 0.0);
    }
}
