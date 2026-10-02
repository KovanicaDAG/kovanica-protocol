//! On-chain encrypted chat over KVP-104 data transactions.
//!
//! Chat messages are carried inside ordinary KVP-104 transactions (tag `b"CHAT"`)
//! so they are mined, gossiped, and finalized exactly like any other transaction.
//! The payload is encrypted with ECIES (X25519 ephemeral key exchange +
//! ChaCha20-Poly1305 AEAD) so only the intended recipient can read it.
//!
//! Wire format (max 260 bytes on-chain):
//! ```text
//! epk:      [u8; 32]   — ephemeral X25519 public key
//! nonce:    [u8; 12]   — ChaCha20-Poly1305 nonce
//! ciphertext: [u8]    — encrypted plaintext + 16-byte Poly1305 tag
//! ```
//!
//! `ChatStore` is a bounded in-memory ring buffer — no heap growth, no I/O,
//! O(1) push and O(n) iteration (n = capacity, default 1000).

#![forbid(unsafe_code)]

mod calls;
mod contacts;
pub mod crypto;
mod file;
pub mod message;
mod request;
mod store;
mod tipped;
mod voice;

pub use calls::{CallError, CallSignal, SignalType, CALL_TAG};
pub use contacts::{Contact, ContactBook, ContactError};
pub use file::{FileChunk, FileError, FileTransfer, DEFAULT_CHUNK_SIZE, FILE_TAG, MAX_FILE_SIZE};
pub use message::{ChatMessage, ChatPayload, CHAT_TAG, MAX_PLAINTEXT_LEN};
pub use request::{PaymentRequest, RequestError, PAYMENT_REQUEST_TAG};
pub use store::{ChatStore, DEFAULT_CAPACITY};
pub use tipped::{ChatBuildError, TippedChat, ATOM, CHAT_TIP_TAG};
pub use voice::{VoiceError, VoiceMessage, VOICE_TAG};
