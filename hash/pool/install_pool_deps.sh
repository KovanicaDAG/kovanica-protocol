#!/bin/bash
# install_pool_deps.sh
# Script to install dependencies for the Kovanica Native Blake3 Pool (NOMP-based)

set -e

echo "Updating package lists..."
sudo apt-get update -y

echo "Installing essential build tools..."
sudo apt-get install -y build-essential libtool autotools-dev automake pkg-config libssl-dev libevent-dev bsdmainutils python3

echo "Installing Redis..."
sudo apt-get install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server

echo "Installing MySQL (MariaDB)..."
sudo apt-get install -y mariadb-server
sudo systemctl enable mariadb
sudo systemctl start mariadb

echo "Securing MySQL (Run mysql_secure_installation manually later)"
# sudo mysql_secure_installation

echo "Installing Nginx..."
sudo apt-get install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx

echo "Installing Node.js and npm (required for NOMP)..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "Installing PM2 for process management..."
sudo npm install -g pm2

echo "Dependencies installed successfully."
echo "Next steps:"
echo "1. Configure MySQL database for the pool."
echo "2. Clone NOMP repository and install node modules."
echo "3. Configure NOMP with Kovanica Blake3 settings."
