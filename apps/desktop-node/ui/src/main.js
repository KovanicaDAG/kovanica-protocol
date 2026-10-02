import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

// 1 KVNC = 10^8 atoms (mirrors profile.rs ATOM).
const ATOM = 100_000_000

// DOM elements — node status
const networkBadge = document.getElementById('network-badge')
const produceBtn = document.getElementById('produce-btn')
const statusBtn = document.getElementById('status-btn')
const genesisEl = document.getElementById('genesis')
const tipEl = document.getElementById('tip')
const blocksEl = document.getElementById('blocks')
const mempoolEl = document.getElementById('mempool')
const peersEl = document.getElementById('peers')
const syncEl = document.getElementById('sync')
const eventsEl = document.getElementById('events')

// DOM elements — wallet
const mnemonicInput = document.getElementById('mnemonic-input')
const passphraseInput = document.getElementById('passphrase-input')
const createWalletBtn = document.getElementById('create-wallet-btn')
const unlockWalletBtn = document.getElementById('unlock-wallet-btn')
const lockWalletBtn = document.getElementById('lock-wallet-btn')
const walletFingerprint = document.getElementById('wallet-fingerprint')
const addressListEl = document.getElementById('address-list')
const addressesBtn = document.getElementById('addresses-btn')
const addrInput = document.getElementById('addr-input')
const balanceBtn = document.getElementById('balance-btn')
const assetsBtn = document.getElementById('assets-btn')
const historyBtn = document.getElementById('history-btn')
const walletBalance = document.getElementById('wallet-balance')
const walletAssets = document.getElementById('wallet-assets')
const walletHistory = document.getElementById('wallet-history')
const toInput = document.getElementById('to-input')
const amountInput = document.getElementById('amount-input')
const sendBtn = document.getElementById('send-btn')
const sendResult = document.getElementById('send-result')

// DOM elements — network / P2P / SPV
const p2pListenInput = document.getElementById('p2p-listen-input')
const p2pPeersInput = document.getElementById('p2p-peers-input')
const p2pStartBtn = document.getElementById('p2p-start-btn')
const p2pStopBtn = document.getElementById('p2p-stop-btn')
const p2pStatus = document.getElementById('p2p-status')
const spvUrlInput = document.getElementById('spv-url-input')
const spvSyncBtn = document.getElementById('spv-sync-btn')
const spvSyncStatus = document.getElementById('spv-sync-status')
const spvAddrInput = document.getElementById('spv-addr-input')
const spvMatchBtn = document.getElementById('spv-match-btn')
const spvMatchList = document.getElementById('spv-match-list')
const spvBlockInput = document.getElementById('spv-block-input')
const spvTxInput = document.getElementById('spv-tx-input')
const spvVerifyBtn = document.getElementById('spv-verify-btn')
const spvVerifyStatus = document.getElementById('spv-verify-status')

// DOM elements — operations
const snapshotBtn = document.getElementById('snapshot-btn')
const checkpointBtn = document.getElementById('checkpoint-btn')
const shutdownBtn = document.getElementById('shutdown-btn')
const snapshotStatus = document.getElementById('snapshot-status')
const checkpointStatus = document.getElementById('checkpoint-status')
const shutdownStatus = document.getElementById('shutdown-status')

// DOM elements — staking / mining
const validatorSeedInput = document.getElementById('validator-seed-input')
const validatorSeedBtn = document.getElementById('validator-seed-btn')
const validatorStatus = document.getElementById('validator-status')
const hybridRateNum = document.getElementById('hybrid-rate-num')
const hybridRateDen = document.getElementById('hybrid-rate-den')
const hybridRetarget = document.getElementById('hybrid-retarget')
const hybridBtn = document.getElementById('hybrid-btn')
const hybridStatus = document.getElementById('hybrid-status')
const bondAmountInput = document.getElementById('bond-amount-input')
const bondBtn = document.getElementById('bond-btn')
const unbondBtn = document.getElementById('unbond-btn')
const bondResult = document.getElementById('bond-result')
const miningIntervalInput = document.getElementById('mining-interval-input')
const miningStartBtn = document.getElementById('mining-start-btn')
const miningStopBtn = document.getElementById('mining-stop-btn')
const miningStatus = document.getElementById('mining-status')
const stakingView = document.getElementById('staking-view')

let nodeReady = false
let walletUnlocked = false

function setStatus(text, cls = '') {
  networkBadge.textContent = text
  networkBadge.className = 'value ' + cls
}

function fmtHash(h) {
  if (!h || h === '—') return '—'
  return h.length > 16 ? h.slice(0, 8) + '…' + h.slice(-8) : h
}

function fmtKvnc(atoms) {
  return (atoms / ATOM).toLocaleString(undefined, { maximumFractionDigits: 8 }) + ' KVNC'
}

function updateStatus(s) {
  genesisEl.textContent = fmtHash(s.genesis)
  tipEl.textContent = fmtHash(s.tip)
  blocksEl.textContent = s.block_count.toLocaleString()
  mempoolEl.textContent = s.mempool_size.toLocaleString()
  peersEl.textContent = s.peers.toLocaleString()
  syncEl.textContent = s.sync_progress ? `${s.sync_progress[0].toLocaleString()}/${s.sync_progress[1].toLocaleString()}` : 'synced'
}

function addEvent(type, data) {
  const loading = eventsEl.querySelector('.loading')
  if (loading) loading.remove()

  const div = document.createElement('div')
  div.className = 'event'
  const time = new Date().toLocaleTimeString()
  div.innerHTML = `
    <span class="event-time">[${time}]</span>
    <span class="event-type">${type}</span>
    <span class="event-data">${JSON.stringify(data)}</span>
  `
  eventsEl.insertBefore(div, eventsEl.firstChild)

  while (eventsEl.children.length > 100) {
    eventsEl.removeChild(eventsEl.lastChild)
  }
}

function walletError(e) {
  addEvent('Error', { message: String(e) })
}

function setWalletUnlocked(unlocked) {
  walletUnlocked = unlocked
  sendBtn.disabled = !(unlocked && nodeReady)
  addressesBtn.disabled = !unlocked
  bondBtn.disabled = !(unlocked && nodeReady)
  unbondBtn.disabled = !(unlocked && nodeReady)
}

function setAddressDefaults(addresses) {
  if (addresses && addresses.length) {
    if (!addrInput.value) addrInput.value = addresses[0]
    if (!toInput.value) toInput.value = addresses[0]
    addrInput.placeholder = addresses[0] === '—' ? 'kvnc…dag or hex' : addresses[0]
  }
}

function renderAddresses(addresses) {
  addressListEl.innerHTML = addresses.length
    ? addresses.map((a) => `<div class="list-item">${a}</div>`).join('')
    : '<div class="list-item">no wallet unlocked</div>'
}

function renderHistory(events) {
  walletHistory.innerHTML = events.length
    ? events.map((e) => {
        const dir = e.type || Object.keys(e)[0] || '?'
        const cls = dir === 'Received' ? 'dir-received' : dir === 'Sent' ? 'dir-sent' : ''
        const asset = e.asset_id ? ' · ' + e.asset_id.slice(0, 8) + '…' : ''
        const amount = e.amount != null ? fmtKvnc(e.amount) + asset : ''
        const body = e.tx_id ? `${fmtHash(e.tx_id)}${amount ? ' · ' + amount : ''}` : JSON.stringify(e)
        return `<div class="list-item"><span class="${cls}">${dir}</span> ${body}</div>`
      }).join('')
    : '<div class="list-item">no history</div>'
}

function renderAssets(balances) {
  walletAssets.innerHTML = balances.length
    ? balances.map((b) => {
        const asset = b.asset === 'KVNC' ? 'KVNC' : b.asset.slice(0, 8) + '…'
        const kind = b.kind === 'NonFungible' ? ' [NFT]' : ''
        return `<div class="list-item">${asset}${kind} · ${(Number(b.amount) / ATOM).toLocaleString(undefined, { maximumFractionDigits: 8 })}</div>`
      }).join('')
    : ''
}

async function loadAssets() {
  if (!addrInput.value.trim()) return
  try {
    const balances = await invoke('get_asset_balances', { address: addrInput.value.trim() })
    renderAssets(balances)
    if (!balances.length) {
      walletAssets.innerHTML = '<div class="list-item">no assets</div>'
    }
  } catch (e) {
    walletError(e)
  }
}

async function refreshStatus() {
  try {
    const status = await invoke('get_status')
    updateStatus(status)
  } catch (e) {
    console.error('status error:', e)
    addEvent('Error', { message: 'Failed to get status' })
  }
}

async function produceBlock() {
  produceBtn.disabled = true
  produceBtn.textContent = 'Producing...'
  try {
    const result = await invoke('produce_block')
    addEvent('BlockProduced', result)
    await refreshStatus()
  } catch (e) {
    console.error('produce error:', e)
    addEvent('Error', { message: String(e) })
  } finally {
    produceBtn.disabled = false
    produceBtn.textContent = 'Produce Block'
  }
}

async function createWallet() {
  try {
    const [mnemonic, fingerprint] = await invoke('create_wallet', {
      passphrase: passphraseInput.value || null,
    })
    mnemonicInput.value = mnemonic
    walletFingerprint.textContent = 'fingerprint ' + fingerprint
    walletFingerprint.className = 'value sm ok'
    setWalletUnlocked(true)
    await refreshAddresses()
    addEvent('WalletCreated', { fingerprint })
  } catch (e) {
    walletError(e)
  }
}

async function unlockWallet() {
  try {
    const fingerprint = await invoke('unlock_wallet', {
      mnemonic: mnemonicInput.value.trim(),
      passphrase: passphraseInput.value || null,
    })
    walletFingerprint.textContent = 'fingerprint ' + fingerprint
    walletFingerprint.className = 'value sm ok'
    setWalletUnlocked(true)
    await refreshAddresses()
    addEvent('WalletUnlocked', { fingerprint })
  } catch (e) {
    walletError(e)
  }
}

async function lockWallet() {
  try {
    await invoke('lock_wallet')
    walletUnlocked = false
    walletFingerprint.textContent = 'no unlocked wallet'
    walletFingerprint.className = 'value sm'
    setWalletUnlocked(false)
    renderAddresses([])
    addEvent('WalletLocked', {})
  } catch (e) {
    walletError(e)
  }
}

async function refreshAddresses() {
  try {
    const addresses = await invoke('get_addresses', { count: 5 })
    renderAddresses(addresses)
    setAddressDefaults(addresses)
  } catch (e) {
    walletError(e)
  }
}

async function loadBalance() {
  if (!addrInput.value.trim()) return
  try {
    const balance = await invoke('get_balance', { address: addrInput.value.trim() })
    walletBalance.textContent = fmtKvnc(balance)
    walletBalance.className = 'value sm ok'
  } catch (e) {
    walletError(e)
  }
}

async function loadHistory() {
  if (!addrInput.value.trim()) return
  try {
    const events = await invoke('get_history', {
      address: addrInput.value.trim(),
      maxBlocks: 0,
    })
    renderHistory(events)
  } catch (e) {
    walletError(e)
  }
}

async function send() {
  const to = toInput.value.trim()
  const amount = Number(amountInput.value)
  if (!to || isNaN(amount) || amount <= 0) {
    walletError('Recipient and a positive amount are required')
    return
  }
  const atoms = Math.floor(amount * ATOM)
  sendBtn.disabled = true
  sendBtn.textContent = 'Sending...'
  try {
    const txId = await invoke('send_from_wallet', { toAddress: to, amount: atoms })
    sendResult.textContent = 'tx ' + txId
    sendResult.className = 'value sm ok'
    addEvent('Sent', { txId })
    amountInput.value = ''
  } catch (e) {
    sendResult.textContent = String(e)
    sendResult.className = 'value sm err'
    walletError(e)
  } finally {
    setWalletUnlocked(true)
    sendBtn.textContent = 'Send'
  }
}

async function saveSnapshot() {
  snapshotBtn.disabled = true
  snapshotBtn.textContent = 'Saving...'
  try {
    const path = await invoke('save_snapshot')
    snapshotStatus.textContent = 'written: ' + path
    snapshotStatus.className = 'value sm ok'
  } catch (e) {
    snapshotStatus.textContent = String(e)
    snapshotStatus.className = 'value sm err'
    addEvent('Error', { message: 'Snapshot failed: ' + e })
  } finally {
    snapshotBtn.disabled = false
    snapshotBtn.textContent = 'Save Snapshot'
  }
}

async function saveCheckpoint() {
  checkpointBtn.disabled = true
  checkpointBtn.textContent = 'Saving...'
  try {
    const path = await invoke('save_checkpoint')
    checkpointStatus.textContent = 'written: ' + path
    checkpointStatus.className = 'value sm ok'
  } catch (e) {
    checkpointStatus.textContent = String(e)
    checkpointStatus.className = 'value sm err'
    addEvent('Error', { message: 'Checkpoint failed: ' + e })
  } finally {
    checkpointBtn.disabled = false
    checkpointBtn.textContent = 'Save Checkpoint'
  }
}

async function startP2P() {
  p2pStartBtn.disabled = true
  p2pStartBtn.textContent = 'Starting...'
  try {
    const peers = p2pPeersInput.value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length)
    const status = await invoke('start_p2p', {
      listenAddr: p2pListenInput.value.trim() || '0.0.0.0:9000',
      bootstrapPeers: peers,
    })
    p2pStatus.textContent = status
    p2pStatus.className = 'value sm ok'
    p2pStopBtn.disabled = false
    p2pStartBtn.textContent = 'Start P2P'
    await refreshStatus()
  } catch (e) {
    p2pStatus.textContent = String(e)
    p2pStatus.className = 'value sm err'
    p2pStartBtn.disabled = false
    p2pStartBtn.textContent = 'Start P2P'
  }
}

async function stopP2P() {
  p2pStopBtn.disabled = true
  try {
    const status = await invoke('stop_p2p')
    p2pStatus.textContent = status
    p2pStatus.className = 'value sm'
    p2pStartBtn.disabled = false
    await refreshStatus()
  } catch (e) {
    p2pStatus.textContent = String(e)
    p2pStatus.className = 'value sm err'
    p2pStopBtn.disabled = false
  }
}

async function spvSync() {
  const url = spvUrlInput.value.trim()
  if (!url) return
  spvSyncBtn.disabled = true
  spvSyncBtn.textContent = 'Syncing...'
  try {
    const info = await invoke('spv_sync', { url })
    spvSyncStatus.textContent = `verified ${info.verified.toLocaleString()} headers · tip #${info.tip_height} ${fmtHash(info.tip_id)}`
    spvSyncStatus.className = 'value sm ok'
    spvMatchBtn.disabled = false
    spvVerifyBtn.disabled = false
    addEvent('SpvSynced', info)
  } catch (e) {
    spvSyncStatus.textContent = String(e)
    spvSyncStatus.className = 'value sm err'
    addEvent('Error', { message: 'SPV sync: ' + e })
  } finally {
    spvSyncBtn.disabled = false
    spvSyncBtn.textContent = 'Light Sync'
  }
}

async function spvMatch() {
  const address = spvAddrInput.value.trim()
  if (!address) return
  try {
    const hits = await invoke('spv_matches', { address })
    spvMatchList.innerHTML = hits.length
      ? hits.map((h) => `<div class="list-item">${fmtHash(h)}</div>`).join('')
      : '<div class="list-item">no matching blocks</div>'
    addEvent('SpvMatches', { address, count: hits.length })
  } catch (e) {
    spvMatchList.innerHTML = '<div class="list-item">error</div>'
    walletError(e)
  }
}

async function spvVerify() {
  const blockId = spvBlockInput.value.trim()
  const txId = spvTxInput.value.trim()
  if (!blockId || !txId) {
    spvVerifyStatus.textContent = 'block id and tx id required'
    spvVerifyStatus.className = 'value sm err'
    return
  }
  spvVerifyBtn.disabled = true
  try {
    const ok = await invoke('spv_verify', { blockId, txId })
    spvVerifyStatus.textContent = ok ? 'proof verified ✓' : 'proof NOT verified'
    spvVerifyStatus.className = ok ? 'value sm ok' : 'value sm err'
    addEvent('SpvVerify', { blockId, txId, ok })
  } catch (e) {
    spvVerifyStatus.textContent = String(e)
    spvVerifyStatus.className = 'value sm err'
  } finally {
    spvVerifyBtn.disabled = false
  }
}

function renderStaking(s) {
  const pk = s.validator_pk ? fmtHash(s.validator_pk) : '(none)'
  const hybrid = s.hybrid_enabled ? `${s.rate_num}/${s.rate_den}` + (s.retarget ? ' · retarget on' : '') : 'off'
  const mine = s.mining ? `every ${s.mining_interval_secs}s` : 'off'
  const pending = s.pending_unbond_height != null
    ? `#${s.pending_unbond_height.toLocaleString()}`
    : '—'
  stakingView.innerHTML = [
    ['validator', pk],
    ['hybrid', hybrid],
    ['total stake', fmtKvnc(s.total_stake)],
    ['my stake', fmtKvnc(s.my_stake)],
    ['chain height', s.chain_height.toLocaleString()],
    ['issuance @tip', fmtKvnc(s.issuance_at_height)],
    ['unbond matures', pending],
    ['mining', mine],
  ]
    .map(([k, v]) => `<div class="list-item">${k}: <span class="value ok">${v}</span></div>`)
    .join('')
}

async function refreshStaking() {
  try {
    const info = await invoke('get_staking')
    renderStaking(info)
    validatorStatus.textContent = info.validator_pk
      ? 'validator set · ' + fmtHash(info.validator_pk)
      : 'no validator identity set'
    validatorStatus.className = 'value sm ' + (info.validator_pk ? 'ok' : '')
    hybridStatus.textContent = info.hybrid_enabled ? 'hybrid on · ' + info.rate_num + '/' + info.rate_den : 'hybrid off'
    hybridStatus.className = 'value sm ' + (info.hybrid_enabled ? 'ok' : '')
    miningStatus.textContent = info.mining ? `mining every ${info.mining_interval_secs}s` : 'mining off (manual Produce Block available)'
    miningStatus.className = 'value sm ' + (info.mining ? 'ok' : '')
    miningStartBtn.disabled = info.mining || !nodeReady
    miningStopBtn.disabled = !info.mining || !nodeReady
  } catch (e) {
    addEvent('Error', { message: 'get_staking: ' + e })
  }
}

async function setValidator() {
  const seed = validatorSeedInput.value.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(seed)) {
    validatorStatus.textContent = 'validator seed must be 32 bytes (64 hex chars)'
    validatorStatus.className = 'value sm err'
    return
  }
  validatorSeedBtn.disabled = true
  try {
    const pk = await invoke('set_validator_seed', { seedHex: seed })
    validatorStatus.textContent = 'validator set · ' + pk
    validatorStatus.className = 'value sm ok'
    addEvent('ValidatorReady', { pk })
    await refreshStaking()
  } catch (e) {
    validatorStatus.textContent = String(e)
    validatorStatus.className = 'value sm err'
    walletError(e)
  } finally {
    validatorSeedBtn.disabled = false
  }
}

async function enableHybrid() {
  const rateNum = Number(hybridRateNum.value)
  const rateDen = Number(hybridRateDen.value)
  if (!rateNum || !rateDen) {
    hybridStatus.textContent = 'rate must be positive integers'
    hybridStatus.className = 'value sm err'
    return
  }
  hybridBtn.disabled = true
  hybridBtn.textContent = 'Enabling...'
  try {
    const msg = await invoke('enable_hybrid', { rateNum, rateDen, retarget: hybridRetarget.checked })
    hybridStatus.textContent = msg
    hybridStatus.className = 'value sm ok'
    addEvent('HybridEnabled', { rateNum, rateDen, retarget: hybridRetarget.checked })
    await refreshStaking()
  } catch (e) {
    hybridStatus.textContent = String(e)
    hybridStatus.className = 'value sm err'
    walletError(e)
  } finally {
    hybridBtn.disabled = false
    hybridBtn.textContent = 'Enable Hybrid'
  }
}

async function bond() {
  const amount = Number(bondAmountInput.value)
  if (!amount || amount <= 0) {
    bondResult.textContent = 'enter a positive KVNC amount'
    bondResult.className = 'value sm err'
    return
  }
  bondBtn.disabled = true
  bondBtn.textContent = 'Bonding...'
  try {
    const txId = await invoke('bond_stake', { amount: Math.floor(amount * ATOM) })
    bondResult.textContent = 'bonded · tx ' + txId
    bondResult.className = 'value sm ok'
    addEvent('Bonded', { txId })
    await refreshStaking()
  } catch (e) {
    bondResult.textContent = String(e)
    bondResult.className = 'value sm err'
    walletError(e)
  } finally {
    bondBtn.disabled = !walletUnlocked
    bondBtn.textContent = 'Bond Stake'
  }
}

async function unbond() {
  const amount = Number(bondAmountInput.value)
  if (!amount || amount <= 0) {
    bondResult.textContent = 'enter a positive KVNC amount'
    bondResult.className = 'value sm err'
    return
  }
  unbondBtn.disabled = true
  unbondBtn.textContent = 'Unbonding...'
  try {
    const txId = await invoke('unbond_stake', { amount: Math.floor(amount * ATOM) })
    bondResult.textContent = 'unbonded · tx ' + txId
    bondResult.className = 'value sm ok'
    addEvent('Unbonded', { txId })
    await refreshStaking()
  } catch (e) {
    bondResult.textContent = String(e)
    bondResult.className = 'value sm err'
    walletError(e)
  } finally {
    unbondBtn.disabled = !walletUnlocked
    unbondBtn.textContent = 'Unbond'
  }
}

async function startMining() {
  const seconds = Math.floor(Number(miningIntervalInput.value))
  if (!seconds || seconds <= 0) {
    miningStatus.textContent = 'interval must be a positive integer of seconds'
    miningStatus.className = 'value sm err'
    return
  }
  miningStartBtn.disabled = true
  try {
    const msg = await invoke('start_mining', { intervalSecs: seconds })
    miningStatus.textContent = msg
    miningStatus.className = 'value sm ok'
    addEvent('MiningStarted', { intervalSecs: seconds })
    await refreshStaking()
  } catch (e) {
    miningStatus.textContent = String(e)
    miningStatus.className = 'value sm err'
    walletError(e)
  }
}

async function stopMining() {
  miningStopBtn.disabled = true
  try {
    const msg = await invoke('stop_mining')
    miningStatus.textContent = msg
    miningStatus.className = 'value sm'
    addEvent('MiningStopped', {})
    await refreshStaking()
  } catch (e) {
    miningStatus.textContent = String(e)
    miningStatus.className = 'value sm err'
    walletError(e)
  }
}

async function shutdown() {
  if (!window.confirm('Shut down the embedded node and exit the app?')) return
  shutdownBtn.disabled = true
  shutdownBtn.textContent = 'Shutting down...'
  try {
    await invoke('shutdown_node')
    shutdownStatus.textContent = 'worker stopped'
    shutdownStatus.className = 'value sm ok'
    addEvent('Shutdown', {})
    await getCurrentWindow().close()
  } catch (e) {
    shutdownStatus.textContent = String(e)
    shutdownStatus.className = 'value sm err'
    shutdownBtn.disabled = false
    shutdownBtn.textContent = 'Shutdown'
  }
}

async function init() {
  setStatus('Starting node…', 'warn')

  await listen('node-event', async (event) => {
    const { type, data } = event.payload
    addEvent(type, data)

    if (type === 'Booted') {
      setStatus(data.genesis.slice(0, 12) + '…', 'ok')
      networkBadge.title = data.genesis
      nodeReady = true
      produceBtn.disabled = false
      statusBtn.disabled = false
      snapshotBtn.disabled = false
      checkpointBtn.disabled = false
      shutdownBtn.disabled = false
      p2pStartBtn.disabled = false
      spvSyncBtn.disabled = false
      validatorSeedBtn.disabled = false
      hybridBtn.disabled = false
      miningStartBtn.disabled = false
      setWalletUnlocked(walletUnlocked)
      await refreshStatus()
      await refreshStaking()
    } else if (type === 'TipChanged' || type === 'BlockProduced' || type === 'BlockReceived') {
      await refreshStatus()
    } else if (type === 'PeerConnected' || type === 'PeerDisconnected') {
      await refreshStatus()
    } else if (type === 'ValidatorReady' || type === 'HybridEnabled' || type === 'Bonded' || type === 'Unbonded') {
      await refreshStaking()
    }
  })

  setTimeout(refreshStatus, 500)
}

produceBtn.addEventListener('click', produceBlock)
statusBtn.addEventListener('click', refreshStatus)
createWalletBtn.addEventListener('click', createWallet)
unlockWalletBtn.addEventListener('click', unlockWallet)
lockWalletBtn.addEventListener('click', lockWallet)
addressesBtn.addEventListener('click', refreshAddresses)
balanceBtn.addEventListener('click', loadBalance)
assetsBtn.addEventListener('click', loadAssets)
historyBtn.addEventListener('click', loadHistory)
sendBtn.addEventListener('click', send)
snapshotBtn.addEventListener('click', saveSnapshot)
checkpointBtn.addEventListener('click', saveCheckpoint)
p2pStartBtn.addEventListener('click', startP2P)
p2pStopBtn.addEventListener('click', stopP2P)
spvSyncBtn.addEventListener('click', spvSync)
spvMatchBtn.addEventListener('click', spvMatch)
spvVerifyBtn.addEventListener('click', spvVerify)
shutdownBtn.addEventListener('click', shutdown)
validatorSeedBtn.addEventListener('click', setValidator)
hybridBtn.addEventListener('click', enableHybrid)
bondBtn.addEventListener('click', bond)
unbondBtn.addEventListener('click', unbond)
miningStartBtn.addEventListener('click', startMining)
miningStopBtn.addEventListener('click', stopMining)

init()