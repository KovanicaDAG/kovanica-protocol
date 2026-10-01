//! Call signaling types for WebRTC voice calls.
//!
//! These messages ride on the same KVP-104 `b"CHAT"` transactions as text
//! messages, using a distinct payload prefix to discriminate. The actual
//! voice data flows over WebRTC (UDP) — only the tiny SDP signaling goes
//! on-chain.
//!
//! Wire format (inside KVP-104 data, after the 44-byte crypto header):
//! ```text
//! magic:   [u8; 4]    — b"CALL"
//! msg_type: u8        — 0x01 = invite, 0x02 = answer, 0x03 = hangup
//! sdp:     [u8]       — SDP offer/answer (invite/answer) or empty (hangup)
//! ```

use crate::message::ChatPayload;

/// Magic bytes prefix for call signaling payloads.
pub const CALL_MAGIC: &[u8; 4] = b"CALL";

/// Call signaling message types.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CallSignal {
    /// Initiate a call (contains SDP offer).
    Invite,
    /// Accept a call (contains SDP answer).
    Answer,
    /// End a call.
    Hangup,
}

impl CallSignal {
    /// The on-chain message type byte.
    pub fn as_u8(self) -> u8 {
        match self {
            Self::Invite => 0x01,
            Self::Answer => 0x02,
            Self::Hangup => 0x03,
        }
    }

    /// Parse a message type byte.
    pub fn from_u8(b: u8) -> Option<Self> {
        match b {
            0x01 => Some(Self::Invite),
            0x02 => Some(Self::Answer),
            0x03 => Some(Self::Hangup),
            _ => None,
        }
    }
}

/// A call signaling message (before encryption).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CallMessage {
    /// Sender's Ed25519 public key.
    pub sender: [u8; 32],
    /// Recipient's Ed25519 public key.
    pub recipient: [u8; 32],
    /// Signal type.
    pub signal: CallSignal,
    /// SDP payload (offer/answer) or empty for hangup.
    pub sdp: Vec<u8>,
    /// Unix timestamp (informational).
    pub timestamp: u64,
}

impl CallMessage {
    /// Maximum SDP size (2 KB — generous for ICE candidates).
    pub const MAX_SDP_LEN: usize = 2048;

    /// Create a new call message.
    ///
    /// # Panics
    /// Panics if `sdp` exceeds [`Self::MAX_SDP_LEN`].
    pub fn new(
        sender: [u8; 32],
        recipient: [u8; 32],
        signal: CallSignal,
        sdp: Vec<u8>,
        timestamp: u64,
    ) -> Self {
        assert!(sdp.len() <= Self::MAX_SDP_LEN, "SDP too large");
        Self {
            sender,
            recipient,
            signal,
            sdp,
            timestamp,
        }
    }

    /// Encode to the on-chain call payload format: `CALL || type || sdp`.
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(5 + self.sdp.len());
        buf.extend_from_slice(CALL_MAGIC);
        buf.push(self.signal.as_u8());
        buf.extend_from_slice(&self.sdp);
        buf
    }

    /// Decode from the on-chain call payload format.
    pub fn decode(bytes: &[u8]) -> Result<Self, CallError> {
        if bytes.len() < 5 {
            return Err(CallError::PayloadTooShort);
        }
        if &bytes[..4] != CALL_MAGIC {
            return Err(CallError::InvalidMagic);
        }
        let signal = CallSignal::from_u8(bytes[4]).ok_or(CallError::InvalidSignalType)?;
        let sdp = bytes[5..].to_vec();
        if sdp.len() > Self::MAX_SDP_LEN {
            return Err(CallError::SdpTooLarge);
        }
        // Sender/recipient are not in the payload — they come from the tx metadata
        Ok(Self {
            sender: [0u8; 32],
            recipient: [0u8; 32],
            signal,
            sdp,
            timestamp: 0,
        })
    }

    /// Wrap this call message in a `ChatPayload` for on-chain submission.
    pub fn to_payload(
        &self,
        sender_pk: &[u8; 32],
        recipient_pk: &[u8; 32],
    ) -> Result<ChatPayload, crate::message::ChatError> {
        let encoded = self.encode();
        ChatPayload::encrypt(sender_pk, recipient_pk, &encoded)
    }
}

/// Errors from call signaling.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CallError {
    /// Payload shorter than 5 bytes (magic + type).
    PayloadTooShort,
    /// Magic bytes don't match `b"CALL"`.
    InvalidMagic,
    /// Unknown signal type byte.
    InvalidSignalType,
    /// SDP exceeds [`CallMessage::MAX_SDP_LEN`].
    SdpTooLarge,
}

impl core::fmt::Display for CallError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::PayloadTooShort => write!(f, "payload too short"),
            Self::InvalidMagic => write!(f, "invalid magic bytes"),
            Self::InvalidSignalType => write!(f, "invalid signal type"),
            Self::SdpTooLarge => write!(f, "SDP too large"),
        }
    }
}

impl std::error::Error for CallError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_decode_roundtrip() {
        let msg = CallMessage::new(
            [1u8; 32],
            [2u8; 32],
            CallSignal::Invite,
            b"v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\n".to_vec(),
            1234567890,
        );
        let encoded = msg.encode();
        assert_eq!(&encoded[..4], b"CALL");
        assert_eq!(encoded[4], 0x01);

        let decoded = CallMessage::decode(&encoded).unwrap();
        assert_eq!(decoded.signal, CallSignal::Invite);
        assert_eq!(decoded.sdp, msg.sdp);
    }

    #[test]
    fn hangup_has_empty_sdp() {
        let msg = CallMessage::new([1u8; 32], [2u8; 32], CallSignal::Hangup, vec![], 0);
        let encoded = msg.encode();
        assert_eq!(encoded.len(), 5);
        let decoded = CallMessage::decode(&encoded).unwrap();
        assert_eq!(decoded.signal, CallSignal::Hangup);
        assert!(decoded.sdp.is_empty());
    }

    #[test]
    fn invalid_magic_rejected() {
        let bytes = b"CHAT\x01rest";
        assert_eq!(
            CallMessage::decode(bytes).unwrap_err(),
            CallError::InvalidMagic
        );
    }

    #[test]
    fn invalid_signal_type_rejected() {
        let bytes = b"CALL\xFFrest";
        assert_eq!(
            CallMessage::decode(bytes).unwrap_err(),
            CallError::InvalidSignalType
        );
    }

    #[test]
    fn payload_too_short_rejected() {
        assert_eq!(
            CallMessage::decode(b"CA").unwrap_err(),
            CallError::PayloadTooShort
        );
    }

    #[test]
    fn signal_type_roundtrip() {
        assert_eq!(CallSignal::from_u8(0x01), Some(CallSignal::Invite));
        assert_eq!(CallSignal::from_u8(0x02), Some(CallSignal::Answer));
        assert_eq!(CallSignal::from_u8(0x03), Some(CallSignal::Hangup));
        assert_eq!(CallSignal::from_u8(0x00), None);
        assert_eq!(CallSignal::from_u8(0xFF), None);
    }
}
