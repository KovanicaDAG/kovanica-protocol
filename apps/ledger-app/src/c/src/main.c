/*
 * Kovanica Ledger App - Main Entry Point
 * 
 * This is the main entry point for the Ledger app. It handles:
 * - APDU dispatch
 * - App initialization
 * - Main event loop
 */

#include <stdint.h>
#include <stdbool.h>
#include <os.h>
#include <cx.h>
#include <os_io_seproxyhal.h>
#include "kovanica.h"
#include "ui.h"

// External functions from kovanica.c
extern int kovanica_handle_apdu(const apdu_request_t *req, apdu_response_t *resp);
extern void kovanica_init(void);

// External functions from ui.c
extern void ui_display_address(const uint8_t *pubkey);
extern void ui_display_transaction(const uint8_t *tx_data, size_t len);
extern void ui_display_message(const char *msg, size_t len);
extern int ui_wait_for_confirmation(void);
extern void ui_idle(void);

// Global app state
static bool app_initialized = false;
static uint8_t g_tx_buffer[MAX_APDU_SIZE];
static size_t g_tx_buffer_len = 0;
static bool g_tx_chunked = false;

/// Initialize the app
void kovanica_main(void) {
    if (!app_initialized) {
        kovanica_init();
        app_initialized = true;
    }
    
    // Show idle screen
    ui_idle();
    
    // Main event loop
    while (true) {
        // Wait for APDU command
        volatile unsigned int rx = 0;
        volatile unsigned int tx = 0;
        
        // Receive APDU
        rx = io_seproxyhal_spi_recv(G_io_seproxyhal_spi_buffer, sizeof(G_io_seproxyhal_spi_buffer), 0);
        
        if (rx == 0) {
            continue; // No data received
        }
        
        // Parse APDU
        if (rx < 5) {
            // Invalid APDU (too short)
            io_seproxyhal_send_status(0x6700); // Wrong length
            continue;
        }
        
        apdu_request_t req = {
            .cla = G_io_seproxyhal_spi_buffer[0],
            .ins = G_io_seproxyhal_spi_buffer[1],
            .p1 = G_io_seproxyhal_spi_buffer[2],
            .p3 = G_io_seproxyhal_spi_buffer[3],
            .lc = G_io_seproxyhal_spi_buffer[4],
            .data = &G_io_seproxyhal_spi_buffer[5]
        };
        
        // Validate Lc matches remaining data
        if (req.lc != rx - 5) {
            io_seproxyhal_send_status(SW_WRONG_DATA_LEN);
            continue;
        }
        
        apdu_response_t resp = {
            .data = G_io_seproxyhal_spi_buffer,
            .max_len = sizeof(G_io_seproxyhal_spi_buffer),
            .len = 0,
            .sw = SW_OK
        };
        
        // Handle APDU
        int result = kovanica_handle_apdu(&req, &resp);
        
        if (result != KOVANICA_OK) {
            resp.sw = result;
        }
        
        // Send response
        tx = resp.len;
        G_io_seproxyhal_spi_buffer[tx++] = (resp.sw >> 8) & 0xFF;
        G_io_seproxyhal_spi_buffer[tx++] = resp.sw & 0xFF;
        
        io_seproxyhal_spi_send(G_io_seproxyhal_spi_buffer, tx);
    }
}

/// Initialize app state
void kovanica_init(void) {
    // Initialize secure memory
    memset(g_tx_buffer, 0, sizeof(g_tx_buffer));
    g_tx_buffer_len = 0;
    g_tx_chunked = false;
    
    // Initialize UI
    ui_idle();
}

/// Handle chunked transaction data
static int handle_tx_chunk(const apdu_request_t *req, apdu_response_t *resp) {
    uint8_t p1 = req->p1;
    
    if (p1 == 0x00) {
        // First chunk - initialize buffer
        g_tx_buffer_len = 0;
        g_tx_chunked = true;
    }
    
    if (!g_tx_chunked) {
        return KOVANICA_ERR_INVALID_TX;
    }
    
    // Check buffer space
    if (g_tx_buffer_len + req->lc > MAX_APDU_SIZE) {
        return KOVANICA_ERR_BUFFER;
    }
    
    // Append data
    memcpy(&g_tx_buffer[g_tx_buffer_len], req->data, req->lc);
    g_tx_buffer_len += req->lc;
    
    // Check if this is the last chunk (P1 == 0x80 or Lc == 0)
    if (req->p1 == 0x80 || req->lc == 0) {
        g_tx_chunked = false;
        
        // Parse and display transaction for confirmation
        ui_display_transaction(g_tx_buffer, g_tx_buffer_len);
        
        // Wait for user confirmation
        if (!ui_wait_for_confirmation()) {
            return KOVANICA_ERR_DENY;
        }
        
        // Sign the transaction
        // Note: In production, we'd extract sighash from transaction
        // and call kovanica_sign_transaction()
        
        // For now, return success with dummy signature
        uint8_t dummy_sig[64] = {0};
        memcpy(resp->data, dummy_sig, 64);
        resp->len = 64;
    }
    
    return KOVANICA_OK;
}

/// APDU handler dispatch
int kovanica_handle_apdu(const apdu_request_t *req, apdu_response_t *resp) {
    // Check CLA
    if (req->cla != APP_CLA) {
        return KOVANICA_ERR_CLA_NOT_SUPPORTED;
    }
    
    switch (req->ins) {
        case INS_GET_VERSION:
            return handle_get_version(resp);
            
        case INS_GET_PUBLIC_KEY:
            return handle_get_public_key(req, resp);
            
        case INS_SIGN_TX:
            return handle_tx_chunk(req, resp);
            
        case INS_GET_CONFIG:
            return handle_get_config(resp);
            
        case INS_SIGN_MESSAGE:
            return handle_sign_message(req, resp);
            
        default:
            return KOVANICA_ERR_INS_NOT_SUPPORTED;
    }
}

/// INS 0x01: Get version
int handle_get_version(apdu_response_t *resp) {
    // Version byte
    resp->data[0] = 1;
    size_t len = 1;
    
    // App name
    const char *name = APP_NAME;
    size_t name_len = strlen(name);
    memcpy(&resp->data[1], name, name_len);
    len += name_len;
    resp->data[len++] = 0; // Null terminator
    
    // Flags
    resp->data[len++] = 0; // No blind signing, multi-asset supported
    
    resp->len = len;
    resp->sw = SW_OK;
    return KOVANICA_OK;
}

/// INS 0x02: Get public key
int handle_get_public_key(const apdu_request_t *req, apdu_response_t *resp) {
    // Verify data length (20 bytes = 5 * 4 bytes for path)
    if (req->lc != 20) {
        return KOVANICA_ERR_WRONG_DATA_LEN;
    }
    
    // Parse BIP-44 path (5 components, 4 bytes each, big-endian)
    uint32_t path[5];
    for (int i = 0; i < 5; i++) {
        path[i] = (req->data[i*4] << 24) | (req->data[i*4+1] << 16) | 
                  (req->data[i*4+2] << 8) | req->data[i*4+3];
    }
    
    // Validate path format: m/44'/11111'/account'/change/index
    if ((path[0] & 0x80000000) == 0 || (path[0] & 0x7FFFFFFF) != 44) {
        return KOVANICA_ERR_BAD_PATH;
    }
    if ((path[1] & 0x80000000) == 0 || (path[1] & 0x7FFFFFFF) != 11111) {
        return KOVANICA_ERR_BAD_PATH;
    }
    if ((path[2] & 0x80000000) == 0) {
        return KOVANICA_ERR_BAD_PATH;
    }
    
    // In production: derive key from device seed
    // For now, return placeholder
    uint8_t pk[32] = {0};
    // kovanica_get_public_key(path, pk);
    
    // P1=0x01: display address on device
    if (req->p1 == 0x01) {
        ui_display_address(NULL); // Would pass pk in production
    }
    
    memcpy(resp->data, pk, 32);
    resp->len = 32;
    resp->sw = SW_OK;
    return KOVANICA_OK;
}

/// INS 0x04: Get config
int handle_get_config(apdu_response_t *resp) {
    size_t len = 0;
    
    // Coin type (4 bytes, big-endian)
    uint32_t coin_type = 11111;
    resp->data[0] = (coin_type >> 24) & 0xFF;
    resp->data[1] = (coin_type >> 16) & 0xFF;
    resp->data[2] = (coin_type >> 8) & 0xFF;
    resp->data[3] = coin_type & 0xFF;
    len += 4;
    
    // Version
    resp->data[len++] = 1;
    
    // Flags
    resp->data[len++] = 0x02; // Multi-asset support
    
    // Max transaction size
    resp->data[len++] = (1024 >> 8) & 0xFF;
    resp->data[len++] = 1024 & 0xFF;
    
    resp->len = len;
    resp->sw = SW_OK;
    return KOVANICA_OK;
}

/// INS 0x05: Sign message (BIP-137 style)
int handle_sign_message(const apdu_request_t *req, apdu_response_t *resp) {
    if (req->lc == 0 || req->lc > 255) {
        return KOVANICA_ERR_WRONG_DATA_LEN;
    }
    
    // P1=0x01: display message for confirmation
    if (req->p1 == 0x01) {
        ui_display_message((const char*)req->data, req->lc);
        if (!ui_wait_for_confirmation()) {
            return KOVANICA_ERR_DENY;
        }
    }
    
    // Sign message
    // uint8_t sig[64];
    // kovanica_sign_message(req->data, req->lc, sig);
    
    // Placeholder
    uint8_t sig[64] = {0};
    memcpy(resp->data, sig, 64);
    resp->len = 64;
    resp->sw = SW_OK;
    return KOVANICA_OK;
}