# Makefile for Kovanica Ledger App
#
# Builds the Rust core + C UI/APDU dispatcher, links together,
# produces .elf for Ledger device.

# ============================================================================
# Configuration
# ============================================================================

# App info
APPNAME     = Kovanica
APPVERSION  = 0.1.0
BINARY      = $(APPNAME)

# SDK
BOLOS_SDK   ?= $(HOME)/ledger-sdk
BOLOS_ENV   ?= $(BOLOS_SDK)/bolosenv.py

# Target
TARGET      = thumbv6m-none-eabi
ARCH        = arm

# Rust
RUST_TARGET = $(TARGET)
CARGO       = cargo
RUSTFLAGS   = -C opt-level=z -C lto=yes -C codegen-units=1 -C panic=abort

# Paths
SRC_RUST    = src/rust
SRC_C       = src/c
BUILD       = build
TARGET_DIR  = $(BUILD)/target/$(RUST_TARGET)/release
RUST_LIB    = $(TARGET_DIR)/libkovanica_ledger.a

# C compiler
CC          = $(BOLOS_SDK)/clang/bin/clang
CFLAGS      = -Os -Wall -Wextra -Wno-unused-parameter -Wno-unused-variable \
              -I$(BOLOS_SDK)/include -I$(SRC_C)/include \
              -DBOLOS_SDK=\"$(BOLOS_SDK)\" \
              -DAPPVERSION=\"$(APPVERSION)\" \
              -DAPPNAME=\"$(APPNAME)\"

# Linker
LD          = $(BOLOS_SDK)/clang/bin/clang
LDFLAGS     = -Wl,--gc-sections -Wl,-z,max-page-size=256 \
              -L$(BOLOS_SDK)/lib -L$(TARGET_DIR) \
              -nostartfiles -nostdlib \
              -T$(BOLOS_SDK)/linker_scripts/ledger_app.ld

# Libraries
LIBS        = -lkovanica_ledger -lm -lc -lgcc -lnosys

# ============================================================================
# Targets
# ============================================================================

.PHONY: all clean load delete test

all: $(BUILD)/$(BINARY).elf

# Build Rust library
$(RUST_LIB):
	@mkdir -p $(TARGET_DIR)
	cd $(SRC_RUST) && \
	CARGO_TARGET_DIR=../../$(BUILD)/target \
	$(CARGO) build --target $(RUST_TARGET) --release $(if $(filter std,$(FEATURES)),--features std,)

# Build C objects
$(BUILD)/%.o: $(SRC_C)/%.c
	@mkdir -p $(@D)
	$(CC) $(CFLAGS) -c $< -o $@

C_OBJS = \
    $(BUILD)/c/src/main.o \
    $(BUILD)/c/src/ui.o \
    $(BUILD)/c/src/kovanica.o \
    $(BUILD)/c/src/crypto.o

# Link final binary
$(BUILD)/$(BINARY).elf: $(RUST_LIB) $(C_OBJS)
	@mkdir -p $(BUILD)
	$(LD) $(LDFLAGS) -o $@ $(C_OBJS) $(LIBS)
	@echo "Built $@"

# Load app to device (via ledgerctl or ledgerctl.py)
load: $(BUILD)/$(BINARY).elf
	@echo "Loading app to device..."
	ledgerctl load --target $(BUILD)/$(BINARY).elf --app-name $(APPNAME) || \
	python3 $(BOLOS_SDK)/ledgerctl.py load --target $(BUILD)/$(BINARY).elf --app-name $(APPNAME)

# Delete app from device
delete:
	@echo "Deleting app from device..."
	ledgerctl delete --app-name $(APPNAME) || \
	python3 $(BOLOS_SDK)/ledgerctl.py delete --app-name $(APPNAME)

# Run Rust tests
test:
	cd $(SRC_RUST) && cargo test --target $(RUST_TARGET) --features std

# Clean
clean:
	rm -rf $(BUILD)
	cd $(SRC_RUST) && cargo clean

# Check formatting
fmt:
	cd $(SRC_RUST) && cargo fmt --check

# Lint
clippy:
	cd $(SRC_RUST) && cargo clippy --target $(RUST_TARGET) -- -D warnings

# Install Rust target
install-target:
	rustup target add $(RUST_TARGET)

# Verify build environment
check-env:
	@echo "BOLOS_SDK: $(BOLOS_SDK)"
	@echo "CC: $(CC)"
	@echo "Rust target: $(RUST_TARGET)"
	@which $(CC)
	@rustup target list --installed | grep $(RUST_TARGET)

# Build for Ledger Live (creates .zip with manifest)
package: $(BUILD)/$(BINARY).elf
	@mkdir -p $(BUILD)/package
	cp $(BUILD)/$(BINARY).elf $(BUILD)/package/
	# Create manifest
	@echo '{"name":"$(APPNAME)","version":"$(APPVERSION)","icon":"icon.png"}' > $(BUILD)/package/manifest.json
	cd $(BUILD)/package && zip -r ../$(APPNAME)-$(APPVERSION).zip .
	@echo "Package created: $(BUILD)/$(APPNAME)-$(APPVERSION).zip"

# Debug build
debug: FEATURES = std
debug: $(BUILD)/$(BINARY).elf

# Size report
size: $(BUILD)/$(BINARY).elf
	@arm-none-eabi-size -A $<

# Help
help:
	@echo "Kovanica Ledger App Makefile"
	@echo ""
	@echo "Targets:"
	@echo "  all       - Build app (default)"
	@echo "  load      - Load app to connected Ledger device"
	@echo "  delete    - Delete app from device"
	@echo "  test      - Run Rust tests"
	@echo "  clean     - Clean build artifacts"
	@echo "  fmt       - Check formatting"
	@echo "  clippy    - Run linter"
	@echo "  package   - Create Ledger Live package"
	@echo "  check-env - Verify build environment"
	@echo ""
	@echo "Environment:"
	@echo "  BOLOS_SDK=$(BOLOS_SDK)"