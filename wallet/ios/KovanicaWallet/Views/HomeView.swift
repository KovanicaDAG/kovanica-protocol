import SwiftUI

struct HomeView: View {
    @ObservedObject var viewModel: WalletViewModel
    let data: WalletViewModel.WalletData

    @State private var showReceive = false
    @State private var showHistory = false

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                headerCard
                balanceCard
                networkBadge
                actionButtons
                faucetSection
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
        .sheet(isPresented: $showReceive) {
            ReceiveView(address: data.address)
        }
        .sheet(isPresented: $showHistory) {
            HistoryView(viewModel: viewModel, data: data)
        }
    }

    private var headerCard: some View {
        VStack(spacing: 12) {
            Image("AppIcon")
                .resizable()
                .frame(width: 80, height: 80)
                .clipShape(Circle())
                .overlay(
                    Circle().stroke(KVNCBrand.accent.opacity(0.4), lineWidth: 2)
                )
            Text("Kovanica Wallet")
                .font(.title2)
                .fontWeight(.semibold)
                .foregroundColor(KVNCBrand.foreground)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
        .background(KVNCBrand.secondary.opacity(0.5))
        .cornerRadius(16)
    }

    private var balanceCard: some View {
        VStack(spacing: 8) {
            Text("Balance")
                .font(.caption)
                .foregroundColor(KVNCBrand.muted)
                .textCase(.uppercase)
                .tracking(1)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(data.balanceFormatted)
                    .font(.system(size: 36, weight: .bold, design: .monospaced))
                    .foregroundColor(KVNCBrand.foreground)
                Text(data.tokenSymbol)
                    .font(.title3)
                    .foregroundColor(KVNCBrand.accent)
            }
            if !data.address.isEmpty {
                HStack(spacing: 4) {
                    Text(TokenFormatter.truncateAddress(data.address))
                        .font(.caption)
                        .foregroundColor(KVNCBrand.muted)
                    Button {
                        UIPasteboard.general.string = data.address
                    } label: {
                        Image(systemName: "doc.on.doc")
                            .font(.caption2)
                            .foregroundColor(KVNCBrand.accent)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
        .background(KVNCBrand.secondary.opacity(0.5))
        .cornerRadius(16)
    }

    private var networkBadge: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(data.faucetAvailable ? Color.green : Color.orange)
                .frame(width: 8, height: 8)
            Text("\(data.tokenSymbol) \u{00B7} \(data.network)")
                .font(.caption)
                .foregroundColor(KVNCBrand.muted)
            Spacer()
            Text("Block \(data.blockHeight)")
                .font(.caption2)
                .foregroundColor(KVNCBrand.muted)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(KVNCBrand.secondary.opacity(0.3))
        .cornerRadius(10)
    }

    private var actionButtons: some View {
        HStack(spacing: 12) {
            Button {
                showReceive = true
            } label: {
                Label("Receive", systemImage: "arrow.down.circle.fill")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .tint(KVNCBrand.accent)

            Button {
                showHistory = true
            } label: {
                Label("History", systemImage: "clock.fill")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .tint(KVNCBrand.secondary)

            Button {} label: {
                Label("Send", systemImage: "arrow.up.circle.fill")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.bordered)
            .tint(KVNCBrand.muted)
            .disabled(true)
            .overlay(
                Text("Soon")
                    .font(.system(size: 8, weight: .medium))
                    .foregroundColor(KVNCBrand.muted)
                    .offset(x: 28, y: -14)
            )
        }
        .foregroundColor(KVNCBrand.foreground)
    }

    private var faucetSection: some View {
        VStack(spacing: 12) {
            if let msg = data.faucetMessage {
                Text(msg)
                    .font(.caption)
                    .foregroundColor(KVNCBrand.accent)
            }
            if data.faucetAvailable {
                Button {
                    Task { await viewModel.requestFaucet() }
                } label: {
                    HStack {
                        if data.faucetLoading {
                            ProgressView()
                                .scaleEffect(0.8)
                                .tint(KVNCBrand.foreground)
                        } else {
                            Image(systemName: "drop.fill")
                        }
                        Text("Request Testnet KVNC")
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                }
                .buttonStyle(.borderedProminent)
                .tint(KVNCBrand.accent.opacity(0.7))
                .disabled(data.faucetLoading)
            }
        }
    }
}
