import Foundation

final class WalletRepository: Sendable {
    private let api: KovAPIClient

    init(baseURL: String = NetworkConstants.KOVANICA_API_DEFAULT) {
        self.api = KovAPIClient(baseURL: baseURL)
    }

    func fetchHead() async throws -> HeadResponse {
        try await api.get(.head)
    }

    func fetchBootstrap() async throws -> BootstrapResponse {
        try await api.get(.bootstrap)
    }

    func fetchFeeEstimate() async throws -> FeeEstimateResponse {
        try await api.get(.feeEstimate)
    }

    func fetchState() async throws -> StateResponse {
        try await api.get(.state)
    }

    func fetchBalance(address: String) async throws -> AddressResponse {
        try await api.get(.address(address))
    }

    func fetchUTXOs(address: String, limit: Int = 50) async throws -> [UTXOResponse] {
        try await api.get(.utxos(address: address, limit: limit))
    }

    func fetchHistory(address: String, limit: Int = 20, offset: Int = 0) async throws -> [HistoryEntry] {
        try await api.get(.history(address: address, limit: limit, offset: offset))
    }

    func requestFaucet(address: String) async throws -> FaucetResponse {
        try await api.post(.faucet, body: FaucetRequest(address: address))
    }
}
