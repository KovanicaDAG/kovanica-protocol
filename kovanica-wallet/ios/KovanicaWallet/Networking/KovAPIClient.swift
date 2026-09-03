import Foundation

enum KovAPIError: LocalizedError {
    case invalidURL
    case httpError(statusCode: Int)
    case decodingError(Error)
    case networkError(Error)
    case serverError(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .httpError(let code):
            return "HTTP error \(code)"
        case .decodingError(let err):
            return "Decoding error: \(err.localizedDescription)"
        case .networkError(let err):
            return "Network error: \(err.localizedDescription)"
        case .serverError(let msg):
            return msg
        }
    }
}

enum KovEndpoint {
    case head
    case bootstrap
    case feeEstimate
    case state
    case address(String)
    case utxos(address: String, limit: Int)
    case history(address: String, limit: Int, offset: Int)
    case blocks(from: Int)
    case faucet

    func path(baseURL: String) -> String {
        switch self {
        case .head:
            return "\(baseURL)/api/head"
        case .bootstrap:
            return "\(baseURL)/api/bootstrap"
        case .feeEstimate:
            return "\(baseURL)/api/fee_estimate"
        case .state:
            return "\(baseURL)/api/state"
        case .address(let addr):
            return "\(baseURL)/api/address/\(addr)"
        case .utxos(let addr, let limit):
            return "\(baseURL)/api/utxos?address=\(addr)&limit=\(limit)"
        case .history(let addr, let limit, let offset):
            return "\(baseURL)/api/history?address=\(addr)&limit=\(limit)&offset=\(offset)"
        case .blocks(let from):
            return "\(baseURL)/api/blocks?from=\(from)"
        case .faucet:
            return "\(baseURL)/api/faucet"
        }
    }
}

final class KovAPIClient: Sendable {
    let session: URLSession
    let defaultBaseURL: String

    init(baseURL: String = NetworkConstants.KOVANICA_API_DEFAULT) {
        self.defaultBaseURL = baseURL
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        self.session = URLSession(configuration: config)
    }

    func get<T: Decodable>(_ endpoint: KovEndpoint) async throws -> T {
        let urlString = endpoint.path(baseURL: defaultBaseURL)
        guard let url = URL(string: urlString) else {
            throw KovAPIError.invalidURL
        }
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw KovAPIError.networkError(URLError(.badServerResponse))
        }
        guard (200...299).contains(http.statusCode) else {
            throw KovAPIError.httpError(statusCode: http.statusCode)
        }
        let decoder = JSONDecoder()
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw KovAPIError.decodingError(error)
        }
    }

    func post<B: Encodable, R: Decodable>(_ endpoint: KovEndpoint, body: B) async throws -> R {
        let urlString = endpoint.path(baseURL: defaultBaseURL)
        guard let url = URL(string: urlString) else {
            throw KovAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw KovAPIError.networkError(URLError(.badServerResponse))
        }
        guard (200...299).contains(http.statusCode) else {
            let bodyStr = String(data: data, encoding: .utf8) ?? "unknown"
            throw KovAPIError.serverError("HTTP \(http.statusCode): \(bodyStr)")
        }
        let decoder = JSONDecoder()
        do {
            return try decoder.decode(R.self, from: data)
        } catch {
            throw KovAPIError.decodingError(error)
        }
    }
}
