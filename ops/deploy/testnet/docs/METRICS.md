# Testnet Metrics

## Live Stats

| Metric | Value |
|--------|-------|
| Block height | TBD |
| Total supply | TBD |
| Active peers | TBD |
| TPS | TBD |
| Avg block time | TBD |

## Supply Tracking

| Era | Height Range | Subsidy/block | Era Total |
|-----|-------------|---------------|-----------|
| 0 | 0 – 2,049,999 | 10 KVNC | 20.5M KVNC |
| 1 | 2,050,000 – 4,099,999 | 7.5 KVNC | 15.375M KVNC |
| 2 | 4,100,000 – 6,149,999 | 5.625 KVNC | 11.53M KVNC |
| ... | ... | ... | ... |

## Health Checks

```sh
# Chain head
curl -s https://testnet.kovanica.online/api/head | jq

# Bootstrap
curl -s https://testnet.kovanica.online/api/bootstrap | jq

# Supply
curl -s https://testnet.kovanica.online/api/supply | jq
```
