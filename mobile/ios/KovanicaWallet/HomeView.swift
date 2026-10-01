import SwiftUI

struct HomeView: View {
    @EnvironmentObject var viewModel: WalletViewModel

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // Balance Card
                    BalanceCard()

                    // Chain Info
                    ChainInfoCard()

                    // Recent Transactions
                    TransactionsCard()
                }
                .padding()
            }
            .navigationTitle("Kovanica")
            .refreshable {
                await viewModel.refresh()
            }
        }
    }
}

struct BalanceCard: View {
    @EnvironmentObject var viewModel: WalletViewModel

    var body: some View {
        VStack(spacing: 12) {
            Text("Total Balance")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Text(formatKVNC(viewModel.walletData?.balance ?? "0"))
                .font(.system(size: 36, weight: .bold, design: .rounded))
                .foregroundColor(.kvncBlue)

            Text("KVNC")
                .font(.caption)
                .foregroundColor(.secondary)

            if let address = viewModel.walletData?.address {
                Text(address)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .background(
            LinearGradient(
                colors: [.kvncBlue, .kvncDarkBlue],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .foregroundColor(.white)
        .cornerRadius(16)
        .shadow(radius: 8)
    }
}

struct ChainInfoCard: View {
    @EnvironmentObject var viewModel: WalletViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Chain Info")
                .font(.headline)

            HStack {
                InfoItem(title: "Height", value: "\(viewModel.walletData?.chainHeight ?? 0)")
                Spacer()
                InfoItem(title: "Blocks", value: "\(viewModel.walletData?.blockCount ?? 0)")
            }

            if let tip = viewModel.walletData?.selectedTip, !tip.isEmpty {
                HStack {
                    Text("Tip:")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(tip)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
        .padding()
        .background(Color.white)
        .cornerRadius(12)
        .shadow(radius: 2)
    }
}

struct InfoItem: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
            Text(value)
                .font(.subheadline)
                .fontWeight(.semibold)
        }
    }
}

struct TransactionsCard: View {
    @EnvironmentObject var viewModel: WalletViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recent Transactions")
                .font(.headline)

            if viewModel.transactions.isEmpty {
                Text("No transactions yet")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding()
            } else {
                ForEach(viewModel.transactions.prefix(5)) { tx in
                    TransactionRow(transaction: tx)
                }
            }
        }
        .padding()
        .background(Color.white)
        .cornerRadius(12)
        .shadow(radius: 2)
    }
}

struct TransactionRow: View {
    let transaction: Transaction

    var body: some View {
        HStack {
            Image(systemName: transaction.direction == .received ? "arrow.down.circle.fill" : "arrow.up.circle.fill")
                .foregroundColor(transaction.direction == .received ? .kvncGreen : .kvncRed)

            VStack(alignment: .leading, spacing: 2) {
                Text(transaction.direction == .received ? "Received" : "Sent")
                    .font(.subheadline)
                Text(transaction.txId)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            Text("\(transaction.direction == .received ? "+" : "-")\(formatKVNC(transaction.amount))")
                .font(.subheadline)
                .fontWeight(.semibold)
                .foregroundColor(transaction.direction == .received ? .kvncGreen : .kvncRed)
        }
        .padding(.vertical, 4)
    }
}

func formatKVNC(_ atoms: String) -> String {
    guard let value = Double(atoms) else { return "0.00" }
    let kvnc = value / 100_000_000
    return String(format: "%.2f", kvnc)
}

#Preview {
    HomeView()
        .environmentObject(WalletViewModel())
}
