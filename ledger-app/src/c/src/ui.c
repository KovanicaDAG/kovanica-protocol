/*
 * Kovanica Ledger App - UI Flows
 * 
 * Handles all user interface interactions on the Ledger device.
 */

#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include <os.h>
#include <cx.h>
#include <os_io_seproxyhal.h>
#include "ui.h"

// UI state
static char g_display_buffer[128];
static char g_address_buffer[68]; // Base58 address max length

/// Display address on device screen
void ui_display_address(const uint8_t *pubkey) {
    // In production: convert pubkey to base58 address and display
    // For now, show placeholder
    snprintf(g_display_buffer, sizeof(g_display_buffer), "Address:\nkvnc1...");
    UX_DISPLAY(g_display_buffer, ui_idle);
}

/// Display transaction for user confirmation
void ui_display_transaction(const uint8_t *tx_data, size_t len) {
    char display_str[128];
    
    // Parse transaction for display
    int ret = kovanica_parse_transaction(tx_data, len, g_display_buffer, sizeof(g_display_buffer));
    if (ret != KOVANICA_OK) {
        snprintf(g_display_buffer, sizeof(g_display_buffer), "Parse error");
    }
    
    UX_DISPLAY(g_display_buffer, ui_wait_for_confirmation);
}

/// Display message for signing
void ui_display_message(const char *msg, size_t len) {
    snprintf(g_display_buffer, sizeof(g_display_buffer), "Sign msg:\n%.60s", msg);
    UX_DISPLAY(g_display_buffer, ui_wait_for_confirmation);
}

/// Wait for user confirmation (button press)
int ui_wait_for_confirmation(void) {
    // In production, this would use UX_FLOW or similar
    // to wait for user to press both buttons
    
    // Placeholder: simulate confirmation
    // In real implementation, this would block until user confirms
    return 1; // 1 = confirmed, 0 = denied
}

/// Display version info
void ui_display_version(void) {
    snprintf(g_display_buffer, sizeof(g_display_buffer), 
             "Kovanica v%s\nReady", APP_VERSION);
    UX_DISPLAY(g_display_buffer, ui_idle);
}

/// Display error message
void ui_display_error(const char *msg) {
    snprintf(g_display_buffer, sizeof(g_display_buffer), "Error:\n%s", msg);
    UX_DISPLAY(g_display_buffer, ui_idle);
}

/// Idle screen
void ui_idle(void) {
    snprintf(g_display_buffer, sizeof(g_display_buffer), 
             "Kovanica\nReady");
    UX_DISPLAY(g_display_buffer, NULL);
}