use super::{ins, sw, ApduRequest, ApduResponse, AppError, Result, CLA};

/// Handle APDU request
pub fn handle_apdu<'a>(req: &ApduRequest<'a>, resp: &mut ApduResponse<'a>) -> Result<u16> {
    // Check CLA
    if req.cla != CLA {
        return Err(AppError::ClaNotSupported);
    }

    match req.ins {
        ins::GET_VERSION => handle_get_version(req, resp),
        ins::GET_PUBLIC_KEY => handle_get_public_key(req, resp),
        ins::SIGN_TRANSACTION => handle_sign_transaction(req, resp),
        ins::GET_CONFIG => handle_get_config(req, resp),
        ins::SIGN_MESSAGE => handle_sign_message(req, resp),
        _ => Err(AppError::InsNotSupported),
    }
}

/// INS 0x01: Get version
/// Returns: version (1 byte) || app_name (null-terminated) || flags (1 byte)
fn handle_get_version<'a>(_req: &ApduRequest<'a>, resp: &mut ApduResponse<'a>) -> Result<u16> {
    let mut buf = [0u8; 64];
    let mut len = 0;

    // Version byte (major)
    buf[len] = 1; // Major version
    len += 1;

    // App name
    let name = b"Kovanica";
    buf[len..len + name.len()].copy_from_slice(name);
    len += name.len();
    buf[len] = 0; // Null terminator
    len += 1;

    // Flags (0 = no blind signing, etc.)
    buf[len] = 0;
    len += 1;

    resp.write(&buf[..len])?;
    Ok(sw::OK)
}

/// INS 0x02: Get public key
/// P1: 0x00 = return public key only, 0x01 = display address on device
/// P2: 0x00 = return compressed, 0x01 = return uncompressed (not used for Ed25519)
/// Data: BIP-44 path (5 * 4 bytes = 20 bytes)
fn handle_get_public_key<'a>(req: &ApduRequest<'a>, resp: &mut ApduResponse<'a>) -> Result<u16> {
    // Verify data length (20 bytes = 5 * 4 bytes for path)
    if req.data.len() != 20 {
        return Err(AppError::WrongDataLen);
    }

    // Parse BIP-44 path
    let mut path_components = [0u32; 5];
    for (i, component) in path_components.iter_mut().enumerate() {
        let start = i * 4;
        let end = start + 4;
        let bytes: [u8; 4] = req.data[start..end]
            .try_into()
            .map_err(|_| AppError::BadPath)?;
        *component = u32::from_be_bytes(bytes);
    }

    // Validate path format: m/44'/3007'/account'/change/index
    if path_components[0] & 0x80000000 == 0 || path_components[0] & 0x7FFFFFFF != 44 {
        return Err(AppError::BadPath);
    }
    if path_components[1] & 0x80000000 == 0 || path_components[1] & 0x7FFFFFFF != 3007 {
        return Err(AppError::BadPath);
    }
    if path_components[2] & 0x80000000 == 0 {
        return Err(AppError::BadPath);
    }

    // In production, derive key from device seed
    // For now, return placeholder
    let _p1 = req.p1;
    let _p2 = req.p2;

    // Get device master seed (would use Ledger SDK)
    // let seed = get_device_seed();
    // let (sk, pk) = keypair_from_seed(&derive_bip44_path(&seed, path.as_slice())?.0);

    // Placeholder public key
    let pk = [0x02u8; 32];

    // P1=0x01: display address on device (not implemented here)
    // if req.p1 == 0x01 { display_address(&pk); }

    resp.write(&pk)?;
    Ok(sw::OK)
}

/// INS 0x03: Sign transaction
/// P1: 0x00 = first chunk, 0x01 = continue, 0x02 = last chunk (sign)
/// P2: 0x00 = no display, 0x01 = display transaction for confirmation
/// Data: transaction data (or sighash for last chunk)
fn handle_sign_transaction<'a>(req: &ApduRequest<'a>, resp: &mut ApduResponse<'a>) -> Result<u16> {
    // This is a simplified handler
    // In production, would accumulate chunks, parse transaction, display for confirmation, then sign

    let is_first = req.p1 == 0x00;
    let is_last = req.p1 == 0x02;
    let display = req.p2 == 0x01;

    if is_first {
        // Initialize transaction parsing
        // In production: store transaction buffer in NVRAM or RAM
    }

    if is_last {
        // Parse transaction and sign
        let tx_data = req.data;

        // Parse for display if requested
        if display {
            let _parsed = crate::tx::parse_transaction(tx_data)?;
            // In production: display on device screen, wait for user confirmation
        }

        // Extract sighash (last 32 bytes of transaction data typically)
        // For now, assume last 32 bytes are the sighash
        if tx_data.len() < 32 {
            return Err(AppError::WrongDataLen);
        }
        let sighash_start = tx_data.len() - 32;
        let _sighash: [u8; 32] = tx_data[sighash_start..]
            .try_into()
            .map_err(|_| AppError::InvalidTransaction)?;

        // In production: derive private key from device seed + BIP-44 path
        // let seed = get_device_seed();
        // let path = get_signing_path();
        // let (sk, _) = keypair_from_seed(&derive_bip44_path(&seed, path)?.0);
        // let sig = sign(&sk, &sighash)?;

        // Placeholder signature
        let sig = [0x30u8; 64];

        resp.write(&sig)?;
    } else {
        // Acknowledge chunk
        resp.write(b"OK")?;
    }

    Ok(sw::OK)
}

/// INS 0x04: Get app configuration
/// Returns: config flags, coin type, version, etc.
fn handle_get_config<'a>(_req: &ApduRequest<'a>, resp: &mut ApduResponse<'a>) -> Result<u16> {
    let mut buf = [0u8; 32];
    let mut len = 0;

    // Coin type (4 bytes, big-endian)
    buf[len..len + 4].copy_from_slice(&3007u32.to_be_bytes());
    len += 4;

    // Version (1 byte)
    buf[len] = 1;
    len += 1;

    // Flags (1 byte): bit 0 = blind signing allowed, bit 1 = multi-asset
    buf[len] = 0x02; // Multi-asset support
    len += 1;

    // Max transaction size (2 bytes)
    buf[len..len + 2].copy_from_slice(&1024u16.to_be_bytes());
    len += 2;

    resp.write(&buf[..len])?;
    Ok(sw::OK)
}

/// INS 0x05: Sign message (BIP-137 style)
/// P1: 0x00 = sign, 0x01 = display message for confirmation
/// Data: message to sign (max 255 bytes)
fn handle_sign_message<'a>(req: &ApduRequest<'a>, resp: &mut ApduResponse<'a>) -> Result<u16> {
    let message = req.data;

    if message.is_empty() || message.len() > 255 {
        return Err(AppError::WrongDataLen);
    }

    // P1=0x01: display message for confirmation
    if req.p1 == 0x01 {
        // In production: display message on device, wait for user confirmation
    }

    // Sign message
    // In production: derive key from seed + path, sign
    // let seed = get_device_seed();
    // let path = get_signing_path();
    // let (sk, _) = keypair_from_seed(&derive_bip44_path(&seed, path)?.0);
    // let sig = sign(&sk, message)?;

    // Placeholder
    let sig = [0x31u8; 64];

    resp.write(&sig)?;
    Ok(sw::OK)
}

/// Dispatch table for APDU handling
pub struct ApduHandler;

impl ApduHandler {
    pub fn new() -> Self {
        Self {}
    }

    pub fn handle<'a>(
        &mut self,
        req: &ApduRequest<'a>,
        resp: &mut ApduResponse<'a>,
    ) -> Result<u16> {
        handle_apdu(req, resp)
    }
}

impl Default for ApduHandler {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apdu_parsing() {
        let req = ApduRequest {
            cla: CLA,
            ins: ins::GET_VERSION,
            p1: 0,
            p2: 0,
            data: &[],
        };
        let mut resp_buf = [0u8; 64];
        let mut resp = ApduResponse::new(&mut resp_buf);
        let sw = handle_apdu(&req, &mut resp).unwrap();
        assert_eq!(sw, sw::OK);
    }

    #[test]
    fn test_wrong_cla() {
        let req = ApduRequest {
            cla: 0xE1,
            ins: ins::GET_VERSION,
            p1: 0,
            p2: 0,
            data: &[],
        };
        let mut resp_buf = [0u8; 64];
        let mut resp = ApduResponse::new(&mut resp_buf);
        let err = handle_apdu(&req, &mut resp).unwrap_err();
        assert_eq!(err, AppError::ClaNotSupported);
    }
}
