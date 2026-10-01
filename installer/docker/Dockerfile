# Kovanica node — container image
#
# Network selection is NOT an image concern. `NetworkProfile` in
# kovanica-node/src/explorer.rs compiles k, subsidy, premine and finality into
# the binary, and KOVANICA_MAINNET_OVERRIDE=1 is the only way to reach the
# dormant mainnet profile. That guardrail is deliberately left in the binary
# rather than exposed as a compose toggle.

FROM rust:1.98-slim AS builder

WORKDIR /app
# The cargo workspace is protocol/, not the repo root (there is no root
# Cargo.toml). Copy the manifest + lockfile first so dependency compilation is
# cached independently of source edits.
COPY protocol/Cargo.toml protocol/Cargo.lock ./
COPY protocol/crates ./crates

RUN cargo build --release -p kovanica-node && strip target/release/kovanica-node

# ─── Runtime ────────────────────────────────────────────────────────────────

FROM debian:bookworm-slim

RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/kovanica-node /usr/local/bin/kovanica-node

RUN useradd --system --no-create-home --shell /usr/sbin/nologin kovanica && \
    mkdir -p /var/lib/kovanica && \
    chown kovanica:kovanica /var/lib/kovanica

USER kovanica
WORKDIR /var/lib/kovanica

# The address is a CLI argument (`explorer <addr>`), not an env var.
ENV KOVANICA_DATA=/var/lib/kovanica

EXPOSE 8080 9000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:8080/api/head || exit 1

ENTRYPOINT ["kovanica-node"]
CMD ["explorer", "0.0.0.0:8080"]
