import Foundation

@MainActor
final class WalletViewModel: ObservableObject {
    enum WalletUIState: Equatable {
        case loading
        case error(String)
        case data(WalletData)
    }

    struct WalletData: Equatable {
        var address: String = ""
        var balance: Int64 = 0
        var balanceFormatted: String = "0.00"
        var network: String = ""
        var tokenSymbol: String = NetworkConstants.TOKEN_SYMBOL
        var tokenName: String = NetworkConstants.TOKEN_NAME
        var blockHeight: Int = 0
        var minFee: Int64 = 0
        var faucetAvailable: Bool = false
        var history: [HistoryEntry] = []
        var historyOffset: Int = 0
        var historyHasMore: Bool = true
        var isLoadingHistory: Bool = false
        var faucetLoading: Bool = false
        var faucetMessage: String?
        var nodeURL: String
    }

    @Published var state: WalletUIState = .loading
    @Published var nodeURL: String = NetworkConstants.KOVANICA_API_DEFAULT

    private let defaultsKey = "kvnc_node_url"
    private var repository: WalletRepository

    init() {
        let saved = UserDefaults.standard.string(forKey: "kvnc_node_url") ?? NetworkConstants.KOVANICA_API_DEFAULT
        self.nodeURL = saved
        self.repository = WalletRepository(baseURL: saved)
    }

    var data: WalletData? {
        if case .data(let d) = state { return d }
        return nil
    }

    func load() async {
        state = .loading
        do {
            let head = try await repository.fetchHead()
            let stateResp = try await repository.fetchState()

            var wd = WalletData()
            wd.network = head.network
            wd.blockHeight = head.blocks
            wd.minFee = head.minFee
            wd.faucetAvailable = stateResp.faucet
            wd.nodeURL = nodeURL

            if let addr = try? await repository.fetchBalance(address: "kvnc_test_address_placeholder") {
                wd.address = addr.address
                wd.balance = addr.balance
                wd.balanceFormatted = TokenFormatter.formatBalanceDisplay(addr.balance)
            }

            let history = try await repository.fetchHistory(address: wd.address, limit: 20, offset: 0)
            wd.history = history
            wd.historyOffset = history.count
            wd.historyHasMore = history.count >= 20

            state = .data(wd)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    func loadWalletAddress(_ address: String) async {
        state = .loading
        do {
            let head = try await repository.fetchHead()
            let stateResp = try await repository.fetchState()
            let balanceResp = try await repository.fetchBalance(address: address)
            let history = try await repository.fetchHistory(address: address, limit: 20, offset: 0)

            var wd = WalletData()
            wd.address = balanceResp.address
            wd.balance = balanceResp.balance
            wd.balanceFormatted = TokenFormatter.formatBalanceDisplay(balanceResp.balance)
            wd.network = head.network
            wd.blockHeight = head.blocks
            wd.minFee = head.minFee
            wd.faucetAvailable = stateResp.faucet
            wd.nodeURL = nodeURL
            wd.history = history
            wd.historyOffset = history.count
            wd.historyHasMore = history.count >= 20

            state = .data(wd)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    func requestFaucet() async {
        guard var wd = data, !wd.faucetLoading else { return }
        wd.faucetLoading = true
        wd.faucetMessage = nil
        state = .data(wd)

        do {
            let resp = try await repository.requestFaucet(address: wd.address)
            if let msg = resp.error {
                var updated = wd
                updated.faucetLoading = false
                updated.faucetMessage = msg
                state = .data(updated)
            } else if resp.ok == true || resp.tx != nil {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                let balanceResp = try await repository.fetchBalance(address: wd.address)
                var updated = wd
                updated.balance = balanceResp.balance
                updated.balanceFormatted = TokenFormatter.formatBalanceDisplay(balanceResp.balance)
                updated.faucetLoading = false
                updated.faucetMessage = "1 KVNC received"
                let history = try await repository.fetchHistory(address: wd.address, limit: 20, offset: 0)
                updated.history = history
                updated.historyOffset = history.count
                updated.historyHasMore = history.count >= 20
                state = .data(updated)
            } else {
                var updated = wd
                updated.faucetLoading = false
                updated.faucetMessage = "Faucet request sent"
                state = .data(updated)
            }
        } catch {
            var updated = wd
            updated.faucetLoading = false
            updated.faucetMessage = "Error: \(error.localizedDescription)"
            state = .data(updated)
        }
    }

    func loadMoreHistory() async {
        guard var wd = data, wd.historyHasMore, !wd.isLoadingHistory else { return }
        wd.isLoadingHistory = true
        state = .data(wd)

        do {
            let more = try await repository.fetchHistory(address: wd.address, limit: 20, offset: wd.historyOffset)
            var updated = wd
            updated.history.append(contentsOf: more)
            updated.historyOffset += more.count
            updated.historyHasMore = more.count >= 20
            updated.isLoadingHistory = false
            state = .data(updated)
        } catch {
            var updated = wd
            updated.isLoadingHistory = false
            state = .data(updated)
        }
    }

    func setNodeURL(_ url: String) {
        nodeURL = url
        UserDefaults.standard.set(url, forKey: defaultsKey)
        repository = WalletRepository(baseURL: url)
    }

    func refresh() async {
        guard let wd = data else {
            await load()
            return
        }
        await loadWalletAddress(wd.address)
    }
}
