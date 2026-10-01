# Kovanica Testnet

Network ID: `kovanica-testnet`

## Status

- **Live**: Yes
- **Explorer**: https://testnet.kovanica.online
- **API**: https://testnet.kovanica.online/api
- **Faucet**: https://faucet.testnet.kovanica.online

## Network Parameters

| Parameter | Value |
|-----------|-------|
| Consensus | GHOSTDAG k=3, PoA |
| Block time | ~60s (target) |
| Subsidy | 10 KVNC/block |
| Era length | 2,050,000 blocks |
| Decay α | 3/4 per era |
| Max supply | 90.2M KVNC |
| Maturity | 100 blocks |
| Fee split | 75% burn / 25% producer |
| P2P port | 9000 (TCP) |

## Quick Start

```sh
KOVANICA_LISTEN=0.0.0.0:9000 \
KOVANICA_PEERS=seed.kovanica.online:9000 \
KOVANICA_DATA=/root/kovanica-data \
./target/release/kovanica-node explorer 127.0.0.1:8080
```

## Seed Nodes

- `seed.kovanica.online:9000` (DNS-only, grey cloud)
- `seed2.kovanica.online:9000`

## Documentation

- [Protocol docs](https://docs.kovanica.online)
- [API reference](https://docs.kovanica.online/api)
- [Node operator guide](https://docs.kovanica.online/node-operations)
