//! Tauri application entry point for the Kovanica Desktop Node App.

use crate::{NetworkProfile, NodeHandle};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // Spawn the node worker on startup
            tauri::async_runtime::spawn(async move {
                match NodeHandle::spawn(NetworkProfile::testnet()).await {
                    Ok(node_handle) => {
                        // Store the handle in app state for commands
                        handle.manage(node_handle.clone());

                        // Forward node events to the frontend
                        let mut event_rx = node_handle.events();
                        while let Ok(event) = event_rx.recv().await {
                            let _ = handle.emit(
                                "node-event",
                                serde_json::to_value(event).unwrap_or_default(),
                            );
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to spawn node worker: {e}");
                        let _ = handle.emit(
                            "node-event",
                            serde_json::json!({
                                "type": "Error",
                                "data": { "message": format!("Node startup failed: {e}") }
                            }),
                        );
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            produce_block,
            submit_tx,
            save_snapshot,
            save_checkpoint,
            shutdown_node,
            create_wallet,
            unlock_wallet,
            lock_wallet,
            get_addresses,
            send_from_wallet,
            get_balance,
            get_history,
            get_asset_balances,
            start_p2p,
            stop_p2p,
            spv_sync,
            spv_matches,
            spv_verify,
            // [TARGET]-for-removal (PoA-only): staking/mining commands disabled
            // set_validator_seed,
            // enable_hybrid,
            // get_staking,
            // bond_stake,
            // unbond_stake,
            // start_mining,
            // stop_mining,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn get_status(handle: tauri::State<'_, NodeHandle>) -> Result<crate::NodeStatus, String> {
    match handle.send(crate::WorkerCmd::GetStatus).await {
        Ok(crate::WorkerResp::Status(s)) => Ok(s),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn produce_block(handle: tauri::State<'_, NodeHandle>) -> Result<Option<String>, String> {
    match handle.send(crate::WorkerCmd::ProduceBlock).await {
        Ok(crate::WorkerResp::ProduceBlock(r)) => r
            .map(|b| b.map(|id| id.to_string()))
            .map_err(|e| e.to_string()),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn submit_tx(handle: tauri::State<'_, NodeHandle>, tx_hex: String) -> Result<String, String> {
    let bytes = hex::decode(&tx_hex).map_err(|e| format!("tx hex invalid: {e}"))?;
    let tx = kovanica_state::Transaction::decode(&bytes)
        .map_err(|e| format!("tx decode failed: {e}"))?;
    match handle.send(crate::WorkerCmd::SubmitTx(tx)).await {
        Ok(crate::WorkerResp::SubmitTx(Ok(tx_id))) => Ok(tx_id.to_string()),
        Ok(crate::WorkerResp::SubmitTx(Err(e))) => Err(e.to_string()),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn save_snapshot(handle: tauri::State<'_, NodeHandle>) -> Result<String, String> {
    match handle.send(crate::WorkerCmd::SaveSnapshot).await {
        Ok(crate::WorkerResp::SaveState(Ok(path))) => Ok(path),
        Ok(crate::WorkerResp::SaveState(Err(e))) => Err(e),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn save_checkpoint(handle: tauri::State<'_, NodeHandle>) -> Result<String, String> {
    match handle.send(crate::WorkerCmd::SaveCheckpoint).await {
        Ok(crate::WorkerResp::SaveState(Ok(path))) => Ok(path),
        Ok(crate::WorkerResp::SaveState(Err(e))) => Err(e),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn shutdown_node(handle: tauri::State<'_, NodeHandle>) -> Result<(), String> {
    handle.shutdown().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_wallet(
    handle: tauri::State<'_, NodeHandle>,
    passphrase: Option<String>,
) -> Result<(String, String), String> {
    match handle
        .send(crate::WorkerCmd::CreateWallet { passphrase })
        .await
    {
        Ok(crate::WorkerResp::WalletCreated {
            mnemonic,
            master_fingerprint,
        }) => Ok((mnemonic, master_fingerprint)),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn unlock_wallet(
    handle: tauri::State<'_, NodeHandle>,
    mnemonic: String,
    passphrase: Option<String>,
) -> Result<String, String> {
    match handle
        .send(crate::WorkerCmd::UnlockWallet {
            mnemonic,
            passphrase,
        })
        .await
    {
        Ok(crate::WorkerResp::WalletUnlocked { fingerprint }) => Ok(fingerprint),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn lock_wallet(handle: tauri::State<'_, NodeHandle>) -> Result<(), String> {
    match handle.send(crate::WorkerCmd::LockWallet).await {
        Ok(crate::WorkerResp::WalletLocked) => Ok(()),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn get_addresses(
    handle: tauri::State<'_, NodeHandle>,
    count: Option<usize>,
) -> Result<Vec<String>, String> {
    match handle
        .send(crate::WorkerCmd::GetAddresses {
            count: count.unwrap_or(5),
        })
        .await
    {
        Ok(crate::WorkerResp::Addresses(addresses)) => Ok(addresses),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn send_from_wallet(
    handle: tauri::State<'_, NodeHandle>,
    to_address: String,
    amount: u64,
) -> Result<String, String> {
    match handle
        .send(crate::WorkerCmd::SendFromWallet { to_address, amount })
        .await
    {
        Ok(crate::WorkerResp::SendResult(Ok(tx_id))) => Ok(tx_id.to_string()),
        Ok(crate::WorkerResp::SendResult(Err(e))) => Err(e),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn get_balance(handle: tauri::State<'_, NodeHandle>, address: String) -> Result<u64, String> {
    match handle.send(crate::WorkerCmd::GetBalance { address }).await {
        Ok(crate::WorkerResp::Balance(balance)) => Ok(balance),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn get_history(
    handle: tauri::State<'_, NodeHandle>,
    address: String,
    max_blocks: Option<usize>,
) -> Result<Vec<crate::WalletEvent>, String> {
    match handle
        .send(crate::WorkerCmd::GetHistory {
            address,
            max_blocks: max_blocks.unwrap_or(0),
        })
        .await
    {
        Ok(crate::WorkerResp::History(events)) => Ok(events),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn get_asset_balances(
    handle: tauri::State<'_, NodeHandle>,
    address: String,
) -> Result<Vec<crate::AssetBalance>, String> {
    match handle
        .send(crate::WorkerCmd::GetAssetBalances { address })
        .await
    {
        Ok(crate::WorkerResp::AssetBalances(Ok(balances))) => Ok(balances),
        Ok(crate::WorkerResp::AssetBalances(Err(e))) => Err(e),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn start_p2p(
    handle: tauri::State<'_, NodeHandle>,
    listen_addr: Option<String>,
    bootstrap_peers: Option<Vec<String>>,
) -> Result<String, String> {
    match handle
        .send(crate::WorkerCmd::StartP2P {
            listen_addr: listen_addr.unwrap_or_else(|| "0.0.0.0:9000".into()),
            bootstrap_peers: bootstrap_peers.unwrap_or_default(),
        })
        .await
    {
        Ok(crate::WorkerResp::P2PStatus(s)) => Ok(s),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn stop_p2p(handle: tauri::State<'_, NodeHandle>) -> Result<String, String> {
    match handle.send(crate::WorkerCmd::StopP2P).await {
        Ok(crate::WorkerResp::P2PStatus(s)) => Ok(s),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn spv_sync(
    handle: tauri::State<'_, NodeHandle>,
    url: String,
) -> Result<crate::SpvSyncInfo, String> {
    match handle.send(crate::WorkerCmd::SPVSync { url }).await {
        Ok(crate::WorkerResp::SpvSync(Ok(info))) => Ok(info),
        Ok(crate::WorkerResp::SpvSync(Err(e))) => Err(e),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn spv_matches(
    handle: tauri::State<'_, NodeHandle>,
    address: String,
) -> Result<Vec<String>, String> {
    match handle.send(crate::WorkerCmd::SPVMatches { address }).await {
        Ok(crate::WorkerResp::SpvMatches(hits)) => Ok(hits),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn spv_verify(
    handle: tauri::State<'_, NodeHandle>,
    block_id: String,
    tx_id: String,
) -> Result<bool, String> {
    match handle
        .send(crate::WorkerCmd::SPVVerify { block_id, tx_id })
        .await
    {
        Ok(crate::WorkerResp::SpvVerified(v)) => Ok(v),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn set_validator_seed(
    handle: tauri::State<'_, NodeHandle>,
    seed_hex: String,
) -> Result<String, String> {
    match handle
        .send(crate::WorkerCmd::SetValidatorSeed { seed_hex })
        .await
    {
        Ok(crate::WorkerResp::ValidatorSeed(Ok(pk))) => Ok(pk),
        Ok(crate::WorkerResp::ValidatorSeed(Err(e))) => Err(e),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn enable_hybrid(
    handle: tauri::State<'_, NodeHandle>,
    rate_num: u64,
    rate_den: u64,
    retarget: bool,
) -> Result<String, String> {
    match handle
        .send(crate::WorkerCmd::EnableHybrid {
            rate_num,
            rate_den,
            retarget,
        })
        .await
    {
        Ok(crate::WorkerResp::HybridStatus(s)) => Ok(s),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn get_staking(handle: tauri::State<'_, NodeHandle>) -> Result<crate::StakingInfo, String> {
    match handle.send(crate::WorkerCmd::GetStaking).await {
        Ok(crate::WorkerResp::Staking(info)) => Ok(info),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn bond_stake(handle: tauri::State<'_, NodeHandle>, amount: u64) -> Result<String, String> {
    match handle.send(crate::WorkerCmd::BondStake { amount }).await {
        Ok(crate::WorkerResp::StakingTx(Ok(tx_id))) => Ok(tx_id),
        Ok(crate::WorkerResp::StakingTx(Err(e))) => Err(e),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn unbond_stake(handle: tauri::State<'_, NodeHandle>, amount: u64) -> Result<String, String> {
    match handle.send(crate::WorkerCmd::UnbondStake { amount }).await {
        Ok(crate::WorkerResp::StakingTx(Ok(tx_id))) => Ok(tx_id),
        Ok(crate::WorkerResp::StakingTx(Err(e))) => Err(e),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn start_mining(
    handle: tauri::State<'_, NodeHandle>,
    interval_secs: u64,
) -> Result<String, String> {
    match handle
        .send(crate::WorkerCmd::StartMining { interval_secs })
        .await
    {
        Ok(crate::WorkerResp::MiningStatus(s)) => Ok(s),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn stop_mining(handle: tauri::State<'_, NodeHandle>) -> Result<String, String> {
    match handle.send(crate::WorkerCmd::StopMining).await {
        Ok(crate::WorkerResp::MiningStatus(s)) => Ok(s),
        Ok(_) => Err("unexpected response".into()),
        Err(e) => Err(e.to_string()),
    }
}
