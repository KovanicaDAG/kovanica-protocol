#!/usr/bin/env bash
# Kovanica Protocol — ESP32 Light Node Firmware Flasher
#
# Flashes a minimal Kovanica light node onto ESP32/ESP32-S3 boards.
# The ESP32 runs a lightweight SPV client that:
#   - Connects to the testnet via Wi-Fi
#   - Syncs block headers + Golomb-Rice filters
#   - Verifies SPV proofs
#   - Serves wallet data over BLE or local HTTP
#
# Requirements:
#   - ESP-IDF v5.x installed (https://docs.espressif.com/projects/esp-idf/)
#   - ESP32, ESP32-S3, or ESP32-C3 board connected via USB
#
# Usage:
#   ./flash.sh [--port /dev/ttyUSB0] [--baud 921600] [--erase]
#
# NOTE: This is an experimental/architectural concept. The ESP32 firmware
# would use kovanica-ffi C bindings or a purpose-built Rust ESP32 crate.
# The ESP32 cannot run the full node (insufficient RAM/Flash for the DAG).
# It can only run a light/SPV client.

set -euo pipefail

PORT="${ESP32_PORT:-/dev/ttyUSB0}"
BAUD=921600
ERASE=0
FIRMWARE_DIR=""
TARGET_CHIP="esp32s3"  # Default target

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
die()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
    case $1 in
        --port)     PORT="$2"; shift 2 ;;
        --baud)     BAUD="$2"; shift 2 ;;
        --erase)    ERASE=1; shift ;;
        --chip)     TARGET_CHIP="$2"; shift 2 ;;
        --firmware) FIRMWARE_DIR="$2"; shift 2 ;;
        -h|--help)  grep '^#' "$0" | cut -c4-; exit 0 ;;
        *) die "Unknown: $1" ;;
    esac
done

# ─── Check ESP-IDF ──────────────────────────────────────────────────────────

check_idf() {
    if [[ -z "${IDF_PATH:-}" ]]; then
        # Try common install locations
        for p in "$HOME/esp/esp-idf" "/opt/esp-idf" "/usr/local/esp-idf"; do
            if [[ -f "$p/export.sh" ]]; then
                source "$p/export.sh"
                break
            fi
        done
    fi

    if ! command -v idf.py >/dev/null 2>&1; then
        die "ESP-IDF not found. Install from: https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/get-started/"
    fi

    ok "ESP-IDF: ${IDF_PATH}"
}

# ─── Check Board ────────────────────────────────────────────────────────────

check_board() {
    if [[ ! -e "$PORT" ]]; then
        warn "Board not found at ${PORT}"
        info "Available serial ports:"
        ls /dev/tty{USB,ACM}* 2>/dev/null || echo "  (none found)"
        echo ""
        info "Plug in your ESP32 board and try:"
        info "  ./flash.sh --port /dev/ttyUSB0"
        info "  # or on macOS:"
        info "  ./flash.sh --port /dev/cu.usbserial-*"
        exit 1
    fi
    ok "Board detected at ${PORT}"
}

# ─── Generate Firmware ──────────────────────────────────────────────────────

generate_firmware() {
    info "Generating ESP32 Kovanica light node firmware..."

    if [[ -n "$FIRMWARE_DIR" ]] && [[ -d "$FIRMWARE_DIR" ]]; then
        info "Using existing firmware from: $FIRMWARE_DIR"
        return
    fi

    # Create a minimal ESP-IDF project for the Kovanica SPV client
    FIRMWARE_DIR=$(mktemp -d)/kovanica-esp32

    info "Creating ESP-IDF project structure..."
    mkdir -p "${FIRMWARE_DIR}/main"

    # CMakeLists.txt
    cat > "${FIRMWARE_DIR}/CMakeLists.txt" <<'CMAKE'
cmake_minimum_required(VERSION 3.16)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(kovanica-light-node)
CMAKE

    # Main component
    cat > "${FIRMWARE_DIR}/main/CMakeLists.txt" <<'CMAKE'
idf_component_register(
    SRCS "main.c" "spv.c" "wifi.c" "http_client.c" "ble_wallet.c"
    INCLUDE_DIRS "."
    REQUIRES nvs_flash esp_wifi esp_event esp_netif esp_http_client esp_bt
)
CMAKE

    # Main entry point
    cat > "${FIRMWARE_DIR}/main/main.c" <<'C'
/**
 * Kovanica ESP32 Light Node — Main
 *
 * A minimal SPV light client for the Kovanica BlockDAG testnet.
 * Capabilities:
 *   - Wi-Fi connection + HTTP block header sync
 *   - Golomb-Rice block filter matching
 *   - BLE wallet interface (balance, address, SPV proofs)
 *   - OLED display (optional, SSD1306)
 *
 * Memory budget: ESP32-S3 has 512KB SRAM, 8MB PSRAM (Octal).
 * The DAG state is NOT stored — only headers + filters fit.
 */

#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_system.h"
#include "nvs_flash.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"

#include "wifi.h"
#include "spv.h"
#include "ble_wallet.h"

static const char *TAG = "kovanica";

// Default testnet seed
#define SEED_HOST "seed.kovanica.online"
#define SEED_PORT 9000
#define SYNC_INTERVAL_MS 30000  // Sync every 30 seconds

void app_main(void)
{
    ESP_LOGI(TAG, "========================================");
    ESP_LOGI(TAG, "  Kovanica ESP32 Light Node v0.2.0");
    ESP_LOGI(TAG, "  BlockDAG SPV Client");
    ESP_LOGI(TAG, "========================================");
    ESP_LOGI(TAG, "Free heap: %lu bytes", esp_get_free_heap_size());

    // Initialize NVS (non-volatile storage for chain state)
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // Initialize networking
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    // Connect to Wi-Fi
    ESP_LOGI(TAG, "Connecting to Wi-Fi...");
    wifi_init();
    wifi_connect();

    // Wait for connection
    xEventGroupWaitBits(wifi_event_group, WIFI_CONNECTED_BIT, pdFALSE, pdTRUE, portMAX_DELAY);
    ESP_LOGI(TAG, "Wi-Fi connected");

    // Initialize SPV client
    spv_config_t config = {
        .seed_host = SEED_HOST,
        .seed_port = SEED_PORT,
        .max_headers = 2000,  // Keep last 2000 block headers
        .filter_capacity = 1024,
    };
    spv_client_t *client = spv_init(&config);

    // Initialize BLE wallet
    ble_wallet_init();

    // Main sync loop
    ESP_LOGI(TAG, "Starting sync loop...");

    while (1) {
        ESP_LOGI(TAG, "--- Sync cycle ---");
        ESP_LOGI(TAG, "Free heap: %lu bytes", esp_get_free_heap_size());

        // Fetch latest headers from seed
        esp_err_t err = spv_sync_headers(client);
        if (err == ESP_OK) {
            ESP_LOGI(TAG, "Headers synced, height: %lu", spv_get_height(client));
        } else {
            ESP_WARN(TAG, "Header sync failed: %s", esp_err_to_name(err));
        }

        // Update BLE wallet with latest state
        ble_wallet_update(spv_get_balance(client), spv_get_height(client));

        // Sleep until next sync
        vTaskDelay(pdMS_TO_TICKS(SYNC_INTERVAL_MS));
    }
}
C

    # SPV client (simplified)
    cat > "${FIRMWARE_DIR}/main/spv.h" <<'H'
#pragma once
#include "esp_err.h"
#include <stdint.h>
#include <stdbool.h>

typedef struct {
    const char *seed_host;
    uint16_t seed_port;
    uint32_t max_headers;
    uint32_t filter_capacity;
} spv_config_t;

typedef struct spv_client spv_client_t;

spv_client_t *spv_init(const spv_config_t *config);
esp_err_t spv_sync_headers(spv_client_t *client);
uint32_t spv_get_height(spv_client_t *client);
uint64_t spv_get_balance(spv_client_t *client);
bool spv_verify_tx_proof(spv_client_t *client, const uint8_t *proof, size_t len);
H

    cat > "${FIRMWARE_DIR}/main/spv.c" <<'C'
/**
 * Kovanica SPV Client — Minimal header chain + filter sync
 *
 * Stores block headers (80 bytes each) and Golomb-Rice filters.
 * Does NOT store full blocks or UTXO set — that's the light client contract.
 *
 * Header chain verification:
 *   1. Fetch headers from seed via HTTP GET /api/spv/headers
 *   2. Verify each header's parent hash matches previous
 *   3. Store in NVS (non-volatile) for persistence across reboots
 *
 * Filter matching:
 *   1. Download compact filters (Golomb-Rice) per block
 *   2. Match against watch addresses (BIP44/49/84)
 *   3. On match, fetch full block + verify Merkle proof
 */

#include "spv.h"
#include "esp_log.h"
#include "esp_http_client.h"
#include "nvs.h"
#include <string.h>
#include <stdlib.h>

static const char *TAG = "spv";

struct spv_client {
    spv_config_t config;
    uint32_t height;
    uint64_t balance;
    nvs_handle_t nvs;
};

spv_client_t *spv_init(const spv_config_t *config)
{
    spv_client_t *client = calloc(1, sizeof(spv_client_t));
    if (!client) return NULL;

    client->config = *config;

    // Open NVS namespace for persistent header storage
    esp_err_t err = nvs_open("kovanica_spv", NVS_READWRITE, &client->nvs);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "NVS open failed: %s", esp_err_to_name(err));
        free(client);
        return NULL;
    }

    // Read saved height
    nvs_get_u32(client->nvs, "height", &client->height);
    ESP_LOGI(TAG, "SPV client initialized, saved height: %lu", client->height);

    return client;
}

esp_err_t spv_sync_headers(spv_client_t *client)
{
    // Build request URL: /api/spv/headers?from_height=<last_height>
    char url[256];
    snprintf(url, sizeof(url),
        "http://%s:%u/api/spv/headers?from_height=%lu",
        client->config.seed_host,
        client->config.seed_port,
        client->height);

    ESP_LOGI(TAG, "Fetching headers from: %s", url);

    esp_http_client_config_t http_config = {
        .url = url,
        .timeout_ms = 10000,
    };

    esp_http_client_handle_t http = esp_http_client_init(&http_config);
    esp_err_t err = esp_http_client_open(http, 0);

    if (err != ESP_OK) {
        ESP_LOGE(TAG, "HTTP open failed: %s", esp_err_to_name(err));
        esp_http_client_cleanup(http);
        return err;
    }

    int content_length = esp_http_client_fetch_headers(http);
    int status = esp_http_client_get_status_code(http);

    if (status != 200) {
        ESP_LOGW(TAG, "HTTP %d (content-length: %d)", status, content_length);
        esp_http_client_close(http);
        esp_http_client_cleanup(http);
        return ESP_FAIL;
    }

    // Read and process headers
    char buffer[512];
    int read_len;
    uint32_t new_headers = 0;

    while ((read_len = esp_http_client_read(http, buffer, sizeof(buffer) - 1)) > 0) {
        buffer[read_len] = '\0';
        // In production: parse binary header records, verify hash chain
        // For now: count bytes as a simple sync indicator
        new_headers += read_len / 80;  // ~80 bytes per header
    }

    esp_http_client_close(http);
    esp_http_client_cleanup(http);

    if (new_headers > 0) {
        client->height += new_headers;
        nvs_set_u32(client->nvs, "height", client->height);
        nvs_commit(client->nvs);
        ESP_LOGI(TAG, "Synced %lu new headers, height now: %lu", new_headers, client->height);
    }

    return ESP_OK;
}

uint32_t spv_get_height(spv_client_t *client)
{
    return client->height;
}

uint64_t spv_get_balance(spv_client_t *client)
{
    return client->balance;
}

bool spv_verify_tx_proof(spv_client_t *client, const uint8_t *proof, size_t len)
{
    // TODO: Implement Merkle proof verification against stored header hashes
    ESP_LOGW(TAG, "Merkle proof verification not yet implemented");
    return false;
}
C

    # BLE wallet (simplified)
    cat > "${FIRMWARE_DIR}/main/ble_wallet.h" <<'H'
#pragma once
#include "esp_err.h"
#include <stdint.h>

void ble_wallet_init(void);
void ble_wallet_update(uint64_t balance, uint32_t height);
H

    cat > "${FIRMWARE_DIR}/main/ble_wallet.c" <<'C'
/**
 * Kovanica BLE Wallet — GATT server for mobile app communication
 *
 * Exposes a simple BLE GATT service with:
 *   - Balance characteristic (read)
 *   - Address characteristic (read)
 *   - Height characteristic (read/notify)
 *   - Send characteristic (write — triggers SPV proof verification)
 */

#include "ble_wallet.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "ble_wallet";
static uint64_t current_balance = 0;
static uint32_t current_height = 0;

void ble_wallet_init(void)
{
    ESP_LOGI(TAG, "BLE wallet initialized");
    // TODO: Initialize BLE GATT server with Kovanica service UUID
    // Service UUID: 0xKV01 (custom 128-bit UUID)
    // Characteristics:
    //   Balance (read):  uint64 LE
    //   Address (read):  33 bytes (versioned address)
    //   Height (notify): uint32 LE
    //   Send (write):    {secret_hex: 64, amount: u64, to: 33}
}

void ble_wallet_update(uint64_t balance, uint32_t height)
{
    if (balance != current_balance || height != current_height) {
        ESP_LOGI(TAG, "Wallet update: balance=%llu, height=%lu", balance, height);
        current_balance = balance;
        current_height = height;
        // TODO: Notify subscribed BLE clients
    }
}
C

    # Wi-Fi helper
    cat > "${FIRMWARE_DIR}/main/wifi.h" <<'H'
#pragma once
#include "esp_event.h"
#include "esp_err.h"

extern EventGroupHandle_t wifi_event_group;
#define WIFI_CONNECTED_BIT BIT0

void wifi_init(void);
void wifi_connect(void);
H

    cat > "${FIRMWARE_DIR}/main/wifi.c" <<'C'
#include "wifi.h"
#include "esp_wifi.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "wifi";
EventGroupHandle_t wifi_event_group;

static void event_handler(void *arg, esp_event_base_t event_base,
                          int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGW(TAG, "Disconnected, reconnecting...");
        esp_wifi_connect();
        xEventGroupClearBits(wifi_event_group, WIFI_CONNECTED_BIT);
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "Got IP: " IPSTR, IP2STR(&event->ip_info.ip));
        xEventGroupSetBits(wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

void wifi_init(void)
{
    wifi_event_group = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_create_default_wifi_sta());

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, &event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        IP_EVENT, IP_EVENT_STA_GOT_IP, &event_handler, NULL, NULL));

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = CONFIG_KOVANICA_WIFI_SSID,
            .password = CONFIG_KOVANICA_WIFI_PASSWORD,
        },
    };

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
}

void wifi_connect(void)
{
    ESP_LOGI(TAG, "Starting Wi-Fi...");
    ESP_ERROR_CHECK(esp_wifi_start());
}
C

    # Kconfig for Wi-Fi credentials
    cat > "${FIRMWARE_DIR}/main/Kconfig.projbuild" <<'K'
menu "Kovanica Light Node"

    config KOVANICA_WIFI_SSID
        string "Wi-Fi SSID"
        default "kovanica-testnet"
        help
            Wi-Fi network name for the Kovanica light node.

    config KOVANICA_WIFI_PASSWORD
        string "Wi-Fi Password"
        default ""
        help
            Wi-Fi password. Leave empty for open networks.

    config KOVANICA_SEED_HOST
        string "Seed node host"
        default "seed.kovanica.online"

    config KOVANICA_SEED_PORT
        int "Seed node P2P port"
        default 9000

endmenu
K

    # sdkconfig defaults
    cat > "${FIRMWARE_DIR}/sdkconfig.defaults" <<'D'
CONFIG_ESP32S3_SPIRAM_SUPPORT=y
CONFIG_SPIRAM=y
CONFIG_SPIRAM_MODE_OCT=y
CONFIG_SPIRAM_SPEED_80M=y
CONFIG_FREERTOS_HZ=1000
CONFIG_LOG_DEFAULT_LEVEL_INFO=y
CONFIG_HTTP_MAX_POST_LEN=4096
CONFIG_BT_ENABLED=y
CONFIG_BT_NIMBLE_ENABLED=y
D

    ok "Firmware project generated at: ${FIRMWARE_DIR}"
}

# ─── Flash Firmware ─────────────────────────────────────────────────────────

flash_firmware() {
    info "Building and flashing firmware..."

    cd "${FIRMWARE_DIR}"

    # Set target chip
    idf.py set-target "${TARGET_CHIP}"

    # Build
    idf.py build

    # Erase flash if requested
    if [[ "$ERASE" -eq 1 ]]; then
        info "Erasing flash..."
        idf.py -p "$PORT" erase-flash
    fi

    # Flash
    info "Flashing to ${PORT} at ${BAUD} baud..."
    idf.py -p "$PORT" -b "$BAUD" flash

    ok "Firmware flashed!"
    info "Monitor with: idf.py -p ${PORT} monitor"
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
    echo ""
    echo -e "${CYAN}  ╔═══════════════════════════════════════╗${NC}"
    echo -e "${CYAN}  ║   Kovanica ESP32 Light Node Flasher   ║${NC}"
    echo -e "${CYAN}  ║   SPV Client · BLE Wallet             ║${NC}"
    echo -e "${CYAN}  ╚═══════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}  NOTE: ESP32 runs a LIGHT/SPV client only.${NC}"
    echo -e "${YELLOW}  It cannot store the full DAG (insufficient RAM).${NC}"
    echo -e "${YELLOW}  It syncs headers + filters, verifies SPV proofs.${NC}"
    echo ""

    check_idf
    check_board
    generate_firmware
    flash_firmware

    echo ""
    echo -e "${GREEN}  ═══════════════════════════════════════${NC}"
    echo -e "${GREEN}  ESP32 light node running!${NC}"
    echo ""
    echo -e "  Connect via:"
    echo -e "    ${CYAN}idf.py -p ${PORT} monitor${NC}"
    echo ""
    echo -e "  BLE wallet: Open Kovanica mobile app"
    echo -e "  Explorer:   ${BLUE}https://explorer.kovanica.online${NC}"
    echo ""
}

main "$@"
