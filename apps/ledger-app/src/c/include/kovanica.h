#ifndef KOVANICA_H
#define KOVANICA_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

// App constants
#define APP_NAME        "Kovanica"
#define APP_VERSION     "0.1.0"
#define APP_CLA         0xE0

// APDU Instructions
#define INS_GET_VERSION     0x01
#define INS_GET_PUBLIC_KEY  0x02
#define INS_SIGN_TX         0x03
#define INS_GET_CONFIG      0x04
#define INS_SIGN_MESSAGE    0x05

// Status Words
#define SW_OK                  0x9000
#define SW_DENY                0x6985
#define SW_WRONG_P1P2          0x6A86
#define SW_WRONG_DATA_LEN      0x6A87
#define SW_INS_NOT_SUPPORTED   0x6D00
#define SW_CLA_NOT_SUPPORTED   0x6E00
#define SW_BAD_PATH            0x6A80
#define SW_SIGN_VERIFY_FAIL    0x6984

// Maximum APDU size
#define MAX_APDU_SIZE 255

// BIP-44
#define MAX_PATH_LEN 5
#define KOVANICA_COIN_TYPE 11111

// BIP-44 path structure
typedef struct {
    uint32_t components[5];
    uint8_t len;
} bip44_path_t;

// APDU request
typedef struct {
    uint8_t cla;
    uint8_t ins;
    uint8_t p1;
    uint8_t p2;
    uint8_t lc;
    const uint8_t *data;
} apdu_request_t;

// APDU response
typedef struct {
    uint8_t *data;
    size_t len;
    size_t max_len;
    uint16_t sw;
} apdu_response_t;

// Function declarations
void kovanica_init(void);
int kovanica_handle_apdu(const apdu_request_t *req, apdu_response_t *resp);

// Crypto functions (implemented in Rust, called from C)
int kovanica_get_public_key(const uint32_t *path, uint8_t *out_pk);
int kovanica_sign_transaction(const uint8_t *sighash, uint8_t *out_sig);
int kovanica_sign_message(const uint8_t *msg, size_t msg_len, uint8_t *out_sig);

// UI functions
void ui_display_address(const uint8_t *pubkey);
void ui_display_transaction(const uint8_t *tx_data, size_t len);
void ui_display_message(const char *msg, size_t len);
int ui_wait_for_confirmation(void);

// Error codes
typedef enum {
    KOVANICA_OK = 0,
    KOVANICA_ERR_DENY = 1,
    KOVANICA_ERR_BAD_PATH = 2,
    KOVANICA_ERR_INVALID_TX = 3,
    KOVANICA_ERR_CRYPTO = 4,
    KOVANICA_ERR_BUFFER = 5,
} kovanica_error_t;

#ifdef __cplusplus
}
#endif

#endif // KOVANICA_H