//! Client-side contact book — maps Ed25519 public keys to human-readable names.
//!
//! Contacts are **not** stored on-chain. They are purely client-side metadata
//! that lets users associate friendly names with Ed25519 public keys.
//!
//! The contact book can be serialized to JSON for local storage.

use std::collections::HashMap;

/// A single contact entry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Contact {
    /// Contact's Ed25519 public key (32 bytes).
    pub pubkey: [u8; 32],
    /// Human-readable name (max 64 bytes).
    pub name: String,
    /// Optional note (max 200 bytes).
    pub note: String,
}

impl Contact {
    /// Create a new contact.
    ///
    /// # Panics
    /// Panics if `name` exceeds 64 bytes or `note` exceeds 200 bytes.
    pub fn new(pubkey: [u8; 32], name: String, note: String) -> Self {
        assert!(name.len() <= 64, "name exceeds 64 bytes");
        assert!(note.len() <= 200, "note exceeds 200 bytes");
        Self { pubkey, name, note }
    }
}

/// A client-side contact book.
#[derive(Clone, Debug, Default)]
pub struct ContactBook {
    contacts: HashMap<[u8; 32], Contact>,
}

impl ContactBook {
    /// Create a new empty contact book.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add or update a contact.
    pub fn upsert(&mut self, contact: Contact) {
        self.contacts.insert(contact.pubkey, contact);
    }

    /// Remove a contact by public key.
    pub fn remove(&mut self, pubkey: &[u8; 32]) -> Option<Contact> {
        self.contacts.remove(pubkey)
    }

    /// Get a contact by public key.
    pub fn get(&self, pubkey: &[u8; 32]) -> Option<&Contact> {
        self.contacts.get(pubkey)
    }

    /// Get a mutable reference to a contact by public key.
    pub fn get_mut(&mut self, pubkey: &[u8; 32]) -> Option<&mut Contact> {
        self.contacts.get_mut(pubkey)
    }

    /// List all contacts.
    pub fn list(&self) -> Vec<&Contact> {
        self.contacts.values().collect()
    }

    /// Number of contacts in the book.
    pub fn len(&self) -> usize {
        self.contacts.len()
    }

    /// Check if the contact book is empty.
    pub fn is_empty(&self) -> bool {
        self.contacts.is_empty()
    }

    /// Serialize to JSON string.
    pub fn to_json(&self) -> String {
        let mut parts = Vec::new();
        for contact in self.contacts.values() {
            let pubkey_hex = hex::encode(contact.pubkey);
            parts.push(format!(
                r#"{{"pubkey":"{}","name":"{}","note":"{}"}}"#,
                pubkey_hex,
                escape_json(&contact.name),
                escape_json(&contact.note)
            ));
        }
        format!("[{}]", parts.join(","))
    }

    /// Deserialize from JSON string.
    pub fn from_json(json: &str) -> Result<Self, ContactError> {
        let mut book = Self::new();
        let trimmed = json.trim();
        if trimmed.is_empty() || trimmed == "[]" {
            return Ok(book);
        }
        // Simple JSON array parser — expects [{"pubkey":"...","name":"...","note":"..."}]
        let inner = trimmed
            .strip_prefix('[')
            .and_then(|s| s.strip_suffix(']'))
            .ok_or(ContactError::InvalidJson)?;
        if inner.trim().is_empty() {
            return Ok(book);
        }
        for obj in inner.split("},{") {
            let obj = obj.trim().trim_start_matches('{').trim_end_matches('}');
            let mut pubkey = None;
            let mut name = None;
            let mut note = None;
            for field in obj.split(',') {
                let field = field.trim();
                if let Some(rest) = field.strip_prefix("\"pubkey\":") {
                    let rest = rest.trim().trim_matches('"');
                    let bytes = hex::decode(rest).map_err(|_| ContactError::InvalidHex)?;
                    if bytes.len() != 32 {
                        return Err(ContactError::InvalidPubkeyLen);
                    }
                    let mut pk = [0u8; 32];
                    pk.copy_from_slice(&bytes);
                    pubkey = Some(pk);
                } else if let Some(rest) = field.strip_prefix("\"name\":") {
                    name = Some(unescape_json(rest.trim().trim_matches('"')));
                } else if let Some(rest) = field.strip_prefix("\"note\":") {
                    note = Some(unescape_json(rest.trim().trim_matches('"')));
                }
            }
            let pubkey = pubkey.ok_or(ContactError::MissingField)?;
            let name = name.ok_or(ContactError::MissingField)?;
            let note = note.ok_or(ContactError::MissingField)?;
            book.upsert(Contact::new(pubkey, name, note));
        }
        Ok(book)
    }
}

/// Errors from contact book operations.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ContactError {
    /// Invalid JSON format.
    InvalidJson,
    /// Invalid hex encoding.
    InvalidHex,
    /// Public key is not 32 bytes.
    InvalidPubkeyLen,
    /// Missing required field.
    MissingField,
}

impl core::fmt::Display for ContactError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::InvalidJson => write!(f, "invalid JSON"),
            Self::InvalidHex => write!(f, "invalid hex"),
            Self::InvalidPubkeyLen => write!(f, "invalid pubkey length"),
            Self::MissingField => write!(f, "missing field"),
        }
    }
}

impl std::error::Error for ContactError {}

/// Escape special characters for JSON string output.
fn escape_json(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Unescape JSON string (handles \\\" and \\\\).
fn unescape_json(s: &str) -> String {
    s.replace("\\\"", "\"").replace("\\\\", "\\")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contact_creation() {
        let pubkey = [0xABu8; 32];
        let contact = Contact::new(pubkey, "Alice".to_string(), "Friend".to_string());
        assert_eq!(contact.pubkey, pubkey);
        assert_eq!(contact.name, "Alice");
        assert_eq!(contact.note, "Friend");
    }

    #[test]
    fn contact_book_upsert_and_get() {
        let mut book = ContactBook::new();
        let pubkey = [0xCDu8; 32];
        let contact = Contact::new(pubkey, "Bob".to_string(), "".to_string());
        book.upsert(contact.clone());
        assert_eq!(book.len(), 1);
        assert_eq!(book.get(&pubkey), Some(&contact));
    }

    #[test]
    fn contact_book_remove() {
        let mut book = ContactBook::new();
        let pubkey = [0xEFu8; 32];
        book.upsert(Contact::new(pubkey, "Charlie".to_string(), "".to_string()));
        assert_eq!(book.len(), 1);
        let removed = book.remove(&pubkey);
        assert!(removed.is_some());
        assert_eq!(book.len(), 0);
    }

    #[test]
    fn contact_book_to_json_roundtrip() {
        let mut book = ContactBook::new();
        let pk1 = [0x01u8; 32];
        let pk2 = [0x02u8; 32];
        book.upsert(Contact::new(pk1, "Alice".to_string(), "Friend".to_string()));
        book.upsert(Contact::new(pk2, "Bob".to_string(), "".to_string()));

        let json = book.to_json();
        let restored = ContactBook::from_json(&json).unwrap();
        assert_eq!(restored.len(), 2);
        assert_eq!(restored.get(&pk1).unwrap().name, "Alice");
        assert_eq!(restored.get(&pk2).unwrap().name, "Bob");
    }

    #[test]
    fn contact_book_empty_json() {
        let book = ContactBook::from_json("[]").unwrap();
        assert!(book.is_empty());
    }

    #[test]
    fn contact_book_invalid_json() {
        assert_eq!(
            ContactBook::from_json("not json").unwrap_err(),
            ContactError::InvalidJson
        );
    }

    #[test]
    fn contact_book_invalid_hex() {
        assert_eq!(
            ContactBook::from_json(r#"[{"pubkey":"ZZZZ","name":"Alice","note":""}]"#).unwrap_err(),
            ContactError::InvalidHex
        );
    }

    #[test]
    fn contact_book_invalid_pubkey_len() {
        assert_eq!(
            ContactBook::from_json(r#"[{"pubkey":"aabb","name":"Alice","note":""}]"#).unwrap_err(),
            ContactError::InvalidPubkeyLen
        );
    }

    #[test]
    fn contact_book_missing_field() {
        // Valid 32-byte pubkey but a missing "note" field.
        let pk = "ab".repeat(32);
        assert_eq!(
            ContactBook::from_json(&format!(r#"[{{"pubkey":"{}","name":"Alice"}}]"#, pk))
                .unwrap_err(),
            ContactError::MissingField
        );
    }

    #[test]
    fn contact_name_too_long_panics() {
        let result = std::panic::catch_unwind(|| {
            Contact::new([0u8; 32], "A".repeat(65), String::new());
        });
        assert!(result.is_err());
    }

    #[test]
    fn contact_note_too_long_panics() {
        let result = std::panic::catch_unwind(|| {
            Contact::new([0u8; 32], String::new(), "N".repeat(201));
        });
        assert!(result.is_err());
    }
}
