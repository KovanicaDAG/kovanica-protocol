#!/usr/bin/env bash
# P2P gossip inspection for Kovanica nodes.
# Usage: ./p2p-sniff.sh [interface] [port]
# Requires: tcpdump, tshark (optional for decode)

IFACE="${1:-eth0}"
PORT="${2:-9000}"

echo "=== Kovanica P2P Sniff ==="
echo "Interface: $IFACE"
echo "Port: $PORT"
echo ""

# Count packets by direction
echo "--- Packet summary (10s capture) ---"
sudo tcpdump -i "$IFACE" -c 100 -nn "tcp port $PORT" -q 2>/dev/null | \
  awk '{print $3, $5}' | sort | uniq -c | sort -rn | head -20

echo ""
echo "--- Protocol decode (first 20 packets) ---"
sudo tcpdump -i "$IFACE" -c 20 -nn -A "tcp port $PORT" 2>/dev/null | \
  head -100

echo ""
echo "--- Connection peers ---"
sudo tcpdump -i "$IFACE" -c 50 -nn "tcp port $PORT" 2>/dev/null | \
  awk '{print $3, $5}' | grep -oP '\d+\.\d+\.\d+\.\d+' | sort -u

echo ""
echo "--- Bandwidth (10s sample) ---"
sudo timeout 10 tcpdump -i "$IFACE" -nn "tcp port $PORT" -q 2>/dev/null | \
  wc -l | xargs -I{} echo "{} packets in 10s"
