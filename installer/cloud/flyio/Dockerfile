#!/usr/bin/env bash
# Kovanica Protocol — Fly.io Dockerfile (minimal, for Fly.io / Railway / Render)

FROM rust:1.98-slim AS builder

WORKDIR /app
RUN apt-get update -qq && apt-get install -y -qq pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY . .
RUN cargo build --release -p kovanica-node

FROM debian:bookworm-slim
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates curl && \
    rm -rf /var/lib/apt/lists/* && \
    useradd --system --no-create-home --shell /usr/sbin/nologin kovanica && \
    mkdir -p /var/lib/kovanica && chown kovanica:kovanica /var/lib/kovanica

COPY --from=builder /app/target/release/kovanica-node /usr/local/bin/kovanica-node
USER kovanica
ENV KOVANICA_DATA=/var/lib/kovanica KOVANICA_P2P_PORT=9000 KOVANICA_HTTP_PORT=8080 \
    KOVANICA_PEERS="seed.kovanica.online:9000,seed2.kovanica.online:9000"
EXPOSE 9000 8080
ENTRYPOINT ["kovanica-node"]
CMD ["serve"]
