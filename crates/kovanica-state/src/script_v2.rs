//! Script v2 execution engine (RFC-003 / 3B).
//!
//! A bounded, non-Turing-complete, stack-based script language that locks funds
//! behind a small deterministic program. See the RFC-003 spec §5 for the full
//! language definition and the activation-gate template.
//!
//! Design rationale (deterministic script, no VM): script v2 is deliberately not a
//! VM. It is a bounded stack machine with a fixed opcode table and a step budget.
//! This keeps execution time predictable and auditable on a BlockDAG (no
//! halting-problem concerns, no gas metering needed). DeFi primitives — HTLC (5.1),
//! time-lock vaults (5.2), token-staking sortition (5.3) — build on top of script
//! v2, so 3B must land before them.
//!
//! Reference protocols: BIP-65 (CHECKLOCKTIMEVERIFY), BIP-112
//! (CHECKSEQUENCEVERIFY), Bitcoin script (stack-based Forth model, adapted here to a
//! bounded non-Turing-complete subset), Cardano Plutus (deterministic-script,
//! no-VM rationale), Algorand TEAL (bounded-step execution as a budget reference).

use core::fmt;

use crate::tx::{OutPoint, Transaction};

/// Maximum allowed script length (consensus parameter).
pub const SCRIPT_V2_MAX_SCRIPT_LEN: usize = 1024;
/// Default step budget for script execution (consensus parameter).
pub const SCRIPT_V2_STEP_BUDGET: u32 = 1000;

/// A parsed, validated script v2 program. Created by [`ScriptV2::parse`] / [`ScriptV2::new`].
///
/// The script is a sequence of opcodes with their immediate arguments (see the module
/// docs and the RFC-003 spec §5.2). This struct is the validated form that the
/// execution engine consumes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScriptV2 {
    /// Raw script bytes (the validated sequence of opcodes + immediates).
    bytes: Vec<u8>,
    /// Number of steps the script takes to execute (pre-computed at parse for the
    /// step-budget check). Each opcode execution counts as one step.
    step_count: u32,
}

impl ScriptV2 {
    /// Parse and validate a script v2 program from its raw bytes.
    ///
    /// Returns `Ok(ScriptV2)` if the script is well-formed, `Err(reason)` otherwise.
    /// Validation rules (see RFC-003 spec §5.2):
    /// - Empty script rejected.
    /// - Unknown opcode (not in 0x01..0x08) rejected.
    /// - Stack underflow during dry-run parse rejected.
    /// - THRESHOLD with M < 1, N < 1, M > N, N > 16 rejected.
    /// - THRESHOLD byte length mismatch rejected.
    /// - Non-valid-Ed25519-point pubkey in THRESHOLD rejected.
    /// - Duplicate pubkeys in THRESHOLD rejected.
    /// - Non-64-byte signature in THRESHOLD rejected.
    /// - Total length > SCRIPT_V2_MAX_SCRIPT_LEN rejected.
    ///
    /// The dry-run parse simulates the stack depth as the script executes so we can
    /// reject stack-underflow scripts without materialising full values. Opcodes that
    /// push (none in the initial set — everything pops or is inline) would increase
    /// depth; opcodes that pop decrease it. The pre-loaded sighash counts as one stack
    /// element at the start.
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.is_empty() {
            return Err("script v2 must not be empty".into());
        }
        if bytes.len() > SCRIPT_V2_MAX_SCRIPT_LEN {
            return Err(format!(
                "script v2 too long: {} > {}",
                bytes.len(),
                SCRIPT_V2_MAX_SCRIPT_LEN
            ));
        }

        let mut pos = 0;
        let mut depth: i32 = 1; // pre-loaded sighash is one stack element.
        let mut step_count: u32 = 0;

        while pos < bytes.len() {
            let opcode = bytes[pos];
            pos += 1;
            step_count = step_count.saturating_add(1);

            match opcode {
                // ED25519_VERIFY: pop sig (64B) + pk (32B); verify sig over sighash against pk.
                // 0 immediates — consumes 2 stack elements, produces 0 (success) or fails.
                0x01 => {
                    if depth < 2 {
                        return Err("ED25519_VERIFY: stack underflow".into());
                    }
                    depth -= 2;
                    // no immediates
                }
                // CHECKLOCKTIMEVERIFY (CLTV, BIP-65): pop u32; fail if tx.nLockTime < value.
                // 0 immediates — consumes 1 stack element.
                0x02 => {
                    if depth < 1 {
                        return Err("CHECKLOCKTIMEVERIFY: stack underflow".into());
                    }
                    depth -= 1;
                }
                // CHECKSEQUENCEVERIFY (CSV, BIP-112): pop u32; fail if tx.sequence < value.
                // 0 immediates — consumes 1 stack element.
                0x03 => {
                    if depth < 1 {
                        return Err("CHECKSEQUENCEVERIFY: stack underflow".into());
                    }
                    depth -= 1;
                }
                // HASH_BLAKE3: pop input (any length); push BLAKE3(input) (32 bytes).
                // Consumes 1, produces 1 — net depth unchanged.
                0x04 => {
                    if depth < 1 {
                        return Err("HASH_BLAKE3: stack underflow".into());
                    }
                    // net depth unchanged (pop 1, push 1)
                }
                // EQUAL: pop a + b (same length); push 1 if equal else 0.
                // Consumes 2, produces 1 — net depth -1.
                0x05 => {
                    if depth < 2 {
                        return Err("EQUAL: stack underflow".into());
                    }
                    depth -= 1;
                }
                // AND: pop a + b (both must be 0 or 1); push 1 if both non-zero else 0.
                // Consumes 2, produces 1 — net depth -1.
                0x06 => {
                    if depth < 2 {
                        return Err("AND: stack underflow".into());
                    }
                    depth -= 1;
                }
                // OR: pop a + b (both must be 0 or 1); push 1 if either non-zero else 0.
                // Consumes 2, produces 1 — net depth -1.
                0x07 => {
                    if depth < 2 {
                        return Err("OR: stack underflow".into());
                    }
                    depth -= 1;
                }
                // THRESHOLD: inline M (u8) + N (u8) + N signatures (64B each) + N pubkeys (32B each).
                // Consumes 0 from stack (all data inline), produces 1 (1 if threshold met, else fail).
                // Net depth +1.
                0x08 => {
                    if pos + 2 > bytes.len() {
                        return Err("THRESHOLD: truncated M/N".into());
                    }
                    let m = bytes[pos] as u8;
                    let n = bytes[pos + 1] as u8;
                    pos += 2;

                    if m < 1 {
                        return Err("THRESHOLD: M must be >= 1".into());
                    }
                    if n < 1 {
                        return Err("THRESHOLD: N must be >= 1".into());
                    }
                    if m > n {
                        return Err("THRESHOLD: M must be <= N".into());
                    }
                    if n > 16 {
                        return Err("THRESHOLD: N must be <= 16".into());
                    }

                    let expected_len = 2 + (n as usize) * (64 + 32);
                    if bytes.len() - pos != expected_len {
                        return Err(format!(
                            "THRESHOLD: byte length mismatch: got {}, expected {}",
                            bytes.len() - pos,
                            expected_len
                        ));
                    }

                    // Validate each pubkey is a valid Ed25519 point and no duplicates.
                    let mut seen_pks: Vec<[u8; 32]> = Vec::with_capacity(n as usize);
                    for i in 0..(n as usize) {
                        let sig_start = pos;
                        pos += 64; // skip signature bytes (validity checked at spend time)
                        let pk_start = pos;
                        pos += 32;

                        let pk_bytes = &bytes[pk_start..pk_start + 32];
                        // Validate: pubkey must be a valid Ed25519 point.
                        // We do a lightweight check: attempt to interpret as a Ristretto255
                        // point. Since we want to avoid adding ristretto255-dalek as a new dep
                        // just for validation, use the existing ed25519_dalek VerifyingKey
                        // from_bytes — it rejects invalid points.
                        let pk = ed25519_dalek::VerifyingKey::from_bytes(pk_bytes)
                            .map_err(|e| format!("THRESHOLD: invalid pubkey {}: {}", i, e))?;

                        // Check for duplicate pubkeys.
                        if seen_pks.iter().any(|p| *p == *pk_bytes) {
                            return Err(format!(
                                "THRESHOLD: duplicate pubkey {}",
                                i
                            ));
                        }
                        seen_pks.push(*pk_bytes);
                    }

                    depth += 1; // THRESHOLD pushes 1 on success
                }
                // 0x00 and 0x09..=0xFF are reserved (invalid for now).
                _ => {
                    return Err(format!("unknown opcode 0x{:02x}", opcode));
                }
            }
        }

        // After executing all opcodes, the stack must have exactly 1 element (the result).
        // At parse time we check that the stack never underflows AND that the final depth
        // is exactly 1 (a script that leaves 0 or >1 elements on the stack is invalid).
        if depth != 1 {
            return Err(format!(
                "script leaves {} stack elements, expected exactly 1",
                depth
            ));
        }

        Ok(ScriptV2 {
            bytes: bytes.to_vec(),
            step_count,
        })
    }

    /// The raw script bytes.
    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// The number of execution steps the script requires.
    pub fn step_count(&self) -> u32 {
        self.step_count
    }

    /// The BLAKE3 digest of the script bytes — equals the address payload for a
    /// v0x02 output locked to this script.
    pub fn hash(&self) -> [u8; 32] {
        *blake3::hash(&self.bytes).as_bytes()
    }
}

/// The result of executing a script v2 program against a transaction.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ScriptV2Error {
    /// The step budget was exceeded during execution.
    StepBudgetExceeded {
        steps_taken: u32,
        budget: u32,
    },
    /// An opcode underflowed the stack at runtime.
    StackUnderflow {
        opcode: u8,
        stack_height: usize,
    },
    /// Signature verification failed (ED25519_VERIFY or THRESHOLD).
    SignatureVerificationFailed { opcode: u8, index: usize },
    /// CHECKLOCKTIMEVERIFY: the transaction's nLockTime is less than the stack value.
    LockTimeNotSatisfied {
        n_lock_time: u32,
        required: u32,
    },
    /// CHECKSEQUENCEVERIFY: the transaction's sequence is less than the stack value.
    SequenceNotSatisfied {
        sequence: u32,
        required: u32,
    },
    /// EQUAL: the two popped values are not equal (pushed 0, which is falsy).
    EqualFailed,
    /// AND: both values were not non-zero (pushed 0).
    AndFailed,
    /// OR: neither value was non-zero (pushed 0).
    OrFailed,
    /// THRESHOLD: fewer than M distinct valid signatures.
    ThresholdNotMet {
        m: u8,
        n: u8,
        valid: usize,
    },
    /// Post-execution stack does not have exactly one non-zero element.
    StackResultInvalid { stack_height: usize },
}

impl fmt::Display for ScriptV2Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ScriptV2Error::StepBudgetExceeded { steps_taken, budget } => {
                write!(
                    f,
                    "script step budget exceeded: {} steps > {} budget",
                    steps_taken, budget
                )
            }
            ScriptV2Error::StackUnderflow { opcode, stack_height } => {
                write!(
                    f,
                    "stack underflow on opcode 0x{:02x}: stack height {}",
                    opcode, stack_height
                )
            }
            ScriptV2Error::SignatureVerificationFailed { opcode, index } => {
                write!(
                    f,
                    "signature verification failed on opcode 0x{:02x} index {}",
                    opcode, index
                )
            }
            ScriptV2Error::LockTimeNotSatisfied { n_lock_time, required } => {
                write!(
                    f,
                    "CHECKLOCKTIMEVERIFY: nLockTime {} < required {}",
                    n_lock_time, required
                )
            }
            ScriptV2Error::SequenceNotSatisfied { sequence, required } => {
                write!(
                    f,
                    "CHECKSEQUENCEVERIFY: sequence {} < required {}",
                    sequence, required
                )
            }
            ScriptV2Error::EqualFailed => {
                f.write_str("EQUAL: values not equal (pushed 0)")
            }
            ScriptV2Error::AndFailed => {
                f.write_str("AND: not both non-zero (pushed 0)")
            }
            ScriptV2Error::OrFailed => {
                f.write_str("OR: neither non-zero (pushed 0)")
            }
            ScriptV2Error::ThresholdNotMet { m, n, valid } => {
                write!(
                    f,
                    "THRESHOLD: {} of {} valid signatures, need {}",
                    valid, n, m
                )
            }
            ScriptV2Error::StackResultInvalid { stack_height } => {
                write!(
                    f,
                    "post-execution stack has {} elements, expected exactly 1 non-zero",
                    stack_height
                )
            }
        }
    }
}

impl std::error::Error for ScriptV2Error {}

/// Execute a parsed script v2 program against the given transaction's sighash and
/// witness stack.
///
/// The witness stack is `[script_bytes, elem_1, ..., elem_N]` — `witness[0]` is the
/// script itself (already validated by the caller), and `witness[1..]` are the stack
/// elements the script runs against. The sighash is pre-loaded as the first stack
/// element (the interpreter pushes it before execution begins — matching the RFC-003
/// §5.3 execution model).
///
/// Returns `Ok(())` on success (script leaves exactly one non-zero element on the
/// stack), `Err(ScriptV2Error)` on failure.
///
/// The enclosing transaction's `n_lock_time` and `sequence` are available to
/// CHECKLOCKTIMEVERIFY and CHECKSEQUENCEVERIFY respectively.
pub fn execute(
    script: &ScriptV2,
    witness: &[Vec<u8>],
    tx: &Transaction,
    sighash: &[u8; 32],
) -> Result<(), ScriptV2Error> {
    // The execution stack: pre-loaded sighash first, then the witness elements after
    // the script itself.
    let mut stack: Vec<Vec<u8>> = Vec::with_capacity(1 + witness.len());
    stack.push(sighash.to_vec());

    // Witness[1..] are the stack elements the script runs against.
    if witness.len() > 1 {
        stack.extend_from_slice(&witness[1..]);
    }

    let mut steps: u32 = 0;
    let bytes = script.as_bytes();
    let mut pos = 0;

    while pos < bytes.len() {
        steps = steps.saturating_add(1);
        if steps > SCRIPT_V2_STEP_BUDGET {
            return Err(ScriptV2Error::StepBudgetExceeded {
                steps_taken: steps,
                budget: SCRIPT_V2_STEP_BUDGET,
            });
        }

        let opcode = bytes[pos];
        pos += 1;

        match opcode {
            // ED25519_VERIFY: pop sig (64B) + pk (32B); verify sig over sighash against pk.
            0x01 => {
                if stack.len() < 2 {
                    return Err(ScriptV2Error::StackUnderflow {
                        opcode: 0x01,
                        stack_height: stack.len(),
                    });
                }
                let pk_bytes = stack.pop().unwrap();
                let sig_bytes = stack.pop().unwrap();

                if sig_bytes.len() != 64 {
                    return Err(ScriptV2Error::SignatureVerificationFailed {
                        opcode: 0x01,
                        index: 0,
                    });
                }

                // Verify the signature against the sighash using the provided pubkey.
                let pk = ed25519_dalek::VerifyingKey::from_bytes(&pk_bytes)
                    .map_err(|_| ScriptV2Error::SignatureVerificationFailed {
                        opcode: 0x01,
                        index: 0,
                    })?;
                let sig = ed25519_dalek::Signature::from_bytes(&sig_bytes[..64])
                    .map_err(|_| ScriptV2Error::SignatureVerificationFailed {
                        opcode: 0x01,
                        index: 0,
                    })?;

                if pk.verify(sighash, &sig).is_err() {
                    return Err(ScriptV2Error::SignatureVerificationFailed {
                        opcode: 0x01,
                        index: 0,
                    });
                }
                // On success, push 1 (truthy).
                stack.push(vec![1u8]);
            }

            // CHECKLOCKTIMEVERIFY (CLTV, BIP-65): pop u32; fail if tx.nLockTime < value.
            0x02 => {
                if stack.len() < 1 {
                    return Err(ScriptV2Error::StackUnderflow {
                        opcode: 0x02,
                        stack_height: stack.len(),
                    });
                }
                let value_bytes = stack.pop().unwrap();
                if value_bytes.len() < 4 {
                    return Err(ScriptV2Error::StackUnderflow {
                        opcode: 0x02,
                        stack_height: 0,
                    });
                }
                let required = u32::from_le_bytes([
                    value_bytes[0],
                    value_bytes[1],
                    value_bytes[2],
                    value_bytes[3],
                ]);
                if tx.n_lock_time() < required {
                    return Err(ScriptV2Error::LockTimeNotSatisfied {
                        n_lock_time: tx.n_lock_time(),
                        required,
                    });
                }
                // CLTV pushes nothing on success (it's a guard, not a value producer).
            }

            // CHECKSEQUENCEVERIFY (CSV, BIP-112): pop u32; fail if tx.sequence < value.
            0x03 => {
                if stack.len() < 1 {
                    return Err(ScriptV2Error::StackUnderflow {
                        opcode: 0x03,
                        stack_height: stack.len(),
                    });
                }
                let value_bytes = stack.pop().unwrap();
                if value_bytes.len() < 4 {
                    return Err(ScriptV2Error::StackUnderflow {
                        opcode: 0x03,
                        stack_height: 0,
                    });
                }
                let required = u32::from_le_bytes([
                    value_bytes[0],
                    value_bytes[1],
                    value_bytes[2],
                    value_bytes[3],
                ]);
                if tx.sequence() < required {
                    return Err(ScriptV2Error::SequenceNotSatisfied {
                        sequence: tx.sequence(),
                        required,
                    });
                }
            }

            // HASH_BLAKE3: pop input (any length); push BLAKE3(input) (32 bytes).
            0x04 => {
                if stack.len() < 1 {
                    return Err(ScriptV2Error::StackUnderflow {
                        opcode: 0x04,
                        stack_height: stack.len(),
                    });
                }
                let input = stack.pop().unwrap();
                let hash = blake3::hash(&input);
                stack.push(hash.as_bytes().to_vec());
            }

            // EQUAL: pop a + b (same length); push 1 if equal else 0.
            0x05 => {
                if stack.len() < 2 {
                    return Err(ScriptV2Error::StackUnderflow {
                        opcode: 0x05,
                        stack_height: stack.len(),
                    });
                }
                let b = stack.pop().unwrap();
                let a = stack.pop().unwrap();
                if a == b {
                    stack.push(vec![1u8]);
                } else {
                    return Err(ScriptV2Error::EqualFailed);
                }
            }

            // AND: pop a + b (both must be 0 or 1); push 1 if both non-zero else 0.
            0x06 => {
                if stack.len() < 2 {
                    return Err(ScriptV2Error::StackUnderflow {
                        opcode: 0x06,
                        stack_height: stack.len(),
                    });
                }
                let b = stack.pop().unwrap();
                let a = stack.pop().unwrap();
                let a_nonzero = !a.is_empty() && a[0] != 0;
                let b_nonzero = !b.is_empty() && b[0] != 0;
                if a_nonzero && b_nonzero {
                    stack.push(vec![1u8]);
                } else {
                    return Err(ScriptV2Error::AndFailed);
                }
            }

            // OR: pop a + b (both must be 0 or 1); push 1 if either non-zero else 0.
            0x07 => {
                if stack.len() < 2 {
                    return Err(ScriptV2Error::StackUnderflow {
                        opcode: 0x07,
                        stack_height: stack.len(),
                    });
                }
                let b = stack.pop().unwrap();
                let a = stack.pop().unwrap();
                let a_nonzero = !a.is_empty() && a[0] != 0;
                let b_nonzero = !b.is_empty() && b[0] != 0;
                if a_nonzero || b_nonzero {
                    stack.push(vec![1u8]);
                } else {
                    return Err(ScriptV2Error::OrFailed);
                }
            }

            // THRESHOLD: inline M (u8) + N (u8) + N signatures (64B each) + N pubkeys (32B each).
            // The signatures are verified against the sighash; the pubkeys are the verifying keys.
            // Push 1 on success (exactly M distinct valid signatures), fail otherwise.
            0x08 => {
                if pos + 2 > bytes.len() {
                    return Err(ScriptV2Error::StackUnderflow {
                        opcode: 0x08,
                        stack_height: stack.len(),
                    });
                }
                let m = bytes[pos] as u8;
                let n = bytes[pos + 1] as u8;
                pos += 2;

                let mut valid_count: usize = 0;
                let mut seen_pks: Vec<[u8; 32]> = Vec::with_capacity(n as usize);

                for i in 0..(n as usize) {
                    if pos + 64 + 32 > bytes.len() {
                        return Err(ScriptV2Error::StackUnderflow {
                            opcode: 0x08,
                            stack_height: stack.len(),
                        });
                    }
                    let sig_start = pos;
                    pos += 64;
                    let pk_start = pos;
                    pos += 32;

                    let sig_bytes = &bytes[sig_start..sig_start + 64];
                    let pk_bytes = &bytes[pk_start..pk_start + 32];

                    // Verify signature against sighash.
                    let pk = match ed25519_dalek::VerifyingKey::from_bytes(pk_bytes) {
                        Ok(pk) => pk,
                        Err(_) => continue, // invalid pubkey — skip (treated as invalid sig)
                    };
                    let sig = match ed25519_dalek::Signature::from_bytes(sig_bytes) {
                        Ok(sig) => sig,
                        Err(_) => continue,
                    };
                    if pk.verify(sighash, &sig).is_ok() {
                        // Check for duplicate pubkeys (only count distinct ones).
                        if !seen_pks.iter().any(|p| *p == *pk_bytes) {
                            valid_count += 1;
                            seen_pks.push(*pk_bytes);
                        }
                    }
                }

                if valid_count < m as usize {
                    return Err(ScriptV2Error::ThresholdNotMet {
                        m,
                        n,
                        valid: valid_count,
                    });
                }
                // On success, push 1.
                stack.push(vec![1u8]);
            }

            // Reserved opcodes (0x00, 0x09..=0xFF) — should not reach here if parse
            // already validated, but defend anyway.
            _ => {
                return Err(ScriptV2Error::StackUnderflow {
                    opcode,
                    stack_height: stack.len(),
                });
            }
        }
    }

    // After execution: stack must have exactly one element, and that element must be
    // non-zero (truthy).
    if stack.len() != 1 {
        return Err(ScriptV2Error::StackResultInvalid {
            stack_height: stack.len(),
        });
    }
    let result = &stack[0];
    if result.is_empty() || result[0] == 0 {
        return Err(ScriptV2Error::StackResultInvalid {
            stack_height: stack.len(),
        });
    }

    Ok(())
}
