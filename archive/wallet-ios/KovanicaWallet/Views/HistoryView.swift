import SwiftUI

struct HistoryView: View {
    @ObservedObject var viewModel: WalletViewModel
    let data: WalletViewModel.WalletData

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                KVNCBrand.background.ignoresSafeArea()
                if data.history.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "clock.badge.questionmark")
                            .font(.largeTitle)
                            .foregroundColor(KVNCBrand.muted)
                        Text("No transactions yet")
                            .foregroundColor(KVNCBrand.muted)
                    }
                } else {
                    List {
                        ForEach(data.history) { entry in
                            historyRow(entry)
                                .listRowBackground(KVNCBrand.secondary.opacity(0.3))
                        }
                        if data.historyHasMore {
                            Button {
                                Task { await viewModel.loadMoreHistory() }
                            } label: {
                                if data.isLoadingHistory {
                                    ProgressView()
                                        .frame(maxWidth: .infinity)
                                } else {
                                    Text("Load More")
                                        .foregroundColor(KVNCBrand.accent)
                                        .frame(maxWidth: .infinity)
                                }
                            }
                            .listRowBackground(Color.clear)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Transaction History")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                        .foregroundColor(KVNCBrand.accent)
                }
            }
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    private func historyRow(_ entry: HistoryEntry) -> some View {
        HStack(spacing: 12) {
            kindIcon(entry.kind)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(kindLabel(entry.kind))
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundColor(KVNCBrand.foreground)
                    Spacer()
                    Text(signedAmount(entry))
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(entry.kind == "in" || entry.kind == "faucet" ? .green : KVNCBrand.accent)
                }
                HStack {
                    Text("Block \(entry.height)")
                        .font(.caption2)
                        .foregroundColor(KVNCBrand.muted)
                    Spacer()
                    Text(String(entry.tx.prefix(12)) + "...")
                        .font(.caption2)
                        .foregroundColor(KVNCBrand.muted)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func kindIcon(_ kind: String) -> some View {
        Group {
            switch kind {
            case "in":
                Image(systemName: "arrow.down.circle.fill").foregroundColor(.green)
            case "out":
                Image(systemName: "arrow.up.circle.fill").foregroundColor(KVNCBrand.accent)
            case "faucet":
                Image(systemName: "drop.fill").foregroundColor(.cyan)
            case "coinbase":
                Image(systemName: "star.circle.fill").foregroundColor(KVNCBrand.accent)
            default:
                Image(systemName: "circle.fill").foregroundColor(KVNCBrand.muted)
            }
        }
        .font(.title3)
    }

    private func kindLabel(_ kind: String) -> String {
        switch kind {
        case "in": return "Received"
        case "out": return "Sent"
        case "faucet": return "Faucet"
        case "coinbase": return "Coinbase"
        default: return kind.capitalized
        }
    }

    private func signedAmount(_ entry: HistoryEntry) -> String {
        let formatted = TokenFormatter.formatAtomsShort(entry.amount)
        if entry.kind == "in" || entry.kind == "faucet" || entry.kind == "coinbase" {
            return "+" + formatted
        }
        return "-" + formatted
    }
}
