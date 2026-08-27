# Kovanica Native Blake3 Pool Setup

This directory contains the scripts and configurations required to set up a Go-based stratum mining pool for Kovanica using the Blake3 hashing algorithm.

## Prerequisites

- A Linux server (Ubuntu 20.04/22.04 or Debian recommended).
- Kovanica Node compiled and running in the background with RPC enabled.
- Go installed (1.20+ recommended).

## Setup Instructions

1. **Install Dependencies**
   Run the installation script to install Redis, MySQL, Nginx, and Go:
   ```bash
   chmod +x install_pool_deps.sh
   ./install_pool_deps.sh
   ```

2. **Configure Database**
   Configure your preferred backend if applicable to the Go stratum pool extension.

3. **Compile and Install Go Pool**
   Clone or navigate to the go-pool directory and compile:
   ```bash
   cd /root/kovanica-hash/pool/go-pool
   go mod tidy
   go build -o kovanica-pool main.go
   ```

4. **Start the Pool**
   Run the newly compiled binary. Use a process manager like PM2, systemd, or run directly:
   ```bash
   ./kovanica-pool
   ```

Your Kovanica Blake3 Go mining pool should now be running!
