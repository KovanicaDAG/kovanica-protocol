import Foundation
import SwiftUI
import Combine

@MainActor
class WalletViewModel: ObservableObject {
    @Published var isWalletReady = false
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var walletData: WalletData?
    @Published var transactions: [Transaction] = []
    @Published var headData: HeadData?
    @Published var authorities: [Authority] = []
    @Published var sendResult: String?

    private let apiBase = "https://explorer.kovanica.online"
    private var cancellables = Set<AnyCancellable>()

    /// Restore (or create) the wallet from a recovery phrase.
    ///
    /// Derivation is delegated to the Rust authority via the light-node FFI
    /// (`KovanicaKeys`), so the address on screen is the one the ledger
    /// credits. The passphrase is honoured, not ignored — dropping it would
    /// show a permanently empty address instead of an error.
    ///
    /// The signing key goes out of scope here: this build has no send path,
    /// and custody moves to the Keychain in the change that wires signing.
    func initializeWallet(phrase: String, passphrase: String) {
        isLoading = true
        errorMessage = nil

        let account: KovanicaKeys.Account
        do {
            account = try KovanicaKeys.account(fromMnemonic: phrase, passphrase: passphrase)
        } catch {
            // No address, no wallet. Never fall back to a placeholder: a wallet
            // showing an address that holds nothing is worse than one that
            // refuses to open.
            errorMessage = error.localizedDescription
            isWalletReady = false
            isLoading = false
            return
        }

        walletData = WalletData(
            address: account.address,
            balance: "0",
            chainHeight: 0,
            blockCount: 0,
            selectedTip: "",
            isSyncing: true
        )

        isWalletReady = true
        isLoading = false

        Task {
            await refresh()
        }
    }

    func refresh() async {
        guard let wallet = walletData else { return }

        isLoading = true
        defer { isLoading = false }

        do {
            // Fetch head
            if let head = try? await fetchHead() {
                headData = head
                walletData = WalletData(
                    address: wallet.address,
                    balance: wallet.balance,
                    chainHeight: head.chainHeight,
                    blockCount: head.blockCount,
                    selectedTip: head.selectedTip,
                    isSyncing: false
                )
            }

            // Fetch balance
            if let balance = try? await fetchBalance(address: wallet.address) {
                walletData = WalletData(
                    address: wallet.address,
                    balance: balance,
                    chainHeight: walletData?.chainHeight ?? 0,
                    blockCount: walletData?.blockCount ?? 0,
                    selectedTip: walletData?.selectedTip ?? "",
                    isSyncing: false
                )
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Send KVNC to `address`.
    ///
    /// Not yet wired: signing and submission need a `LightNode` from the FFI,
    /// which needs the network's PoA authority set before its genesis matches
    /// the chain (RFC-POA §0.9 blocker B1). Until that lands this reports the
    /// gap instead of claiming a transaction was prepared — a send screen that
    /// says "done" when nothing was broadcast is the worst failure mode here.
    func send(to address: String, amount: String) async {
        isLoading = true
        defer { isLoading = false }

        sendResult = nil
        errorMessage = "Sending is not available in this build: it needs a synced light node, "
            + "which this app does not run. Your funds are untouched."
    }

    func loadHistory() async {
        guard let wallet = walletData else { return }
        // Fetch history from API
    }

    // MARK: - Private

    private func fetchHead() async throws -> HeadData {
        guard let url = URL(string: "\(apiBase)/api/head") else {
            throw URLError(.badURL)
        }
        let (data, _) = try await URLSession.shared.data(from: url)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? []

        return HeadData(
            genesis: json["genesis"] as? String ?? "",
            selectedTip: json["selected_tip"] as? String ?? "",
            blockCount: json["block_count"] as? Int ?? 0,
            chainHeight: json["chain_height"] as? Int ?? 0,
            maxSupply: json["max_supply"] as? String ?? "0",
            minted: json["minted"] as? String ?? "0",
            minFee: json["min_fee"] as? Int ?? 0,
            finalityDepth: json["finality_depth"] as? Int ?? 0,
            era: json["era"] as? Int ?? 0,
            eraLen: json["era_len"] as? Int ?? 0,
            subsidy: json["subsidy"] as? String ?? "0"
        )
    }

    private func fetchBalance(address: String) async throws -> String {
        guard let url = URL(string: "\(apiBase)/api/balance/\(address)") else {
            throw URLError(.badURL)
        }
        let (data, _) = try await URLSession.shared.data(from: url)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? []
        return json["balance"] as? String ?? "0"
    }
}
