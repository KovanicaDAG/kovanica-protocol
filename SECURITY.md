# Security Policy

## Status: not audited

The Kovanica protocol is a **public testnet** implementation and has **not been
audited**. Do not use it to custody value you cannot afford to lose. Parameters
marked `pending` in [`protocol-params.toml`](./protocol-params.toml) are expected
to change before mainnet.

There is currently **no bug bounty**. We still want to hear about security
issues.

## Reporting a vulnerability

Report vulnerabilities **privately** by email:

**kovanicaprotokol@gmail.com**

Please do **not** open a public issue, discussion, or pull request for a
security problem before it has been triaged.

Include, where possible:

- a description of the issue and its impact,
- the affected component or parameter,
- steps to reproduce (a minimal proof of concept is ideal),
- the version / commit you tested against,
- any suggested fix or mitigation.

## Scope

In scope:

- consensus and DAG ordering,
- the UTXO/account ledger and supply accounting,
- transaction and vote signature verification,
- P2P/gossip handling and peer trust boundaries,
- the WASM contract runtime.

Out of scope for private reporting: parameter values that are already marked
`pending` (they are documented as subject to change), and issues that require a
compromised local machine or leaked client-side key material.

## Disclosure

We will acknowledge receipt, work on a fix, and coordinate disclosure timing
with you. Please give us a reasonable window before any public disclosure.
