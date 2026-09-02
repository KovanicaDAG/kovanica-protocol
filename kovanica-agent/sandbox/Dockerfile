# Ephemeral, per-request sandbox for running cargo against the Kovanica repo.
# Never run this container long-lived. agent-api spawns one instance per
# cargo call, with --rm, then throws it away.
#
# Recommended host runtime: gVisor (runsc) or Sysbox instead of plain runc.
# Set at spawn time (docker SDK: `runtime="runsc"`), not here — the runtime
# is a host-level flag, not something the image controls.

FROM rust:1.82-slim-bookworm

RUN groupadd -r sandbox && useradd -r -g sandbox -m -d /home/sandbox sandbox

# Minimal build deps only. Deliberately no curl/wget/ssh/git — this container
# runs with network_disabled=True, so network tools have no legitimate use
# and only help an escape attempt.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Pre-vendor dependencies at image build time (network allowed here, at
# build time only) so requests can run fully offline. Adjust path/COPY to
# your actual crate layout before building.
# COPY Cargo.toml Cargo.lock /workspace/
# RUN cd /workspace && cargo fetch

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && \
    chown -R sandbox:sandbox /home/sandbox

WORKDIR /workspace
USER sandbox

ENV CARGO_HOME=/home/sandbox/.cargo \
    CARGO_TARGET_DIR=/tmp/target

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
