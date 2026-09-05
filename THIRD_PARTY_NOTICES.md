# Native alpha licensing

Daad 0.6.0-alpha.2 is distributed under GPL-3.0-or-later. See LICENSE.
Earlier source remains available in Git history under its original terms.

The native engine is PJSIP 2.17 (GPL-2.0-or-later, used under GPLv3), from
https://github.com/pjsip/pjproject/tree/2.17.
Its unmodified source archive SHA-256 is
065fe06c06788d97c35f563796d59f00ce52fe9558a52d7b490a042a966facce.
The exact build configuration is scripts/build-native.ts. The adapter source
is src-tauri/native and src-tauri/src/pjsip_engine.rs.

PJSIP includes third-party media libraries with their own notices. Copies
for the built audio dependencies are in licenses/native. OpenSSL is licensed
under Apache-2.0. React, Tauri and other frontend/Rust dependencies retain
their original licenses; the dependency locks identify their versions.

A binary release must include corresponding Daad source, the pinned PJSIP
source archive, dependency source/build information and these notices.
Do not publish a binary-only release.
