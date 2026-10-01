.PHONY: test example check wasm

test:
	cargo test --workspace

example:
	cargo run -p kovanica-sdk --example generate_wallet

check:
	cargo check --workspace

wasm:
	wasm-pack build bindings/kovanica-wasm --target web --out-dir ../../pkg
