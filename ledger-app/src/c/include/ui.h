#ifndef UI_H
#define UI_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

// Display address on device screen
// pubkey: 32-byte Ed25519 public key
void ui_display_address(const uint8_t *pubkey);

// Display transaction for user confirmation
// tx_data: raw transaction bytes
// len: length of transaction data
void ui_display_transaction(const uint8_t *tx_data, size_t len);

// Display message for signing
void ui_display_message(const char *msg, size_t len);

// Wait for user confirmation (button press)
// Returns 1 if confirmed, 0 if denied
int ui_wait_for_confirmation(void);

// Display version info
void ui_display_version(void);

// Display error message
void ui_display_error(const char *msg);

// Idle screen
void ui_idle(void);

#ifdef __cplusplus
}
#endif

#endif // UI_H