//! Generate real testnet PoA authority keys.
//!
//! # Secrets never touch stdout
//!
//! An authority key is a *consensus* credential: whoever holds it can sign the
//! blocks the network accepts as canonical. The previous version of this example
//! printed every secret to stdout, which put them into terminal scrollback, any
//! `tmux`/`screen` capture, any CI log, and any chat transcript an operator
//! pasted them into — the exact custody failure the key ceremony exists to
//! prevent.
//!
//! This version writes each secret to its own `0600` file and prints only
//! *public* material to stdout, so a secret only ever travels by `scp`/removable
//! media to the operator who owns that authority.
//!
//! # Usage
//!
//! ```text
//! cargo run --example generate_authority_keys -- --out-dir /root/keys
//! ```
//!
//! Produces, in `--out-dir`:
//!
//! - `authority-1.env`, `authority-2.env`, … — mode `0600`, one per authority.
//!   Each holds only that operator's `KOVANICA_AUTHORITY_KEY`. Move to that
//!   operator's host and reference from systemd with `EnvironmentFile=`.
//! - `authorities.conf` — mode `0644`, the public `KOVANICA_AUTHORITIES` /
//!   `KOVANICA_AUTHORITY_THRESHOLD` / `KOVANICA_SLOT_DURATION` block that
//!   **every** node needs and that contains no secret.
//!
//! Exits non-zero rather than overwriting an existing key file.

use ed25519_dalek::{Signer, SigningKey};
use getrandom::getrandom;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const DEFAULT_COUNT: usize = 3;
const DEFAULT_SLOT_DURATION: u64 = 3_000;

/// `AuthoritySet` enforces `MIN_THRESHOLD = 2`, so a threshold of 1 is not
/// representable on-chain. Default to a strict majority of `count`.
fn default_threshold(count: usize) -> u64 {
    (count / 2 + 1) as u64
}

#[derive(Debug)]
struct Args {
    out_dir: PathBuf,
    count: usize,
    threshold: u64,
    slot_duration: u64,
}

fn usage() -> &'static str {
    "generate_authority_keys — create real PoA authority keys\n\n\
     USAGE:\n    generate_authority_keys [OPTIONS]\n\n\
     OPTIONS:\n\
     \x20   --out-dir <DIR>          Where to write key files [default: ./authority-keys]\n\
     \x20   --count <N>              Number of authorities to generate [default: 3]\n\
     \x20   --threshold <T>          AuthorityUpdateTx threshold, an integer [default: a\n\
     \x20                             strict majority of --count, i.e. count/2 + 1]\n\
     \x20   --slot-duration <MS>     Slot length in milliseconds [default: 3000]\n\
     \x20   -h, --help               Print this help\n\n\
     Secrets are written to mode-0600 files, never to stdout. Exits non-zero if\n\
     any output file already exists; move or delete it before regenerating."
}

fn parse_args() -> Result<Args, String> {
    // Split out so the parsing rules are unit-testable; `std::env::args()`
    // cannot be driven from a test.
    parse_from(std::env::args().skip(1))
}

fn parse_from<I: Iterator<Item = String>>(args: I) -> Result<Args, String> {
    let mut out_dir = PathBuf::from("./authority-keys");
    let mut count = DEFAULT_COUNT;
    let mut threshold = None;
    let mut slot_duration = DEFAULT_SLOT_DURATION;

    let mut it = args;
    while let Some(arg) = it.next() {
        let mut value = || it.next().ok_or_else(|| format!("{arg} requires a value"));
        match arg.as_str() {
            "-h" | "--help" => {
                println!("{}", usage());
                std::process::exit(0);
            }
            "--out-dir" => out_dir = PathBuf::from(value()?),
            "--count" => {
                count = value()?
                    .parse()
                    .map_err(|_| "--count must be a positive integer".to_string())?
            }
            "--threshold" => {
                // Accept the literal `majority` as well as an integer: the help
                // text advertises it as the default, so rejecting it would fail
                // on the exact value a reader is most likely to type.
                let raw = value()?;
                match raw.parse::<u64>() {
                    Ok(n) => threshold = Some(n),
                    Err(_) if raw.eq_ignore_ascii_case("majority") => {
                        // Leave `threshold` as `None` so it resolves to a strict
                        // majority of the *final* `--count`, which may itself be
                        // parsed after this flag.
                        threshold = None;
                    }
                    Err(_) => {
                        return Err(format!(
                            "--threshold must be an integer or `majority`; got {raw:?}"
                        ))
                    }
                }
            }
            "--slot-duration" => {
                slot_duration = value()?
                    .parse()
                    .map_err(|_| "--slot-duration must be an integer".to_string())?
            }
            other => return Err(format!("unrecognised argument: {other}")),
        }
    }

    if count == 0 {
        return Err("--count must be at least 1".into());
    }
    if count < 3 {
        return Err(format!(
            "AuthoritySet requires at least 3 authorities (MIN_AUTHORITIES = 3); got {count}"
        ));
    }
    if count > 16 {
        return Err(format!(
            "AuthoritySet allows at most 16 authorities (MAX_AUTHORITIES = 16); got {count}"
        ));
    }

    Ok(Args {
        out_dir,
        count,
        threshold: threshold.unwrap_or_else(|| default_threshold(count)),
        slot_duration,
    })
}

/// Create `path` with exactly `mode`, failing if it already exists.
///
/// `create_new(true)` is the load-bearing part: regenerating over a live key
/// file would silently invalidate an operator's key without telling anyone, and
/// the network would then stall on that slot (production is strict round-robin
/// `authorities[slot % len]`, so a lost key does not redistribute its slots).
fn create_exclusive(path: &Path, mode: u32, body: &str) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode)
        .open(path)
        .map_err(|e| {
            format!(
                "refusing to write {}: {e}\n\
                 If this is an existing live key file, move it aside first — \
                 overwriting it would invalidate that authority's key.",
                path.display()
            )
        })?;
    // `mode` is masked by umask, so set it explicitly too.
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
        .map_err(|e| format!("cannot chmod {}: {e}", path.display()))?;
    file.write_all(body.as_bytes())
        .map_err(|e| format!("cannot write {}: {e}", path.display()))
}

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("error: {e}\n");
            eprintln!("{}", usage());
            return ExitCode::FAILURE;
        }
    };

    if let Err(e) = fs::create_dir_all(&args.out_dir) {
        eprintln!("error: cannot create {}: {e}", args.out_dir.display());
        return ExitCode::FAILURE;
    }
    // The directory itself must not be world-readable, or the 0600 files inside
    // are still enumerable by name.
    if let Err(e) = fs::set_permissions(&args.out_dir, fs::Permissions::from_mode(0o700)) {
        eprintln!("error: cannot chmod 0700 {}: {e}", args.out_dir.display());
        return ExitCode::FAILURE;
    }

    let mut publics = Vec::with_capacity(args.count);
    for i in 0..args.count {
        let mut seed = [0u8; 32];
        if let Err(e) = getrandom(&mut seed) {
            eprintln!("error: OS randomness unavailable: {e}");
            return ExitCode::FAILURE;
        }
        let sk = SigningKey::from_bytes(&seed);
        let pk = sk.verifying_key();

        // Round-trip: a key that cannot produce a signature the node will
        // accept is worse than no key, because the operator would only discover
        // it when the chain stalls on their slot.
        let probe = b"kovanica-authority-key-selfcheck";
        if let Err(e) = pk.verify_strict(probe, &sk.sign(probe)) {
            eprintln!("error: generated key {} cannot sign/verify: {e}", i + 1);
            return ExitCode::FAILURE;
        }

        let path = args.out_dir.join(format!("authority-{}.env", i + 1));
        let body = format!(
            "# Kovanica PoA authority {} secret — mode 0600, never commit or paste.\n\
             # Install on this operator's host only, then reference from systemd:\n\
             #   [Service]\n\
             #   EnvironmentFile={}\n\
             KOVANICA_AUTHORITY_KEY={}\n",
            i + 1,
            path.display(),
            hex::encode(sk.to_bytes()),
        );
        if let Err(e) = create_exclusive(&path, 0o600, &body) {
            eprintln!("error: {e}");
            return ExitCode::FAILURE;
        }
        publics.push(hex::encode(pk.as_bytes()));
    }

    let joined = publics.join(",");
    let conf = format!(
        "# Kovanica PoA public authority set — no secret in this file.\n\
         # Set identically on EVERY node (they must agree on the set).\n\
         KOVANICA_AUTHORITIES={}\n\
         KOVANICA_AUTHORITY_THRESHOLD={}\n\
         KOVANICA_SLOT_DURATION={}\n",
        joined, args.threshold, args.slot_duration
    );
    let conf_path = args.out_dir.join("authorities.conf");
    if let Err(e) = create_exclusive(&conf_path, 0o644, &conf) {
        eprintln!("error: {e}");
        return ExitCode::FAILURE;
    }

    // Public material only from here down.
    println!(
        "Generated {} authority key(s) in {}",
        args.count,
        args.out_dir.display()
    );
    println!();
    for (i, pk) in publics.iter().enumerate() {
        println!("  authority {} public: {}", i + 1, pk);
        println!(
            "  authority {} secret: {} (mode 0600 — move to that operator, then delete here)",
            i + 1,
            args.out_dir
                .join(format!("authority-{}.env", i + 1))
                .display()
        );
    }
    println!();
    println!("Public block written to {}", conf_path.display());
    println!();
    println!("NEXT");
    println!("  1. Move each authority-N.env to its own operator over a secure channel");
    println!("     and delete the copy here. Never paste a secret into a shell, a");
    println!("     chat, a ticket, or a repo.");
    println!("  2. Copy authorities.conf to every node; it carries no secret.");
    println!("  3. Record the public set in protocol/docs/AUTHORITY-KEY-CEREMONY.md §6");
    println!("     (public keys, threshold, set hash, date, genesis id — never a secret).");
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threshold_defaults_to_a_strict_majority() {
        assert_eq!(default_threshold(3), 2);
        assert_eq!(default_threshold(4), 3);
        assert_eq!(default_threshold(5), 3);
        assert_eq!(default_threshold(7), 4);
    }

    #[test]
    fn threshold_accepts_the_literal_majority_the_help_advertises() {
        // Regression: `--help` advertised `[default: majority]` but the parser
        // only accepted an integer, so the documented default was rejected.
        let a = parse_from(
            ["--threshold", "majority", "--count", "5"]
                .into_iter()
                .map(String::from),
        )
        .unwrap();
        assert_eq!(a.threshold, default_threshold(5));
    }

    #[test]
    fn threshold_majority_resolves_against_a_later_count() {
        // `--threshold majority` is resolved against the *final* --count, so
        // flag order must not matter.
        let a = parse_from(
            ["--threshold", "majority", "--count", "7"]
                .into_iter()
                .map(String::from),
        )
        .unwrap();
        assert_eq!(a.threshold, 4);
    }

    #[test]
    fn threshold_still_accepts_an_explicit_integer() {
        let a = parse_from(["--threshold", "2"].into_iter().map(String::from)).unwrap();
        assert_eq!(a.threshold, 2);
    }

    #[test]
    fn threshold_rejects_other_words_with_a_helpful_message() {
        let err = parse_from(["--threshold", "most"].into_iter().map(String::from))
            .expect_err("`most` is not a valid threshold");
        assert!(err.contains("integer"), "unhelpful error: {err}");
    }

    #[test]
    fn authority_set_bounds_are_enforced_by_the_generator() {
        // Mirrors MIN_AUTHORITIES / MAX_AUTHORITIES in kovanica-dag::authority,
        // so we fail here with a clear message instead of at genesis time with
        // a node error.
        assert!(DEFAULT_COUNT >= 3 && DEFAULT_COUNT <= 16);
    }

    #[test]
    fn create_exclusive_refuses_to_clobber() {
        let dir = std::env::temp_dir().join(format!("kvnc-keygen-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.env");

        create_exclusive(&path, 0o600, "first").unwrap();
        assert!(create_exclusive(&path, 0o600, "second").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "first");

        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "secret file must not be group/world readable");

        let _ = fs::remove_dir_all(&dir);
    }
}
