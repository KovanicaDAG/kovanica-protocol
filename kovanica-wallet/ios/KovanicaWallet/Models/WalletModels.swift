import Foundation

enum NetworkConstants {
    static let ATOM: Int64 = 100_000_000
    static let KOVANICA_API_DEFAULT = "https://explorer.kovanica.online"
    static let TOKEN_SYMBOL = "KVNC"
    static let TOKEN_NAME = "Kovanica"
    static let DECIMALS = 8
}

// MARK: - API Response Models

struct HeadResponse: Codable {
    let network: String
    let genesis: String
    let tip: String
    let blocks: Int
    let minFee: Int64
    let atom: Int64

    enum CodingKeys: String, CodingKey {
        case network, genesis, tip, blocks
        case minFee = "min_fee"
        case atom
    }
}

struct BootstrapResponse: Codable {
    let network: String
    let genesis: String
    let tip: String
    let listen: String
    let peers: [String]
    let pow: Bool
    let minFee: Int64
    let atom: Int64
    let token: String
    let k: Int
    let subsidy: Int64
    let founderAmount: Int64
    let founderSeed: Int
    let finalityDepth: Int
    let payloadPruningDepth: Int
    let lightConfig: LightConfig

    enum CodingKeys: String, CodingKey {
        case network, genesis, tip, listen, peers, pow
        case minFee = "min_fee"
        case atom, token, k, subsidy
        case founderAmount = "founder_amount"
        case founderSeed = "founder_seed"
        case finalityDepth = "finality_depth"
        case payloadPruningDepth = "payload_pruning_depth"
        case lightConfig = "light_config"
    }
}

struct LightConfig: Codable {
    let enabled: Bool?
    let maxPeers: Int?

    enum CodingKeys: String, CodingKey {
        case enabled
        case maxPeers = "max_peers"
    }
}

struct FeeEstimateResponse: Codable {
    let feeRate: Int
    let unit: String
    let mempool: Int
    let bytes: Int

    enum CodingKeys: String, CodingKey {
        case feeRate = "fee_rate"
        case unit, mempool, bytes
    }
}

struct StateResponse: Codable {
    let selected: String
    let mining: Bool
    let faucet: Bool
    let allowReset: Bool
    let `operator`: Bool
    let network: String
    let listen: String
    let peers: [String]
    let mesh: [String: AnyCodable]?

    enum CodingKeys: String, CodingKey {
        case selected, mining, faucet
        case allowReset = "allow_reset"
        case `operator`
        case network, listen, peers, mesh
    }
}

struct AddressResponse: Codable {
    let address: String
    let balance: Int64
    let txCount: Int

    enum CodingKeys: String, CodingKey {
        case address, balance
        case txCount = "tx_count"
    }
}

struct UTXOResponse: Codable {
    let address: String
    let balance: Int64
    let txCount: Int

    enum CodingKeys: String, CodingKey {
        case address, balance
        case txCount = "tx_count"
    }
}

struct HistoryEntry: Codable, Identifiable {
    var id: String { tx + String(height) }
    let block: String
    let tx: String
    let kind: String
    let amount: Int64
    let from: String
    let to: String
    let height: Int
}

struct FaucetRequest: Codable {
    let address: String
}

struct FaucetResponse: Codable {
    let tx: String?
    let ok: Bool?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case tx, ok, error
    }
}

// MARK: - Helper for arbitrary JSON

struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let intVal = try? container.decode(Int.self) {
            value = intVal
        } else if let doubleVal = try? container.decode(Double.self) {
            value = doubleVal
        } else if let boolVal = try? container.decode(Bool.self) {
            value = boolVal
        } else if let stringVal = try? container.decode(String.self) {
            value = stringVal
        } else if let dictVal = try? container.decode([String: AnyCodable].self) {
            value = dictVal
        } else if let arrayVal = try? container.decode([AnyCodable].self) {
            value = arrayVal
        } else {
            value = ()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let intVal = value as? Int {
            try container.encode(intVal)
        } else if let doubleVal = value as? Double {
            try container.encode(doubleVal)
        } else if let boolVal = value as? Bool {
            try container.encode(boolVal)
        } else if let stringVal = value as? String {
            try container.encode(stringVal)
        } else {
            try container.encodeNil()
        }
    }
}

// MARK: - Formatting

enum TokenFormatter {
    static func formatAtoms(_ atoms: Int64) -> String {
        let kvnc = Double(atoms) / Double(NetworkConstants.ATOM)
        let formatted = String(format: "%.8f", kvnc)
        return formatted
    }

    static func formatAtomsShort(_ atoms: Int64) -> String {
        let kvnc = Double(atoms) / Double(NetworkConstants.ATOM)
        if kvnc == 0 {
            return "0 KVNC"
        }
        if kvnc < 0.00000001 {
            return String(format: "%.10f KVNC", kvnc)
        }
        return String(format: "%.8f KVNC", kvnc)
    }

    static func formatBalanceDisplay(_ atoms: Int64) -> String {
        let kvnc = Double(atoms) / Double(NetworkConstants.ATOM)
        if kvnc >= 1.0 {
            return String(format: "%.2f", kvnc)
        }
        return String(format: "%.8f", kvnc)
    }

    static func truncateAddress(_ address: String, front: Int = 8, back: Int = 4) -> String {
        guard address.count > front + back + 3 else { return address }
        let frontPart = String(address.prefix(front))
        let backPart = String(address.suffix(back))
        return "\(frontPart)...\(backPart)"
    }
}
