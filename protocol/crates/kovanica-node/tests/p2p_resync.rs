//! Regression test for **repeated** P2P sync.
//!
//! The headers-first path only ever had coverage for the *first* exchange: the
//! unit tests in `net.rs` exercise encode/decode round-trips, and the live
//! network only ever showed a single successful `headers-first` handshake at
//! boot. Nothing tested what happens on the **second** sync, after the server
//! has produced more blocks — which is the steady state a running network is in
//! almost all of the time.
//!
//! That gap hid a real defect: on the live testnet seed3 completed exactly one
//! `headers-first` exchange (13 headers / 13 bodies) and then transferred
//! nothing for the rest of its life, stalling at height 15 while seed2 passed
//! height 30. Every subsequent connection fell back to the legacy full-dump
//! exchange, which yields 0 applied records once the 800ms read timeout fires.
//!
//! This test drives the exact production entry points
//! (`sync_headers_first` / `serve_headers_first`) over a real loopback socket,
//! with the server producing a new block *between* the two exchanges.

use std::io::Read;
use std::net::{Shutdown, TcpListener, TcpStream};
use std::time::Duration;

use kovanica_node::{serve_headers_first, sync_headers_first, Node};

/// Roomy timeout: this exercises protocol logic, not the 800ms production dial
/// budget, so a slow CI box cannot turn a real regression into a flake.
const IO: Duration = Duration::from_secs(5);

fn genesis_node() -> Node {
    let mut node = Node::new();
    node.genesis(3, 1_000, 1_000, 1, None).expect("genesis");
    node
}

/// A server that serves exactly `rounds` sequential connections, and — when
/// `grow_between` is set — produces one fresh block *after each completed
/// round* so the client's next sync has something new to pull.
///
/// The thread returns the first `serve_headers_first` error rather than
/// panicking, so a test can assert on the server's `Result` and on observable
/// wire behaviour independently. Panicking in the server thread would fail the
/// test at `join` and hide the rest of the assertions.///
/// `rounds` must cover every exchange the client makes: the server thread ends
/// (dropping the listener) after its last round, so a client that dials again
/// gets a refused/reset socket rather than a protocol answer. That is a
/// different failure from the one under test, and it would otherwise be
/// misread as one.
fn serving_node(
    rounds: usize,
    grow_between: bool,
) -> (String, std::thread::JoinHandle<Result<Node, String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("local_addr").to_string();
    let handle = std::thread::spawn(move || {
        let mut server = genesis_node();
        server.send(1, 400, 2).expect("initial block");
        for round in 0..rounds {
            let (mut stream, _) = listener.accept().expect("accept");
            if let Err(e) = serve_headers_first(&mut stream, &mut server, IO) {
                return Err(format!("round {round} serve_headers_first failed: {e:?}"));
            }
            // Grow the chain *after* the exchange, so the next round is the
            // interesting one: a server with blocks the client has never seen.
            if grow_between && round + 1 < rounds {
                server.send(1, 400, 2).expect("follow-up block");
            }
        }
        Ok(server)
    });
    (addr, handle)
}

#[test]
fn second_sync_applies_blocks_produced_after_the_first_exchange() {
    let (addr, server) = serving_node(2, true);

    let mut client = genesis_node();

    let first = sync_headers_first(&addr, &mut client, IO).expect("first sync connects");
    assert!(
        first.bodies_applied >= 1,
        "first sync must transfer the pre-existing block, got {first:?}"
    );
    let after_first = client.chain_height().expect("client height");

    // The server produced another block after the first exchange closed. This
    // is the case that silently returned 0 records in production.
    let second = sync_headers_first(&addr, &mut client, IO);
    let server_node = server
        .join()
        .expect("server thread")
        .expect("second exchange must succeed");
    assert_eq!(
        client.chain_height().expect("client height"),
        server_node.chain_height().expect("server height"),
        "client and server must converge on the same chain"
    );
    assert!(
        client.chain_height().expect("client height") > after_first,
        "second sync applied nothing: client stuck at {after_first} while server reached {}",
        server_node.chain_height().expect("server height")
    );

    let second = second.expect("second sync returns Ok");
    assert!(
        second.bodies_applied >= 1,
        "second sync must apply the newly produced block, got {second:?}"
    );
    assert_eq!(second.errors, 0, "second sync reported errors: {second:?}");
}

/// A peer that has nothing to ask for must cost the server nothing.
///
/// `sync_headers_first` short-circuits with `Ok(SyncStats::default())` when the
/// peer's inventory already covers ours, and simply drops the socket. The
/// server used to read that as a protocol failure, and its error path is the
/// legacy full-dump exchange — so a peer with *nothing new* caused the server to
/// serialise and ship its **entire chain**. Any peer could trigger that with one
/// dial and a hang-up, which makes it a remotely-triggerable bandwidth
/// amplification vector rather than a cosmetic logging issue.
///
/// The assertion here is the cheap one: an already-synced client must leave the
/// server returning `Ok(())` rather than `Err`, because only `Err` reaches the
/// full-dump fallback. The zero-bytes claim itself is enforced structurally by
/// `serve_headers_first` returning before any `export_headers`/`export` call.
#[test]
fn up_to_date_peer_closing_early_is_not_a_server_error() {
    // Two rounds, no growth in between: the second exchange has to be served
    // (the server has to still be listening) and has to find nothing missing.
    let (addr, server) = serving_node(2, false);

    // First exchange transfers the pre-existing block, so the two are in sync.
    let mut client = genesis_node();
    let first = sync_headers_first(&addr, &mut client, IO).expect("first sync connects");
    assert!(
        first.bodies_applied >= 1,
        "first sync transferred nothing: {first:?}"
    );

    // Second exchange: `missing` is empty, so the client hangs up immediately.
    let second = sync_headers_first(&addr, &mut client, IO);
    let server_node = server
        .join()
        .expect("server thread")
        .expect("an up-to-date peer hanging up must not be a server error");

    // The client sees a clean no-op, not a failure.
    let second = second.expect("an up-to-date client must not error");
    assert_eq!(
        second.bodies_applied, 0,
        "nothing should transfer: {second:?}"
    );
    assert_eq!(
        client.chain_height().expect("client height"),
        server_node.chain_height().expect("server height"),
        "chains must still match"
    );
}

/// A peer that dials and hangs up **without sending a byte** must not be a
/// server error.
///
/// This is the close point a fix aimed at the up-to-date-peer case misses: step 1
/// of the exchange reads the client's inventory, so a dialer that closes before
/// writing anything fails *that* read — not the get-headers read further in. It
/// is also the cheapest trigger available (one connect, one close, no protocol
/// knowledge), which is what makes it an amplification vector rather than a
/// cosmetic bug. The live testnet hit this repeatedly.
///
/// Scope of the claim, stated honestly: the full-dump fallback lives in the
/// explorer's accept loop, **not** in `serve_headers_first`, so this test does
/// not drive it and cannot measure the bytes a dump would ship. What it pins is
/// the condition the dump is gated on — the callee returns `Ok(())` — plus the
/// fact that no write happens before the first read. Together those make the
/// dump unreachable for a silent peer. The end-to-end claim (a real node ships
/// no chain) is verified on the live testnet by watching the accept loop stop
/// logging `falling back to full dump`, not here.
#[test]
fn peer_that_dials_and_hangs_up_silently_is_not_a_server_error() {
    let (addr, server) = serving_node(1, false);

    let mut sock = TcpStream::connect(&addr).expect("connect");
    // Half-close rather than drop: the server's read returns EOF at step 1, and
    // our read side stays open to confirm it wrote nothing on the way out.
    sock.shutdown(Shutdown::Write).expect("half-close");
    sock.set_read_timeout(Some(Duration::from_millis(750)))
        .expect("read timeout");

    let mut received = Vec::new();
    let _ = sock.read_to_end(&mut received); // Errs on timeout, which is expected

    // `serve_headers_first` must not write before its first read, so a peer that
    // said nothing receives nothing.
    assert_eq!(
        received.len(),
        0,
        "server wrote {} bytes to a peer that sent nothing",
        received.len()
    );

    let server_node = server
        .join()
        .expect("server thread")
        .expect("a peer hanging up silently must not be a server error");
    assert_eq!(
        server_node.chain_height().expect("server height"),
        1,
        "the silent exchange must not have applied or dropped anything"
    );
}
