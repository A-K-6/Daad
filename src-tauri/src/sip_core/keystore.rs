//! OS keychain credential store.
//!
//! Security contract:
//! - Passwords live in the platform keychain (macOS Keychain, Windows
//!   Credential Manager, Linux Secret Service / credential store) via the
//!   maintained `keyring` crate — never in `localStorage`, logs or debug
//!   output.
//! - This module NEVER logs secrets. Error paths carry only the account id
//!   and the platform error text (which never includes the secret itself).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Keychain-backed credential store contract.
pub trait CredentialStore: Send + Sync {
    fn store_password(&self, account_id: &str, password: &str) -> Result<(), String>;
    fn load_password(&self, account_id: &str) -> Result<Option<String>, String>;
    fn delete_password(&self, account_id: &str) -> Result<(), String>;
}

/// In-memory store for unit tests and non-interactive environments.
#[derive(Debug, Default, Clone)]
pub struct InMemoryStore {
    inner: Arc<Mutex<HashMap<String, String>>>,
}

impl InMemoryStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl CredentialStore for InMemoryStore {
    fn store_password(&self, account_id: &str, password: &str) -> Result<(), String> {
        require_account_id(account_id)?;
        self.inner
            .lock()
            .map_err(|e| format!("credential store poisoned for '{account_id}': {e}"))?
            .insert(account_id.to_string(), password.to_string());
        Ok(())
    }

    fn load_password(&self, account_id: &str) -> Result<Option<String>, String> {
        require_account_id(account_id)?;
        Ok(self
            .inner
            .lock()
            .map_err(|e| format!("credential store poisoned for '{account_id}': {e}"))?
            .get(account_id)
            .cloned())
    }

    fn delete_password(&self, account_id: &str) -> Result<(), String> {
        require_account_id(account_id)?;
        self.inner
            .lock()
            .map_err(|e| format!("credential store poisoned for '{account_id}': {e}"))?
            .remove(account_id);
        Ok(())
    }
}

/// OS keychain store (macOS Keychain / Windows Credential Manager / Linux
/// Secret Service). Service namespace isolates Daad entries.
#[derive(Debug, Clone)]
pub struct KeyringStore {
    service: String,
}

impl KeyringStore {
    pub fn new() -> Self {
        Self {
            service: "daad-softphone".to_string(),
        }
    }

    pub fn with_service(service: &str) -> Self {
        Self {
            service: service.to_string(),
        }
    }

    fn entry(&self, account_id: &str) -> Result<keyring::Entry, String> {
        require_account_id(account_id)?;
        keyring::Entry::new(&self.service, account_id)
            .map_err(|e| format!("keychain entry unavailable for '{account_id}': {e}"))
    }
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self::new()
    }
}

impl CredentialStore for KeyringStore {
    fn store_password(&self, account_id: &str, password: &str) -> Result<(), String> {
        // Never log `password` here — only the account id on failure.
        self.entry(account_id)?
            .set_password(password)
            .map_err(|e| format!("keychain store failed for '{account_id}': {e}"))
    }

    fn load_password(&self, account_id: &str) -> Result<Option<String>, String> {
        let entry = self.entry(account_id)?;
        match entry.get_password() {
            Ok(pw) => Ok(Some(pw)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("keychain load failed for '{account_id}': {e}")),
        }
    }

    fn delete_password(&self, account_id: &str) -> Result<(), String> {
        let entry = self.entry(account_id)?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("keychain delete failed for '{account_id}': {e}")),
        }
    }
}

fn require_account_id(account_id: &str) -> Result<(), String> {
    if account_id.trim().is_empty() {
        return Err("account_id must not be empty".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_store_load_delete() {
        let store = InMemoryStore::new();
        assert_eq!(store.load_password("acc-1").unwrap(), None);
        store.store_password("acc-1", "s3cret").unwrap();
        assert_eq!(store.load_password("acc-1").unwrap().as_deref(), Some("s3cret"));
        store.delete_password("acc-1").unwrap();
        assert_eq!(store.load_password("acc-1").unwrap(), None);
    }

    #[test]
    fn empty_account_id_rejected_without_touching_store() {
        let store = InMemoryStore::new();
        assert!(store.store_password("", "x").is_err());
        assert!(store.load_password("  ").is_err());
        assert!(store.delete_password("").is_err());
    }

    #[test]
    fn errors_never_echo_secrets() {
        let store = InMemoryStore::new();
        let secret = "super-secret-pw-123";
        let err = store.store_password("", secret).unwrap_err();
        assert!(!err.contains(secret), "error must not echo the secret");
    }

    #[test]
    fn accounts_are_isolated() {
        let store = InMemoryStore::new();
        store.store_password("a", "pw-a").unwrap();
        store.store_password("b", "pw-b").unwrap();
        assert_eq!(store.load_password("a").unwrap().as_deref(), Some("pw-a"));
        store.delete_password("a").unwrap();
        assert_eq!(store.load_password("b").unwrap().as_deref(), Some("pw-b"));
    }

    // Keyring store hits the real OS keychain; run only when explicitly
    // opted in so CI / headless environments stay green.
    #[test]
    #[ignore]
    fn keyring_roundtrip_opt_in() {
        let store = KeyringStore::with_service("daad-softphone-test");
        let id = "phase1-smoke";
        store.store_password(id, "pw").unwrap();
        assert_eq!(store.load_password(id).unwrap().as_deref(), Some("pw"));
        store.delete_password(id).unwrap();
        assert_eq!(store.load_password(id).unwrap(), None);
    }
}
