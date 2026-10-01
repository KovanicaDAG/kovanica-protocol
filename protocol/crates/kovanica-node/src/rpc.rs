//! The node's line RPC: one text command per line in, one line out.
//!
//! [`execute_line`] is a pure function of the node and the command string — it
//! returns the response rather than doing any I/O — so the whole protocol is
//! unit-testable without a socket or a process. The binary ([`crate`]'s `main`)
//! wires it to stdin/stdout (`serve`) or replays a scripted `demo`.
//!
//! Every response begins with `ok` or `err`. Commands:
//!
//! ```text
//! help                                list commands
//! genesis <k> <subsidy> <amount> <seed>   create the genesis ledger
//! address <seed>                      the address for an actor seed
//! balance <seed|addr-hex>             spendable balance
//! send <from-seed> <amount> <to-seed> transfer, as a new block on the tips
//! tips                                current tip block ids
//! tip                                 selected (heaviest) tip
//! len                                 number of blocks
//! save <path> / load <path>          snapshot persistence
//! checkpoint <path> / load_checkpoint <path>  finality checkpoint persistence
//! ```

use kovanica_state::{Address, HtlcScript, KeyPair, OutPoint, TxId, VaultScript};

use crate::node::Node;

/// The help text listing every command.
pub const HELP: &str = "commands: help | genesis <k> <subsidy> <amount> <seed> | \
genesis_finality <k> <subsidy> <amount> <seed> <finality_depth> | \
genesis_poa <k> <subsidy> <amount> <seed> <finality_depth> <slot_duration> <authorities...> | \
authority_key <key-hex> | authority_update <update-tx-hex> | \
address <seed> | balance <seed|addr-hex> | send <from-seed> <amount> <to-seed> | \
pool <from-seed> <amount> <to-seed> | produce | pending | tips | tip | len | \
save <path> | load <path> | checkpoint <path> | load_checkpoint <path> | \
htlc_create <from-seed> <amount> <recipient-pk-hex> <preimage-hash-hex> <timeout> | \
htlc_redeem <from-seed> <outpoint-tx-hex> <outpoint-index> <script-hex> <preimage-hex> <to-addr> | \
htlc_refund <from-seed> <outpoint-tx-hex> <outpoint-index> <script-hex> <to-addr> | \
htlc_balance <script-hex> | \
vault_create <from-seed> <amount> <unlock-height> <csv> <owner-pk-hex> | \
vault_release <from-seed> <outpoint-tx-hex> <outpoint-index> <script-hex> <to-addr> | \
vault_balance <script-hex>";

/// Run one command line against `node`, returning the response line. Never
/// panics on bad input; malformed commands produce an `err ...` response.
pub fn execute_line(node: &mut Node, line: &str) -> String {
    match run(node, line) {
        Ok(msg) if msg.is_empty() => "ok".to_string(),
        Ok(msg) => format!("ok {msg}"),
        Err(e) => format!("err {e}"),
    }
}

fn run(node: &mut Node, line: &str) -> Result<String, String> {
    let mut tokens = line.split_whitespace();
    let Some(cmd) = tokens.next() else {
        return Ok(String::new()); // blank line
    };
    let args: Vec<&str> = tokens.collect();

    match cmd {
        "help" => Ok(HELP.to_string()),

        "genesis" => {
            let [k, subsidy, amount, seed] = fixed::<4>(&args)?;
            let (genesis, founder) = node
                .genesis(
                    u16_arg(k)?,
                    u64_arg(subsidy)?,
                    u64_arg(amount)?,
                    u64_arg(seed)?,
                    None, // RPC genesis is treasury-less; the explorer profile opts in explicitly
                )
                .map_err(|e| e.to_string())?;
            Ok(format!("genesis {genesis} founder {founder}"))
        }

        "genesis_finality" => {
            let [k, subsidy, amount, seed, finality_depth] = fixed::<5>(&args)?;
            let (genesis, founder) = node
                .genesis_with_finality(
                    u16_arg(k)?,
                    u64_arg(subsidy)?,
                    u64_arg(amount)?,
                    u64_arg(seed)?,
                    None, // RPC genesis is treasury-less; the explorer profile opts in explicitly
                    u64_arg(finality_depth)?,
                    u64::MAX,
                    u64::MAX, // block pruning: RPC genesis keeps the full oracle
                    None,     // operator_seed: None for manual genesis
                )
                .map_err(|e| e.to_string())?;
            Ok(format!("genesis {genesis} founder {founder}"))
        }

        "genesis_poa" => {
            // genesis_poa <k> <subsidy> <amount> <seed> <finality_depth> <slot_duration> <authority1-hex> [<authority2-hex> ...]
            if args.len() < 6 {
                return Err("genesis_poa needs at least 6 args: k subsidy amount seed finality_depth slot_duration authority1-hex [authority2-hex...]".into());
            }
            let k = u16_arg(args[0])?;
            let subsidy = u64_arg(args[1])?;
            let amount = u64_arg(args[2])?;
            let seed = u64_arg(args[3])?;
            let finality_depth = u64_arg(args[4])?;
            let slot_duration = u64_arg(args[5])?;
            // Parse authority public keys (64 hex chars each)
            let mut pks = Vec::new();
            for hex in &args[6..] {
                let hex = hex.trim();
                if hex.len() != 64 {
                    return Err(format!(
                        "authority key must be 64 hex chars (got '{}')",
                        hex
                    ));
                }
                let mut pk = [0u8; 32];
                hex::decode_to_slice(hex, &mut pk)
                    .map_err(|e| format!("bad authority key hex: {e}"))?;
                pks.push(pk);
            }
            if pks.len() < 3 {
                return Err("need at least 3 authority keys".into());
            }
            // Build AuthoritySet with strict majority threshold
            let threshold = pks.len() / 2 + 1;
            let mut bytes = Vec::with_capacity(16 + 32 * pks.len());
            bytes.extend_from_slice(&(threshold as u64).to_le_bytes());
            bytes.extend_from_slice(&(pks.len() as u64).to_le_bytes());
            for pk in &pks {
                bytes.extend_from_slice(pk);
            }
            let authority_set = kovanica_dag::AuthoritySet::from_bytes(&bytes)
                .map_err(|e| format!("invalid authority set: {e}"))?;
            let (genesis, founder) = node
                .genesis_with_poa(
                    k,
                    subsidy,
                    amount,
                    seed,
                    None, // RPC genesis is treasury-less
                    finality_depth,
                    u64::MAX,
                    u64::MAX, // block pruning: RPC genesis keeps the full oracle
                    None,     // operator_seed: None for manual genesis
                    authority_set,
                    slot_duration,
                )
                .map_err(|e| e.to_string())?;
            Ok(format!("genesis {genesis} founder {founder}"))
        }

        "authority_key" => {
            // authority_key <64-hex-signing-key>
            let [key_hex] = fixed::<1>(&args)?;
            let key_hex = key_hex.trim();
            if key_hex.len() != 64 {
                return Err("authority_key must be 64 hex chars (32 bytes)".into());
            }
            let mut key = [0u8; 32];
            hex::decode_to_slice(key_hex, &mut key)
                .map_err(|e| format!("bad authority key hex: {e}"))?;
            node.set_authority_signing_key(key);
            Ok("authority key set".into())
        }

        "authority_update" => {
            // authority_update <update-tx-hex>
            // Applies an on-chain authority set update (RFC-POA §1, KVP-201).
            let [update_hex] = fixed::<1>(&args)?;
            let update_hex = update_hex.trim();
            let update_bytes =
                hex::decode(update_hex).map_err(|e| format!("bad update hex: {e}"))?;
            let update = kovanica_dag::AuthorityUpdateTx::from_bytes(&update_bytes)
                .map_err(|e| format!("invalid authority update: {e}"))?;
            let new_set = node
                .apply_authority_update(&update)
                .map_err(|e| format!("authority update rejected: {e}"))?;
            Ok(format!(
                "authority set updated: {} authorities, threshold {}",
                new_set.authorities().len(),
                new_set.threshold()
            ))
        }

        "address" => {
            let [seed] = fixed::<1>(&args)?;
            Ok(Node::address(u64_arg(seed)?).to_string())
        }

        "balance" => {
            let [target] = fixed::<1>(&args)?;
            let addr = parse_target(target)?;
            Ok(node.balance(&addr).map_err(|e| e.to_string())?.to_string())
        }

        "send" => {
            let [from, amount, to] = fixed::<3>(&args)?;
            let sent = node
                .send(u64_arg(from)?, u64_arg(amount)?, u64_arg(to)?)
                .map_err(|e| e.to_string())?;
            Ok(format!("block {} tx {}", sent.block, sent.tx))
        }

        "pool" => {
            let [from, amount, to] = fixed::<3>(&args)?;
            let tx = node
                .pool(u64_arg(from)?, u64_arg(amount)?, u64_arg(to)?)
                .map_err(|e| e.to_string())?;
            Ok(format!("tx {tx}"))
        }

        "produce" => {
            let [] = fixed::<0>(&args)?;
            match node.produce_block().map_err(|e| e.to_string())? {
                Some(block) => Ok(format!("block {block}")),
                None => Ok("empty".to_string()),
            }
        }

        "pending" => {
            let [] = fixed::<0>(&args)?;
            Ok(node.pending_count().to_string())
        }

        "tips" => {
            let tips = node.tips().map_err(|e| e.to_string())?;
            Ok(tips
                .iter()
                .map(|b| b.to_string())
                .collect::<Vec<_>>()
                .join(" "))
        }

        "tip" => Ok(node.selected_tip().map_err(|e| e.to_string())?.to_string()),

        "htlc_create" => {
            let [from, amount, recipient_pk_hex, preimage_hash_hex, timeout] = fixed::<5>(&args)?;
            let kp = KeyPair::from_u64(u64_arg(from)?);
            let mut recipient_pk = [0u8; 32];
            hex::decode_to_slice(recipient_pk_hex, &mut recipient_pk)
                .map_err(|e| format!("bad recipient-pk-hex: {e}"))?;
            let mut preimage_hash = [0u8; 32];
            hex::decode_to_slice(preimage_hash_hex, &mut preimage_hash)
                .map_err(|e| format!("bad preimage-hash-hex: {e}"))?;
            let info = node
                .create_htlc(
                    &kp,
                    u64_arg(amount)?,
                    None,
                    recipient_pk,
                    preimage_hash,
                    u32_arg(timeout)?,
                )
                .map_err(|e| e.to_string())?;
            Ok(format!(
                "{} {} {}",
                info.tx_id,
                hex::encode(info.script.bytes()),
                info.address
            ))
        }

        "htlc_redeem" => {
            let [from, outpoint_tx_hex, outpoint_index, script_hex, preimage_hex, to_addr] =
                fixed::<6>(&args)?;
            let kp = KeyPair::from_u64(u64_arg(from)?);
            let outpoint = parse_outpoint(outpoint_tx_hex, outpoint_index)?;
            let script = parse_htlc_script(script_hex)?;
            let preimage =
                hex::decode(preimage_hex).map_err(|e| format!("bad preimage-hex: {e}"))?;
            let to = Address::parse(to_addr).map_err(|e| e.to_string())?;
            let tx_id = node
                .redeem_htlc(&kp, outpoint, &script, &preimage, to)
                .map_err(|e| e.to_string())?;
            Ok(tx_id.to_string())
        }

        "htlc_refund" => {
            let [from, outpoint_tx_hex, outpoint_index, script_hex, to_addr] = fixed::<5>(&args)?;
            let kp = KeyPair::from_u64(u64_arg(from)?);
            let outpoint = parse_outpoint(outpoint_tx_hex, outpoint_index)?;
            let script = parse_htlc_script(script_hex)?;
            let to = Address::parse(to_addr).map_err(|e| e.to_string())?;
            let tx_id = node
                .refund_htlc(&kp, outpoint, &script, to)
                .map_err(|e| e.to_string())?;
            Ok(tx_id.to_string())
        }

        "htlc_balance" => {
            let [script_hex] = fixed::<1>(&args)?;
            let script = parse_htlc_script(script_hex)?;
            Ok(node.balance_of_htlc(&script).to_string())
        }

        "vault_create" => {
            let [from, amount, unlock_height, csv, owner_pk_hex] = fixed::<5>(&args)?;
            let kp = KeyPair::from_u64(u64_arg(from)?);
            let mut owner_pk = [0u8; 32];
            hex::decode_to_slice(owner_pk_hex, &mut owner_pk)
                .map_err(|e| format!("bad owner-pk-hex: {e}"))?;
            let info = node
                .create_vault(
                    &kp,
                    u64_arg(amount)?,
                    u32_arg(unlock_height)?,
                    u32_arg(csv)?,
                    owner_pk,
                )
                .map_err(|e| e.to_string())?;
            Ok(format!(
                "{} {} {}",
                info.tx_id,
                hex::encode(info.script.bytes()),
                info.address
            ))
        }

        "vault_release" => {
            let [from, outpoint_tx_hex, outpoint_index, script_hex, to_addr] = fixed::<5>(&args)?;
            let kp = KeyPair::from_u64(u64_arg(from)?);
            let outpoint = parse_outpoint(outpoint_tx_hex, outpoint_index)?;
            let script = parse_vault_script(script_hex)?;
            let to = Address::parse(to_addr).map_err(|e| e.to_string())?;
            let tx_id = node
                .release_vault(&kp, outpoint, &script, to)
                .map_err(|e| e.to_string())?;
            Ok(tx_id.to_string())
        }

        "vault_balance" => {
            let [script_hex] = fixed::<1>(&args)?;
            let script = parse_vault_script(script_hex)?;
            Ok(node.balance_of_vault(&script).to_string())
        }

        "len" => Ok(node.block_count().map_err(|e| e.to_string())?.to_string()),

        "save" => {
            let [path] = fixed::<1>(&args)?;
            node.save(path).map_err(|e| e.to_string())?;
            Ok(format!("saved {path}"))
        }

        "load" => {
            let [path] = fixed::<1>(&args)?;
            node.load(path).map_err(|e| e.to_string())?;
            Ok("loaded".to_string())
        }

        "checkpoint" => {
            let [path] = fixed::<1>(&args)?;
            node.save_checkpoint(path).map_err(|e| e.to_string())?;
            Ok(format!("checkpoint saved {path}"))
        }

        "load_checkpoint" => {
            let [path] = fixed::<1>(&args)?;
            node.load_checkpoint(path).map_err(|e| e.to_string())?;
            Ok("loaded".to_string())
        }

        "get_stake_proof" => {
            // get_stake_proof <slot>
            // Returns the stake merkle proof for the authority scheduled at <slot>
            let [slot] = fixed::<1>(&args)?;
            let slot = u64_arg(slot)?;
            let proof = node.get_stake_proof(slot).map_err(|e| e.to_string())?;
            Ok(hex::encode(bincode::serialize(&proof).unwrap()))
        }

        "get_epoch_authority_set" => {
            // get_epoch_authority_set <epoch>
            // Returns the full authority stake set for an epoch (for light client caching)
            let [epoch] = fixed::<1>(&args)?;
            let epoch = u64_arg(epoch)?;
            let set = node
                .get_epoch_authority_set(epoch)
                .map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            for (pk, stake) in set {
                out.push(format!("{} {}", hex::encode(pk), stake));
            }
            Ok(out.join("\n"))
        }

        other => Err(format!("unknown command '{other}' (try help)")),
    }
}

/// Require exactly `N` arguments, returning them as a fixed array of slices.
fn fixed<'a, const N: usize>(args: &[&'a str]) -> Result<[&'a str; N], String> {
    if args.len() != N {
        return Err(format!("expected {N} argument(s), got {}", args.len()));
    }
    Ok(core::array::from_fn(|i| args[i]))
}

fn u64_arg(s: &str) -> Result<u64, String> {
    s.parse::<u64>()
        .map_err(|_| format!("'{s}' is not a number"))
}

fn u16_arg(s: &str) -> Result<u16, String> {
    s.parse::<u16>()
        .map_err(|_| format!("'{s}' is not a small number"))
}

fn u32_arg(s: &str) -> Result<u32, String> {
    s.parse::<u32>()
        .map_err(|_| format!("'{s}' is not a number"))
}

/// Parse an outpoint from a transaction-id hex string and an output index.
fn parse_outpoint(tx_hex: &str, index: &str) -> Result<OutPoint, String> {
    let mut tx = [0u8; 32];
    hex::decode_to_slice(tx_hex, &mut tx).map_err(|e| format!("bad outpoint-tx-hex: {e}"))?;
    Ok(OutPoint::new(TxId::from_bytes(tx), u32_arg(index)?))
}

/// Parse a 100-byte HTLC template from hex.
fn parse_htlc_script(script_hex: &str) -> Result<HtlcScript, String> {
    let bytes = hex::decode(script_hex).map_err(|e| format!("bad script-hex: {e}"))?;
    HtlcScript::parse(&bytes).map_err(|e| e.to_string())
}

/// Parse a 40-byte vault template from hex.
fn parse_vault_script(script_hex: &str) -> Result<VaultScript, String> {
    let bytes = hex::decode(script_hex).map_err(|e| format!("bad script-hex: {e}"))?;
    VaultScript::parse(&bytes).map_err(|e| e.to_string())
}

/// A balance target is either an address (Base58, versioned/legacy hex) or an actor seed.
fn parse_target(token: &str) -> Result<Address, String> {
    if let Ok(addr) = Address::parse(token) {
        Ok(addr)
    } else {
        Ok(Node::address(u64_arg(token)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{SigningKey, VerifyingKey};

    fn valid_auth(seed: u8) -> (VerifyingKey, String) {
        let sk = SigningKey::from_bytes(&[seed; 32]);
        let pk = sk.verifying_key();
        (pk, hex::encode(pk.as_bytes()))
    }

    #[test]
    fn blank_and_unknown() {
        let mut node = Node::new();
        assert_eq!(execute_line(&mut node, ""), "ok");
        assert_eq!(execute_line(&mut node, "   "), "ok");
        assert!(execute_line(&mut node, "frobnicate").starts_with("err unknown command"));
    }

    #[test]
    fn arg_errors_do_not_panic() {
        let mut node = Node::new();
        assert!(execute_line(&mut node, "genesis 3 1000").starts_with("err expected 4"));
        assert!(execute_line(&mut node, "genesis x 1 1 1").starts_with("err"));
        assert!(execute_line(&mut node, "balance 1").starts_with("err")); // no ledger yet
    }

    #[test]
    fn genesis_poa_creates_chain_with_authority_set() {
        let mut node = Node::new();
        // 3 valid Ed25519 public keys from seeds 0x01, 0x02, 0x03
        let (_, auth1) = valid_auth(0x01);
        let (_, auth2) = valid_auth(0x02);
        let (_, auth3) = valid_auth(0x03);
        let cmd = format!(
            "genesis_poa 3 1000 1000 1 100 3000 {} {} {}",
            auth1, auth2, auth3
        );
        let resp = execute_line(&mut node, &cmd);
        assert!(resp.starts_with("ok genesis "), "got: {}", resp);
        // Verify the node has PoA enabled
        assert!(node.poa_enabled());
        let poa_cfg = node.poa_config().expect("poa config");
        assert_eq!(
            poa_cfg.authority_set.active_authority(0).as_bytes().len(),
            32
        );
    }

    #[test]
    fn genesis_poa_rejects_insufficient_authorities() {
        let mut node = Node::new();
        let (_, auth1) = valid_auth(0x01);
        let (_, auth2) = valid_auth(0x02);
        let cmd = format!("genesis_poa 3 1000 1000 1 100 3000 {} {}", auth1, auth2);
        let resp = execute_line(&mut node, &cmd);
        assert!(
            resp.starts_with("err need at least 3 authority keys"),
            "got: {}",
            resp
        );
    }

    #[test]
    fn genesis_poa_rejects_bad_key_length() {
        let mut node = Node::new();
        let (_, auth1) = valid_auth(0x01);
        let (_, auth2) = valid_auth(0x02);
        let auth3 = "short";
        let cmd = format!(
            "genesis_poa 3 1000 1000 1 100 3000 {} {} {}",
            auth1, auth2, auth3
        );
        let resp = execute_line(&mut node, &cmd);
        assert!(
            resp.starts_with("err authority key must be 64 hex chars"),
            "got: {}",
            resp
        );
    }

    #[test]
    fn authority_key_sets_signing_key() {
        let mut node = Node::new();
        // First create a PoA genesis
        let (_, auth1) = valid_auth(0x01);
        let (_, auth2) = valid_auth(0x02);
        let (_, auth3) = valid_auth(0x03);
        let cmd = format!(
            "genesis_poa 3 1000 1000 1 100 3000 {} {} {}",
            auth1, auth2, auth3
        );
        execute_line(&mut node, &cmd);
        // Now set an authority signing key (seed 0x01 -> valid key)
        let (_, key_hex) = valid_auth(0x01);
        let resp = execute_line(&mut node, &format!("authority_key {}", key_hex));
        assert_eq!(resp, "ok authority key set");
        // Verify the node has the key
        assert!(node.authority_public_key().is_some());
    }

    #[test]
    fn authority_key_rejects_bad_length() {
        let mut node = Node::new();
        let resp = execute_line(&mut node, "authority_key short");
        assert!(
            resp.starts_with("err authority_key must be 64 hex chars"),
            "got: {}",
            resp
        );
    }
}
