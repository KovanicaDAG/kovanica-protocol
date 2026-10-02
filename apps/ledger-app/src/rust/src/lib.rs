#![no_std]
#![forbid(unsafe_code)]
#![cfg_attr(all(not(feature = "std"), not(test)), no_main)]

//! Kovanica Ledger App - Core Logic
//!
//! This crate provides the core cryptographic and transaction logic for the
//! Kovanica Ledger app, written in Rust (no_std) for the Ledger's ARM Cortex-M
//! processor.
//!
//! Features:
//! - BIP-32/44 path derivation (m/44'/3007'/account'/change/index)
//! - Ed25519 transaction signing (sighash = BLAKE3 of witness-free encoding)
//! - Transaction parsing (Kovanica format)
//! - APDU command handling

extern crate alloc;

// Re-export modules
pub mod apdu;
pub mod bip32;
pub mod ed25519;
pub mod tx;

// Panic handler. Excluded from test builds: the libtest harness supplies its
// own panic_impl, and defining ours there is a duplicate-lang-item error.
#[cfg(all(not(feature = "std"), not(test)))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}

/// Kovanica coin type (unregistered, for BIP-44)
pub const KOVANICA_COIN_TYPE: u32 = 3007;

/// APDU Class for Kovanica
pub const CLA: u8 = 0xE0;

/// APDU Instructions
pub mod ins {
    pub const GET_VERSION: u8 = 0x01;
    pub const GET_PUBLIC_KEY: u8 = 0x02;
    pub const SIGN_TRANSACTION: u8 = 0x03;
    pub const GET_CONFIG: u8 = 0x04;
    pub const SIGN_MESSAGE: u8 = 0x05;
}

/// APDU Status Words
pub mod sw {
    pub const OK: u16 = 0x9000;
    pub const DENY: u16 = 0x6985;
    pub const WRONG_P1P2: u16 = 0x6A86;
    pub const WRONG_DATA_LEN: u16 = 0x6A87;
    pub const INS_NOT_SUPPORTED: u16 = 0x6D00;
    pub const CLA_NOT_SUPPORTED: u16 = 0x6E00;
    pub const BAD_PATH: u16 = 0x6A80;
    pub const SIGN_VERIFY_FAIL: u16 = 0x6984;
}

/// Maximum APDU data size
pub const MAX_APDU_SIZE: usize = 255;

/// Maximum BIP-32 path length (5 components: 44'/3007'/account'/change/index)
pub const MAX_PATH_LEN: usize = 5;

/// Ed25519 constants
pub mod ed25519_consts {
    pub const PUBLIC_KEY_LEN: usize = 32;
    pub const PRIVATE_KEY_LEN: usize = 32;
    pub const SIGNATURE_LEN: usize = 64;
    pub const SEED_LEN: usize = 32;
}

/// Error types
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum AppError {
    Ok = sw::OK,
    Deny = sw::DENY,
    WrongP1P2 = sw::WRONG_P1P2,
    WrongDataLen = sw::WRONG_DATA_LEN,
    InsNotSupported = sw::INS_NOT_SUPPORTED,
    ClaNotSupported = sw::CLA_NOT_SUPPORTED,
    BadPath = sw::BAD_PATH,
    SignVerifyFail = sw::SIGN_VERIFY_FAIL,
    InvalidPath = 0x6A81,
    InvalidDerivation = 0x6A82,
    InvalidTransaction = 0x6A83,
    BufferOverflow = 0x6A84,
    CryptoError = 0x6A85,
}

impl From<AppError> for u16 {
    fn from(e: AppError) -> u16 {
        e as u16
    }
}

/// Result type
pub type Result<T> = core::result::Result<T, AppError>;

/// BIP-44 path structure
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bip44Path {
    /// Path components (max 5)
    pub components: [u32; MAX_PATH_LEN],
    /// Actual length
    pub len: u8,
}

impl Bip44Path {
    /// Create new path from components
    pub fn new(components: &[u32]) -> Result<Self> {
        if components.is_empty() || components.len() > MAX_PATH_LEN {
            return Err(AppError::InvalidPath);
        }
        let mut path = Self {
            components: [0; MAX_PATH_LEN],
            len: components.len() as u8,
        };
        for (i, &c) in components.iter().enumerate() {
            path.components[i] = c;
        }
        Ok(path)
    }

    /// Create standard Kovanica BIP-44 path
    /// m / 44' / 3007' / account' / change / index
    pub fn kovanica(account: u32, change: u32, index: u32) -> Result<Self> {
        // Hardened derivation indicated by 0x80000000 bit
        const HARDENED: u32 = 0x80000000;
        Self::new(&[
            44 | HARDENED,
            KOVANICA_COIN_TYPE | HARDENED,
            account | HARDENED,
            change,
            index,
        ])
    }

    /// Get path as slice
    pub fn as_slice(&self) -> &[u32] {
        &self.components[..self.len as usize]
    }

    /// Serialize to bytes (4 bytes per component, big-endian)
    pub fn to_bytes(&self) -> [u8; 20] {
        let mut buf = [0u8; 20];
        for (i, &comp) in self.as_slice().iter().enumerate() {
            buf[i * 4..i * 4 + 4].copy_from_slice(&comp.to_be_bytes());
        }
        buf
    }
}

impl Default for Bip44Path {
    fn default() -> Self {
        Self::kovanica(0, 0, 0).unwrap()
    }
}

/// APDU Request structure
#[derive(Debug)]
pub struct ApduRequest<'a> {
    pub cla: u8,
    pub ins: u8,
    pub p1: u8,
    pub p2: u8,
    pub data: &'a [u8],
}

/// APDU Response structure
pub struct ApduResponse<'a> {
    pub data: &'a mut [u8],
    pub len: usize,
}

impl<'a> ApduResponse<'a> {
    pub fn new(buf: &'a mut [u8]) -> Self {
        Self { data: buf, len: 0 }
    }

    pub fn write(&mut self, data: &[u8]) -> Result<()> {
        if self.len + data.len() > self.data.len() {
            return Err(AppError::BufferOverflow);
        }
        self.data[self.len..self.len + data.len()].copy_from_slice(data);
        self.len += data.len();
        Ok(())
    }

    pub fn finish(self, sw: u16) -> (&'a [u8], u16) {
        (&self.data[..self.len], sw)
    }
}

/// Version information
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const APP_NAME: &str = "Kovanica";

/// Entry point for tests (when std feature enabled)
#[cfg(all(test, feature = "std"))]
mod tests {
    use super::*;

    #[test]
    fn test_bip44_path_creation() {
        let path = Bip44Path::kovanica(0, 0, 0).unwrap();
        assert_eq!(path.len, 5);
        assert_eq!(path.components[0], 44 | 0x80000000);
        assert_eq!(path.components[1], 3007 | 0x80000000);
    }

    #[test]
    fn test_bip44_path_to_bytes() {
        let path = Bip44Path::kovanica(0, 0, 0).unwrap();
        let bytes = path.to_bytes();
        assert_eq!(bytes.len(), 20);
    }
}
