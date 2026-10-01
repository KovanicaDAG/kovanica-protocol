use super::{AppError, Result};
use hex;

/// Kovanica transaction structure for Ledger signing
///
/// The app receives the sighash (32 bytes) and signs it.
/// Optionally, it can receive the full transaction for display verification.
/// Maximum transaction size for Ledger
pub const MAX_TX_SIZE: usize = 1024;

/// Transaction version
pub const TX_VERSION: u8 = 1;

/// Transaction flags
pub mod tx_flags {
    pub const HAS_WITNESS: u8 = 0x01;
    pub const IS_COINBASE: u8 = 0x02;
    pub const MULTI_ASSET: u8 = 0x04;
}

/// Transaction input
#[derive(Debug, Clone, Copy)]
pub struct TxInput {
    /// Previous output txid (32 bytes)
    pub prev_txid: [u8; 32],
    /// Output index (4 bytes, little-endian)
    pub output_index: u32,
    /// Sequence number (4 bytes, little-endian)
    pub sequence: u32,
    /// Witness script length (for display)
    pub witness_len: u16,
}

/// Transaction output
#[derive(Debug, Clone, Copy)]
pub struct TxOutput {
    /// Value in atoms (8 bytes, little-endian)
    pub value: u64,
    /// Asset ID (32 bytes, 0 = native KVNC)
    pub asset_id: [u8; 32],
    /// Script/address length
    pub script_len: u16,
}

/// Parsed transaction for display/verification
#[derive(Debug)]
pub struct ParsedTransaction {
    pub version: u8,
    pub flags: u8,
    pub inputs: heapless::Vec<TxInput, 16>,
    pub outputs: heapless::Vec<TxOutput, 16>,
    pub lock_time: u32,
    pub expiry: u32,
}

/// Parse transaction from bytes (for display on device)
/// Returns ParsedTransaction or error
pub fn parse_transaction(data: &[u8]) -> Result<ParsedTransaction> {
    if data.len() < 10 {
        return Err(AppError::InvalidTransaction);
    }

    let mut offset = 0;

    // Version (1 byte)
    let version = data[offset];
    offset += 1;

    // Flags (1 byte)
    let flags = data[offset];
    offset += 1;

    // Number of inputs (varint, simplified to 1 byte for now)
    if offset >= data.len() {
        return Err(AppError::InvalidTransaction);
    }
    let input_count = data[offset] as usize;
    offset += 1;

    if input_count > 16 {
        return Err(AppError::InvalidTransaction);
    }

    let mut inputs = heapless::Vec::new();
    for _ in 0..input_count {
        if offset + 32 + 4 + 4 + 2 > data.len() {
            return Err(AppError::InvalidTransaction);
        }

        let mut prev_txid = [0u8; 32];
        prev_txid.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let output_index = u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap());
        offset += 4;

        let sequence = u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap());
        offset += 4;

        let witness_len = u16::from_le_bytes(data[offset..offset + 2].try_into().unwrap());
        offset += 2;

        inputs
            .push(TxInput {
                prev_txid,
                output_index,
                sequence,
                witness_len,
            })
            .map_err(|_| AppError::BufferOverflow)?;
    }

    // Number of outputs
    if offset >= data.len() {
        return Err(AppError::InvalidTransaction);
    }
    let output_count = data[offset] as usize;
    offset += 1;

    if output_count > 16 {
        return Err(AppError::InvalidTransaction);
    }

    let mut outputs = heapless::Vec::new();
    for _ in 0..output_count {
        if offset + 8 + 32 + 2 > data.len() {
            return Err(AppError::InvalidTransaction);
        }

        let value = u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
        offset += 8;

        let mut asset_id = [0u8; 32];
        asset_id.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let script_len = u16::from_le_bytes(data[offset..offset + 2].try_into().unwrap());
        offset += 2;

        outputs
            .push(TxOutput {
                value,
                asset_id,
                script_len,
            })
            .map_err(|_| AppError::BufferOverflow)?;
    }

    // Lock time (4 bytes)
    if offset + 4 > data.len() {
        return Err(AppError::InvalidTransaction);
    }
    let lock_time = u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap());
    offset += 4;

    // Expiry (4 bytes)
    if offset + 4 > data.len() {
        return Err(AppError::InvalidTransaction);
    }
    let expiry = u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap());

    Ok(ParsedTransaction {
        version,
        flags,
        inputs,
        outputs,
        lock_time,
        expiry,
    })
}

/// Format amount for display (KVNC with 8 decimals)
pub fn format_amount(amount: u64) -> heapless::String<32> {
    let kvnc = amount / 100_000_000;
    let frac = amount % 100_000_000;
    let mut s = heapless::String::new();
    if frac == 0 {
        let _ = core::fmt::write(&mut s, format_args!("{} KVNC", kvnc));
    } else {
        let _ = core::fmt::write(&mut s, format_args!("{}.{:08} KVNC", kvnc, frac));
    }
    s
}

/// Format asset ID for display (first 8 chars + ...)
pub fn format_asset_id(asset_id: &[u8; 32]) -> heapless::String<16> {
    let mut s = heapless::String::new();
    if asset_id.iter().all(|&b| b == 0) {
        let _ = core::fmt::write(&mut s, format_args!("KVNC"));
    } else {
        let hex = hex::encode(&asset_id[..4]);
        let _ = core::fmt::write(&mut s, format_args!("{}...", hex));
    }
    s
}

/// Format address for display (first 10 chars + ... + last 6)
pub fn format_address(addr: &[u8]) -> heapless::String<20> {
    let mut s = heapless::String::new();
    if addr.len() >= 20 {
        let prefix = hex::encode(&addr[..5]);
        let suffix = hex::encode(&addr[addr.len() - 3..]);
        let _ = core::fmt::write(&mut s, format_args!("{}...{}", prefix, suffix));
    } else {
        let _ = core::fmt::write(&mut s, format_args!("{}", hex::encode(addr)));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_amount() {
        assert_eq!(format_amount(100_000_000).as_str(), "1 KVNC");
        assert_eq!(format_amount(150_000_000).as_str(), "1.50000000 KVNC");
        assert_eq!(format_amount(0).as_str(), "0 KVNC");
    }

    #[test]
    fn test_format_asset_id() {
        let native = [0u8; 32];
        assert_eq!(format_asset_id(&native).as_str(), "KVNC");

        let mut custom = [0u8; 32];
        custom[0] = 0xab;
        custom[1] = 0xcd;
        custom[2] = 0xef;
        custom[3] = 0x12;
        let s = format_asset_id(&custom);
        assert!(s.as_str().starts_with("abcd"));
    }
}
