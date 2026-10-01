/*
 * Kovanica Ledger App - Core Logic
 * 
 * Implements:
 * - BIP-32/44 path derivation (SLIP-0010 for Ed25519)
 * - Ed25519 transaction signing via Ledger SDK
 * - Transaction parsing for display
 * - Multi-asset support (KVP-102)
 */

#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include <cx.h>
#include <os.h>
#include "kovanica.h"

// Constants
#define ED25519_SEED_KEY "ed25519 seed"
#define ED25519_SEED_KEY_LEN 12
#define HARDENED_FLAG 0x80000000

// SLIP-0010 Ed25519 derivation
// Returns KOVANICA_OK on success, error code on failure
int kovanica_slip10_derive(const uint8_t parent_key[32], const uint8_t parent_chain[32], 
                           uint32_t index, uint8_t child_key[32], uint8_t child_chain[32]) {
    uint8_t data[37];
    uint8_t hmac[64];
    
    // Data format: 0x00 || parent_key(32) || index(4 bytes big-endian)
    uint8_t data[37];
    data[0] = 0x00; // Private derivation
    memcpy(&data[1], parent_key, 32);
    data[33] = (index >> 24) & 0xFF;
    data[34] = (index >> 16) & 0xFF;
    data[35] = (index >> 8) & 0xFF;
    data[36] = index & 0xFF;
    
    // HMAC-SHA512(parent_chain, data)
    cx_hmac_sha512_t hmac;
    cx_hmac_sha512_init(&hmac, parent_chain, 32);
    cx_hmac(&hmac, data, 37, NULL, 0);
    cx_hmac_digest(&hmac, NULL, 0, NULL, 0); // Just to get the digest
    
    // Actually, we need to use the proper CX API
    uint8_t hmac_result[64];
    cx_hmac_sha512(parent_chain, 32, data, 37, hmac_result, 64);
    
    // Split result: first 32 bytes = child key, last 32 bytes = child chain code
    memcpy(child_key, hmac_result, 32);
    memcpy(child_chain, &hmac_result[32], 32);
    
    return KOVANICA_OK;
}

/// Derive master key and chain code from seed (SLIP-0010)
/// Returns KOVANICA_OK on success
int kovanica_slip10_master_from_seed(const uint8_t *seed, size_t seed_len,
                                     uint8_t master_key[32], uint8_t master_chain[32]) {
    const uint8_t *seed_key = (const uint8_t *)"ed25519 seed";
    size_t seed_key_len = 12;
    
    uint8_t hmac[64];
    cx_hmac_sha512(seed_key, 12, seed, 32, hmac, 64);
    
    memcpy(master_key, hmac, 32);
    memcpy(master_chain, &hmac[32], 32);
    
    return KOVANICA_OK;
}

/// Derive BIP-44 path from seed
/// Path format: m / 44' / 11111' / account' / change / index
/// Returns KOVANICA_OK on success
int kovanica_derive_bip44_path(const uint8_t *seed, const uint32_t *path, size_t path_len,
                               uint8_t private_key[32], uint8_t chain_code[32]) {
    if (path_len == 0 || path_len > 10) {
        return KOVANICA_ERR_BAD_PATH;
    }
    
    // Master key from seed
    uint8_t key[32], chain[32];
    int ret = kovanica_slip10_master_from_seed(seed, 32, key, chain);
    if (ret != KOVANICA_OK) return ret;
    
    // Derive each component
    for (size_t i = 0; i < path_len; i++) {
        uint32_t index = path[i];
        bool hardened = (index & 0x80000000) != 0;
        uint32_t child_index = index & 0x7FFFFFFF;
        
        // Only hardened derivation supported for Ed25519 (SLIP-0010)
        if (!hardened && i > 0) {
            return KOVANICA_ERR_INVALID_DERIVATION;
        }
        
        int ret = kovanica_slip10_derive(key, chain, hardened ? (index & 0x7FFFFFFF) | 0x80000000 : index, key, chain);
        if (ret != KOVANICA_OK) return ret;
    }
    
    // Return derived key and chain code
    memcpy(master_key, key, 32);
    memcpy(master_chain, chain, 32);
    
    return KOVANICA_OK;
}

/// Derive Ed25519 public key from private key
int kovanica_get_public_key(const uint8_t private_key[32], uint8_t public_key[32]) {
    // Use Ledger SDK's Ed25519 key derivation
    cx_ecfp_public_key_t public_key;
    cx_ecfp_private_key_t private_key;
    
    cx_ecfp_init_private_key(CX_CURVE_Ed25519, private_key, 32, &private_key);
    cx_ecfp_generate_pair(CX_CURVE_Ed25519, &public_key, &private_key, 1);
    
    memcpy(public_key, public_key.W, 32);
    return KOVANICA_OK;
}

/// Sign data with Ed25519 private key
int kovanica_sign_data(const uint8_t private_key[32], const uint8_t *data, size_t data_len, uint8_t signature[64]) {
    cx_ecfp_private_key_t private_key_obj;
    cx_ecfp_init_private_key(CX_CURVE_Ed25519, private_key, 32, &private_key_obj);
    
    uint8_t hash[32];
    cx_hash_sha256(data, data_len, hash, 32);
    
    uint8_t signature[64];
    size_t sig_len = 64;
    cx_eddsa_sign(&private_key_obj, CX_RND_RFC6979 | CX_LAST, CX_SHA256, 
                  data, 32, NULL, 0, signature, &sig_len);
    
    if (sig_len != 64) return KOVANICA_ERR_CRYPTO;
    
    // Copy to output (R || S format)
    memcpy(signature, signature, 64);
    return KOVANICA_OK;
}

/// Parse transaction for display
int kovanica_parse_transaction(const uint8_t *data, size_t len, 
                               char *out_str, size_t out_len) {
    if (len < 10) return KOVANICA_ERR_INVALID_TX;
    
    size_t offset = 0;
    size_t out_offset = 0;
    
    // Version
    if (offset >= len) return KOVANICA_ERR_INVALID_TX;
    offset++;
    
    // Flags
    if (offset >= len) return KOVANICA_ERR_INVALID_TX;
    offset++;
    
    // Input count
    if (offset >= len) return KOVANICA_ERR_INVALID_TX;
    uint8_t input_count = data[offset++];
    
    if (input_count > 16) return KOVANICA_ERR_INVALID_TX;
    
    for (int i = 0; i < input_count; i++) {
        if (offset + 32 + 4 + 4 + 2 > len) return KOVANICA_ERR_INVALID_TX;
        offset += 32 + 4 + 4 + 2; // prev_txid + index + sequence + witness_len
    }
    
    // Output count
    if (offset >= len) return KOVANICA_ERR_INVALID_TX;
    uint8_t output_count = data[offset++];
    
    if (output_count > 16) return KOVANICA_ERR_INVALID_TX;
    
    // Build display string
    char *out = out_str;
    size_t remaining = out_len;
    
    int written = snprintf(out, remaining, "Tx: %d in, %d out\n", input_count, output_count);
    if (written < 0 || (size_t)written >= remaining) return KOVANICA_ERR_BUFFER;
    out += written;
    remaining -= written;
    
    // Parse outputs for display
    for (int i = 0; i < output_count; i++) {
        if (offset + 8 + 32 + 2 > len) return KOVANICA_ERR_INVALID_TX;
        
        uint64_t value = 0;
        for (int j = 0; j < 8; j++) {
            value |= (uint64_t)data[offset++] << (j * 8);
        }
        
        // Asset ID (32 bytes)
        offset += 32;
        
        uint16_t script_len = (data[offset] << 8) | data[offset + 1];
        offset += 2;
        
        written = snprintf(out, remaining, "  Out %d: %llu atoms\n", i, value);
        if (written < 0 || (size_t)written >= remaining) return KOVANICA_ERR_BUFFER;
        out += written;
        remaining -= written;
    }
    
    return KOVANICA_OK;
}