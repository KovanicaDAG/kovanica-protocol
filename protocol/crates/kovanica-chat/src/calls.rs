//! Voice/video call signaling over KVP-104 data transactions.
//!
//! Call signaling messages are ephemeral — they are broadcast to the network
//! and not stored long-term. They use the tag `b"CALL"` and are **not**
//! encrypted (the signaling data is not sensitive; the actual voice/video
//! media is encrypted end-to-end separately).
//!
//! Wire format:
//! ```text
//! call_id:  [u8; 16]  — unique call identifier
//! signal:   u8        — signal type (0=offer, 1=answer, 2=ice, 3=hangup)
//! data:     [u8]      — signal-specific payload (SDP, ICE candidate, etc.)
//! ```

use crate::message::MAX_PLAINTEXT_LEN;

/// KVP-104 transaction tag for call signaling.
pub const CALL_TAG: &[u8] = b"CALL";

/// Types of call signaling messages.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SignalType {
    /// Call offer (SDP offer).
    Offer = 0,
    /// Call answer (SDP answer).
    Answer = 1,
    /// ICE candidate.
    IceCandidate = 2,
    /// Hang up.
    Hangup = 3,
}

impl SignalType {
    /// Convert a u8 to a SignalType.
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Offer),
            1 => Some(Self::Answer),
            2 => Some(Self::IceCandidate),
            3 => Some(Self::Hangup),
            _ => None,
        }
    }
}

/// A call signaling message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CallSignal {
    /// Unique call identifier (16 bytes).
    pub call_id: [u8; 16],
    /// Signal type.
    pub signal_type: SignalType,
    /// Signal-specific payload (SDP, ICE candidate, etc.).
    pub data: Vec<u8>,
}

impl CallSignal {
    /// Create a new call signal.
    ///
    /// # Panics
    /// Panics if `data` exceeds [`MAX_PLAINTEXT_LEN`] bytes.
    pub fn new(call_id: [u8; 16], signal_type: SignalType, data: Vec<u8>) -> Self {
        assert!(
            data.len() <= MAX_PLAINTEXT_LEN,
            "data exceeds {} bytes",
            MAX_PLAINTEXT_LEN
        );
        Self {
            call_id,
            signal_type,
            data,
        }
    }

    /// Serialize to the on-chain wire format: `call_id || signal_type || data`.
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(16 + 1 + self.data.len());
        buf.extend_from_slice(&self.call_id);
        buf.push(self.signal_type as u8);
        buf.extend_from_slice(&self.data);
        buf
    }

    /// Deserialize from the on-chain wire format.
    pub fn decode(bytes: &[u8]) -> Result<Self, CallError> {
        if bytes.len() < 17 {
            return Err(CallError::PayloadTooShort);
        }
        let mut call_id = [0u8; 16];
        call_id.copy_from_slice(&bytes[..16]);
        let signal_type = SignalType::from_u8(bytes[16]).ok_or(CallError::InvalidSignalType)?;
        let data = bytes[17..].to_vec();
        Ok(Self {
            call_id,
            signal_type,
            data,
        })
    }
}

/// Errors from call signaling operations.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CallError {
    /// Payload shorter than the minimum 17 bytes (16 call_id + 1 signal_type).
    PayloadTooShort,
    /// Invalid signal type byte.
    InvalidSignalType,
}

impl core::fmt::Display for CallError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::PayloadTooShort => write!(f, "payload too short"),
            Self::InvalidSignalType => write!(f, "invalid signal type"),
        }
    }
}

impl std::error::Error for CallError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn call_signal_offer_roundtrip() {
        let call_id = [0x01u8; 16];
        let sdp = b"v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\n".to_vec();
        let signal = CallSignal::new(call_id, SignalType::Offer, sdp.clone());
        let encoded = signal.encode();
        assert_eq!(encoded.len(), 16 + 1 + sdp.len());

        let decoded = CallSignal::decode(&encoded).unwrap();
        assert_eq!(decoded.call_id, call_id);
        assert_eq!(decoded.signal_type, SignalType::Offer);
        assert_eq!(decoded.data, sdp);
    }

    #[test]
    fn call_signal_answer_roundtrip() {
        let call_id = [0x02u8; 16];
        let sdp = b"v=0\r\no=- 67890 2 IN IP4 127.0.0.1\r\n".to_vec();
        let signal = CallSignal::new(call_id, SignalType::Answer, sdp.clone());
        let encoded = signal.encode();

        let decoded = CallSignal::decode(&encoded).unwrap();
        assert_eq!(decoded.signal_type, SignalType::Answer);
        assert_eq!(decoded.data, sdp);
    }

    #[test]
    fn call_signal_ice_candidate_roundtrip() {
        let call_id = [0x03u8; 16];
        let candidate = b"candidate:1 1 UDP 2130706431 192.168.1.1 9000 typ host".to_vec();
        let signal = CallSignal::new(call_id, SignalType::IceCandidate, candidate.clone());
        let encoded = signal.encode();

        let decoded = CallSignal::decode(&encoded).unwrap();
        assert_eq!(decoded.signal_type, SignalType::IceCandidate);
        assert_eq!(decoded.data, candidate);
    }

    #[test]
    fn call_signal_hangup_roundtrip() {
        let call_id = [0x04u8; 16];
        let signal = CallSignal::new(call_id, SignalType::Hangup, vec![]);
        let encoded = signal.encode();
        assert_eq!(encoded.len(), 17);

        let decoded = CallSignal::decode(&encoded).unwrap();
        assert_eq!(decoded.signal_type, SignalType::Hangup);
        assert!(decoded.data.is_empty());
    }

    #[test]
    fn call_signal_too_short_rejected() {
        let short = [0u8; 16];
        assert_eq!(
            CallSignal::decode(&short).unwrap_err(),
            CallError::PayloadTooShort
        );
    }

    #[test]
    fn call_signal_invalid_type_rejected() {
        let mut bytes = vec![0u8; 17];
        bytes[16] = 99;
        assert_eq!(
            CallSignal::decode(&bytes).unwrap_err(),
            CallError::InvalidSignalType
        );
    }

    #[test]
    fn signal_type_from_u8() {
        assert_eq!(SignalType::from_u8(0), Some(SignalType::Offer));
        assert_eq!(SignalType::from_u8(1), Some(SignalType::Answer));
        assert_eq!(SignalType::from_u8(2), Some(SignalType::IceCandidate));
        assert_eq!(SignalType::from_u8(3), Some(SignalType::Hangup));
        assert_eq!(SignalType::from_u8(4), None);
        assert_eq!(SignalType::from_u8(255), None);
    }

    #[test]
    fn call_signal_max_data() {
        let call_id = [0x05u8; 16];
        let data = vec![0xABu8; MAX_PLAINTEXT_LEN];
        let signal = CallSignal::new(call_id, SignalType::Offer, data);
        let encoded = signal.encode();
        assert_eq!(encoded.len(), 16 + 1 + MAX_PLAINTEXT_LEN);

        let decoded = CallSignal::decode(&encoded).unwrap();
        assert_eq!(decoded.data.len(), MAX_PLAINTEXT_LEN);
    }

    #[test]
    fn call_signal_data_too_long_panics() {
        let result = std::panic::catch_unwind(|| {
            CallSignal::new(
                [0u8; 16],
                SignalType::Offer,
                vec![0u8; MAX_PLAINTEXT_LEN + 1],
            );
        });
        assert!(result.is_err());
    }
}
