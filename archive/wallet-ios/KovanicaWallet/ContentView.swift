import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = WalletViewModel()
    @State private var showAddressEntry = false
    @State private var manualAddress = ""

    var body: some View {
        NavigationStack {
            ZStack {
                KVNCBrand.background.ignoresSafeArea()

                switch viewModel.state {
                case .loading:
                    loadingView
                case .error(let msg):
                    errorView(msg)
                case .data(let data):
                    HomeView(viewModel: viewModel, data: data)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Kovanica Wallet")
                        .font(.headline)
                        .foregroundColor(KVNCBrand.foreground)
                }
            }
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .sheet(isPresented: $showAddressEntry) {
            addressEntrySheet
        }
        .task {
            await viewModel.load()
        }
    }

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .tint(KVNCBrand.accent)
            Text("Connecting to Kovanica node...")
                .foregroundColor(KVNCBrand.muted)
                .font(.subheadline)
        }
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 20) {
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundColor(KVNCBrand.accent)
            Text("Connection Error")
                .font(.title2)
                .foregroundColor(KVNCBrand.foreground)
            Text(message)
                .font(.caption)
                .foregroundColor(KVNCBrand.muted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Retry") {
                Task { await viewModel.load() }
            }
            .buttonStyle(.borderedProminent)
            .tint(KVNCBrand.accent)
            Button("Enter Address Manually") {
                showAddressEntry = true
            }
            .foregroundColor(KVNCBrand.accent)
            .font(.subheadline)
        }
        .padding()
    }

    private var addressEntrySheet: some View {
        NavigationStack {
            ZStack {
                KVNCBrand.background.ignoresSafeArea()
                VStack(spacing: 20) {
                    Text("Enter a Kovanica address to watch")
                        .foregroundColor(KVNCBrand.foreground)
                        .font(.headline)
                    TextField("kvnc...", text: $manualAddress)
                        .textFieldStyle(.roundedBorder)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                    Button("Load Wallet") {
                        Task {
                            await viewModel.loadWalletAddress(manualAddress)
                            showAddressEntry = false
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(KVNCBrand.accent)
                    .disabled(manualAddress.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding()
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showAddressEntry = false }
                        .foregroundColor(KVNCBrand.accent)
                }
            }
        }
    }
}
