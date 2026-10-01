import Foundation

struct WalletData {
    let address: String
    let balance: String
    let chainHeight: Int
    let blockCount: Int
    let selectedTip: String
    let isSyncing: Bool
}

struct Transaction: Identifiable {
    let id: String
    let direction: TransactionDirection
    let amount: String
    let timestamp: Date
    let txId: String
}

enum TransactionDirection {
    case sent
    case received
}

struct Utxo: Identifiable {
    let id: String
    let outpoint: String
    let value: String
    let address: String
}

struct HeadData {
    let genesis: String
    let selectedTip: String
    let blockCount: Int
    let chainHeight: Int
    let maxSupply: String
    let minted: String
    let minFee: Int
    let finalityDepth: Int
    let era: Int
    let eraLen: Int
    let subsidy: String
}

struct Authority: Identifiable {
    let id = UUID()
    let pubkey: String
    let slot: Int
}
