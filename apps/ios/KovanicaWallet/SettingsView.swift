import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var viewModel: WalletViewModel
    @State private var notificationsEnabled = true
    @State private var autoSync = true
    @State private var syncInterval = 30.0

    var body: some View {
        NavigationView {
            List {
                // Wallet Section
                Section("Wallet") {
                    if let address = viewModel.walletData?.address {
                        HStack {
                            Text("Address")
                            Spacer()
                            Text(address)
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }

                    HStack {
                        Text("Balance")
                        Spacer()
                        Text("\(formatKVNC(viewModel.walletData?.balance ?? "0")) KVNC")
                            .foregroundColor(.secondary)
                    }

                    Button("Refresh Wallet") {
                        Task {
                            await viewModel.refresh()
                        }
                    }
                }

                // Network Section
                Section("Network") {
                    HStack {
                        Text("API Endpoint")
                        Spacer()
                        Text("explorer.kovanica.online")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    Toggle("Auto Sync", isOn: $autoSync)

                    if autoSync {
                        VStack(alignment: .leading) {
                            Text("Sync Interval: \(Int(syncInterval))s")
                                .font(.caption)
                            Slider(value: $syncInterval, in: 10...300, step: 10)
                        }
                    }
                }

                // Notifications Section
                Section("Notifications") {
                    Toggle("Push Notifications", isOn: $notificationsEnabled)
                }

                // About Section
                Section("About") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("0.1.0")
                            .foregroundColor(.secondary)
                    }

                    HStack {
                        Text("Network")
                        Spacer()
                        Text("Testnet")
                            .foregroundColor(.secondary)
                    }

                    Link("Documentation", destination: URL(string: "https://docs.kovanica.online")!)
                    Link("Explorer", destination: URL(string: "https://explorer.kovanica.online")!)
                }

                // Danger Zone
                Section("Danger Zone") {
                    Button("Reset Wallet", role: .destructive) {
                        viewModel.isWalletReady = false
                        viewModel.walletData = nil
                        viewModel.transactions = []
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }
}

#Preview {
    SettingsView()
        .environmentObject(WalletViewModel())
}
