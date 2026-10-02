//! Tipped chat messages — KVNC payments attached to chat messages.
//!
//! A `TippedChat` bundles a [`ChatMessage`] with a KVNC tip amount. The tip
//! is carried in the same transaction as the chat payload: the transaction's
//! `tag` field holds `CHAT_TIP_TAG || encrypted_payload`, and the outputs
//! carry the tip as a native KVNC payment to the recipient.
//!
//! Wire format (encrypted, inside the transaction tag):
//! ```text
//! tip_amount: u64 LE  — tip in atoms (1 KVNC = 100_000_000 atoms)
//! message:    ChatMessage — the underlying chat message
//! ```

use crate::message::{ChatMessage, ChatPayload};
use kovanica_state::{Address, KeyPair, OutPoint, Transaction, TxOutput};

/// KVP-104 transaction tag for tipped chat messages.
pub const CHAT_TIP_TAG: &[u8] = b"CHATIP";

/// Atoms per KVNC (1 KVNC = 100_000_000 atoms).
pub const ATOM: u64 = 100_000_000;

/// A chat message with an attached KVNC tip.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TippedChat {
    /// The underlying chat message.
    pub message: ChatMessage,
    /// Tip amount in atoms (1 KVNC = 100_000_000 atoms).
    pub tip_amount: u64,
}

impl TippedChat {
    /// Create a new tipped chat message.
    pub fn new(message: ChatMessage, tip_amount: u64) -> Self {
        Self {
            message,
            tip_amount,
        }
    }

    /// Serialize to bytes: `tip_amount (u64 LE) || message.encode()`.
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(8 + 64 + self.message.plaintext.len());
        buf.extend_from_slice(&self.tip_amount.to_le_bytes());
        buf.extend_from_slice(&self.message.encode());
        buf
    }

    /// Deserialize from bytes.
    pub fn decode(bytes: &[u8]) -> Result<Self, ChatError> {
        if bytes.len() < 72 {
            return Err(ChatError::PayloadTooShort);
        }
        let tip_amount = u64::from_le_bytes(bytes[..8].try_into().unwrap());
        let msg_bytes = &bytes[8..];
        // ChatMessage encoding: sender(32) || recipient(32) || timestamp(8) || plaintext
        if msg_bytes.len() < 72 {
            return Err(ChatError::PayloadTooShort);
        }
        let mut sender = [0u8; 32];
        sender.copy_from_slice(&msg_bytes[..32]);
        let mut recipient = [0u8; 32];
        recipient.copy_from_slice(&msg_bytes[32..64]);
        let timestamp = u64::from_le_bytes(msg_bytes[64..72].try_into().unwrap());
        let plaintext = String::from_utf8(msg_bytes[72..].to_vec())
            .map_err(|_| ChatError::Crypto("invalid utf8 in plaintext".into()))?;
        let message = ChatMessage {
            sender,
            recipient,
            plaintext,
            timestamp,
        };
        Ok(Self {
            message,
            tip_amount,
        })
    }

    /// Encrypt this tipped chat message for a recipient.
    ///
    /// `recipient_pk` must be the recipient's **X25519 public key** (32 bytes),
    /// derived from their Ed25519 seed via `crypto::ed25519_seed_to_x25519` then
    /// `x25519_dalek::PublicKey::from(&secret)`.
    pub fn encrypt(&self, recipient_pk: &[u8; 32]) -> Result<ChatPayload, ChatError> {
        ChatPayload::encrypt(&self.message.sender, recipient_pk, &self.encode())
    }

    /// Recover a tipped chat from a payload produced by [`Self::encrypt`].
    ///
    /// The whole `TippedChat` — message *and* tip amount — is what gets
    /// encrypted, so the tip is authenticated by the same Poly1305 tag as the
    /// text. A client that rewrites the tip in flight cannot make the payload
    /// open; the tag check fails before [`Self::decode`] is ever reached.
    pub fn decrypt(
        payload: &ChatPayload,
        recipient_secret: &x25519_dalek::StaticSecret,
    ) -> Result<Self, ChatError> {
        let plaintext = payload.decrypt(recipient_secret)?;
        Self::decode(&plaintext)
    }
}

/// Build a signed transaction that carries a tipped chat message.
#[allow(dead_code)] // Used by node integration (Milestone 5)
///
/// The transaction:
/// - Spends `spends` (each an outpoint + keypair that owns it)
/// - Creates a tip output of `tip_amount` native KVNC to `recipient`
/// - Creates a change output back to `sender` (if any remainder)
/// - Carries the encrypted chat payload in the transaction tag:
///   `CHAT_TIP_TAG || encrypted_payload`
///
/// `total_input` must equal the sum of the values of all `spends` outputs.
/// The caller is responsible for knowing their UTXO values.
///
/// Returns the signed transaction, ready to submit.
pub fn build_tip_tx(
    sender: &Address,
    recipient: &Address,
    spends: &[(OutPoint, &KeyPair)],
    total_input: u64,
    tip_amount: u64,
    fee: u64,
    payload: &ChatPayload,
) -> Result<Transaction, ChatBuildError> {
    let total_out = tip_amount + fee;
    if total_input < total_out {
        return Err(ChatBuildError::InsufficientFunds {
            have: total_input,
            need: total_out,
        });
    }
    let change = total_input - total_out;

    let mut outputs = Vec::with_capacity(2);
    // Tip output (native KVNC to recipient)
    outputs.push(TxOutput::native(tip_amount, *recipient));
    // Change output (if any)
    if change > 0 {
        outputs.push(TxOutput::native(change, *sender));
    }

    // Transaction tag: CHAT_TIP_TAG || encrypted payload
    let mut tag = Vec::with_capacity(CHAT_TIP_TAG.len() + payload.encode().len());
    tag.extend_from_slice(CHAT_TIP_TAG);
    tag.extend_from_slice(&payload.encode());

    Ok(Transaction::signed(spends, outputs, tag))
}

/// Errors from building a tip transaction.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChatBuildError {
    /// Inputs do not cover tip + fee.
    InsufficientFunds { have: u64, need: u64 },
}

impl core::fmt::Display for ChatBuildError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::InsufficientFunds { have, need } => {
                write!(f, "insufficient funds: have {have} atoms, need {need}")
            }
        }
    }
}

impl std::error::Error for ChatBuildError {}

// Re-export ChatError from message module for convenience
pub use crate::message::ChatError;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CHAT_TAG;

    fn test_message(text: &str) -> ChatMessage {
        ChatMessage::new([1u8; 32], [2u8; 32], text.to_string(), 12345)
    }

    #[test]
    fn tipped_chat_roundtrip() {
        let msg = test_message("Hello with tip!");
        let tipped = TippedChat::new(msg.clone(), 1_000_000);
        let encoded = tipped.encode();
        let decoded = TippedChat::decode(&encoded).unwrap();
        assert_eq!(decoded.message.sender, msg.sender);
        assert_eq!(decoded.message.recipient, msg.recipient);
        assert_eq!(decoded.message.plaintext, msg.plaintext);
        assert_eq!(decoded.message.timestamp, msg.timestamp);
        assert_eq!(decoded.tip_amount, 1_000_000);
    }

    #[test]
    fn tipped_chat_encrypt_decrypt() {
        use ed25519_dalek::SigningKey;
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let recipient_secret = crate::crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);

        let msg = test_message("Secret tipped message");
        let tipped = TippedChat::new(msg, 500_000);
        let payload = tipped.encrypt(recipient_pk.as_bytes()).unwrap();

        let decoded = TippedChat::decrypt(&payload, &recipient_secret).unwrap();
        assert_eq!(decoded.message.plaintext, "Secret tipped message");
        assert_eq!(decoded.tip_amount, 500_000);
    }

    #[test]
    fn tipped_chat_will_not_recover_for_a_different_recipient() {
        use ed25519_dalek::SigningKey;
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let other = SigningKey::from_bytes(&[9u8; 32]);
        let recipient_secret = crate::crypto::ed25519_seed_to_x25519(&sk.to_bytes());
        let recipient_pk = x25519_dalek::PublicKey::from(&recipient_secret);
        let other_secret = crate::crypto::ed25519_seed_to_x25519(&other.to_bytes());

        let tipped = TippedChat::new(test_message("not yours"), 500_000);
        let payload = tipped.encrypt(recipient_pk.as_bytes()).unwrap();

        assert!(TippedChat::decrypt(&payload, &other_secret).is_err());
    }

    #[test]
    fn tip_tag_distinct_from_chat_tag() {
        assert_ne!(CHAT_TIP_TAG, CHAT_TAG);
    }
}
