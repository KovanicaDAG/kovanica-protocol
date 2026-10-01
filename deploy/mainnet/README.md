# Kovanica Mainnet

Network ID: `kovanica-mainnet`

## Status

- **Live**: No — launching soon
- **Explorer**: https://mainnet.kovanica.online
- **API**: https://mainnet.kovanica.online/api

## Network Parameters

| Parameter | Value |
|-----------|-------|
| Consensus | GHOSTDAG k=3, PoA |
| Block time | TBD |
| Subsidy | 10 KVNC/block |
| Era length | 2,050,000 blocks |
| Decay α | 3/4 per era |
| Max supply | 90.2M KVNC |
| Maturity | 100 blocks |
| Fee split | 75% burn / 25% producer |
| P2P port | 9000 (TCP) |

## Genesis

Genesis block hash: TBD (pending mainnet launch)

## Quick Start

```sh
KOVANICA_LISTEN=0.0.0.0:9000 \
KOVANICA_DATA=/root/kovanica-mainnet-data \
./target/release/kovanica-node explorer 127.0.0.1:8080
```

## Documentation

- [Protocol docs](https://docs.kovanica.online)
- [Mainnet criteria](https://docs.kovanica.online/mainnet-criteria)
