//! Payment request messages (KVP-104 data transactions).
//!
//! A payment request is an on-chain message that asks a specific address to
//! pay a specified amount of KVNC. It is carried inside a KVP-104 transaction
//! with tag `b"PREQ"` and is **not** encrypted — the amount and recipient are
//! public so the payer can find and fulfill the request.
//!
//! Wire format (max 85 bytes on-chain):
//! ```text
//! recipient: [u8; 32]  — Ed25519 public key of the requester
//! amount:    u64       — requested amount in atoms
//! message:   [u8]      — optional note (max 200 bytes)
//! ```

use crate::message::MAX_PLAINTEXT_LEN;

/// KVP-104 transaction tag for payment requests.
pub const PAYMENT_REQUEST_TAG: &[u8] = b"PREQ";

/// A payment request message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PaymentRequest {
    /// Requester's Ed25519 public key (32 bytes).
    pub recipient: [u8; 32],
    /// Requested amount in atoms.
    pub amount: u64,
    /// Optional note (max 200 bytes).
    pub message: String,
}

impl PaymentRequest {
    /// Create a new payment request.
    ///
    /// # Panics
    /// Panics if `message` exceeds [`MAX_PLAINTEXT_LEN`] bytes.
    pub fn new(recipient: [u8; 32], amount: u64, message: String) -> Self {
        assert!(
            message.len() <= MAX_PLAINTEXT_LEN,
            "message exceeds {} bytes",
            MAX_PLAINTEXT_LEN
        );
        Self {
            recipient,
            amount,
            message,
        }
    }

    /// Serialize to the on-chain wire format: `recipient || amount || message`.
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(32 + 8 + self.message.len());
        buf.extend_from_slice(&self.recipient);
        buf.extend_from_slice(&self.amount.to_le_bytes());
        buf.extend_from_slice(self.message.as_bytes());
        buf
    }

    /// Deserialize from the on-chain wire format.
    pub fn decode(bytes: &[u8]) -> Result<Self, RequestError> {
        if bytes.len() < 40 {
            return Err(RequestError::PayloadTooShort);
        }
        let mut recipient = [0u8; 32];
        recipient.copy_from_slice(&bytes[..32]);
        let mut amount_bytes = [0u8; 8];
        amount_bytes.copy_from_slice(&bytes[32..40]);
        let amount = u64::from_le_bytes(amount_bytes);
        let message =
            String::from_utf8(bytes[40..].to_vec()).map_err(|_| RequestError::InvalidMessage)?;
        Ok(Self {
            recipient,
            amount,
            message,
        })
    }
}

/// Errors from payment request operations.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RequestError {
    /// On-chain payload shorter than the minimum 40 bytes (32 recipient + 8 amount).
    PayloadTooShort,
    /// Message field is not valid UTF-8.
    InvalidMessage,
}

impl core::fmt::Display for RequestError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::PayloadTooShort => write!(f, "payload too short"),
            Self::InvalidMessage => write!(f, "invalid message"),
        }
    }
}

impl std::error::Error for RequestError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payment_request_encode_decode_roundtrip() {
        let recipient = [0xABu8; 32];
        let amount = 1_000_000u64; // 0.01 KVNC
        let message = "Coffee money".to_string();

        let req = PaymentRequest::new(recipient, amount, message.clone());
        let encoded = req.encode();
        assert_eq!(encoded.len(), 32 + 8 + message.len());

        let decoded = PaymentRequest::decode(&encoded).unwrap();
        assert_eq!(decoded.recipient, recipient);
        assert_eq!(decoded.amount, amount);
        assert_eq!(decoded.message, message);
    }

    #[test]
    fn payment_request_empty_message() {
        let recipient = [0xCDu8; 32];
        let amount = 100_000u64; // 0.001 KVNC
        let message = String::new();

        let req = PaymentRequest::new(recipient, amount, message);
        let encoded = req.encode();
        assert_eq!(encoded.len(), 40);

        let decoded = PaymentRequest::decode(&encoded).unwrap();
        assert_eq!(decoded.recipient, recipient);
        assert_eq!(decoded.amount, amount);
        assert_eq!(decoded.message, "");
    }

    #[test]
    fn payment_request_too_short_rejected() {
        let short = [0u8; 39];
        assert_eq!(
            PaymentRequest::decode(&short).unwrap_err(),
            RequestError::PayloadTooShort
        );
    }

    #[test]
    fn payment_request_invalid_utf8_rejected() {
        let mut bytes = vec![0u8; 40];
        bytes.extend_from_slice(&[0xFF, 0xFE, 0xFD]);
        assert_eq!(
            PaymentRequest::decode(&bytes).unwrap_err(),
            RequestError::InvalidMessage
        );
    }

    #[test]
    fn payment_request_max_message() {
        let recipient = [0xEFu8; 32];
        let amount = 0u64;
        let message = "A".repeat(MAX_PLAINTEXT_LEN);

        let req = PaymentRequest::new(recipient, amount, message);
        let encoded = req.encode();
        assert_eq!(encoded.len(), 32 + 8 + MAX_PLAINTEXT_LEN);

        let decoded = PaymentRequest::decode(&encoded).unwrap();
        assert_eq!(decoded.message.len(), MAX_PLAINTEXT_LEN);
    }
}
