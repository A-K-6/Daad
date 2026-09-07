# Mobile OS integration

Requests microphone permission before native registration and opens HTTP(S) links in the system browser. SIP, RTP, encryption and audio devices remain in PJSIP. Helpers are called only from Rust; there are no frontend plugin commands. Android credentials use Android Keystore through android-native-keyring-store; iOS uses Keychain.
