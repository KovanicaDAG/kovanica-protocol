import SwiftUI

struct WalletSetupView: View {
    @EnvironmentObject var viewModel: WalletViewModel
    @State private var phrase = ""
    @State private var passphrase = ""
    @State private var confirmPassphrase = ""

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    VStack(spacing: 8) {
                        Image(systemName: "bitcoinsign.circle.fill")
                            .font(.system(size: 60))
                            .foregroundColor(.kvncBlue)

                        Text("Kovanica Wallet")
                            .font(.largeTitle)
                            .fontWeight(.bold)

                        Text("Set up your wallet to get started")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .padding(.top, 40)

                    // Phrase Input
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Recovery Phrase")
                            .font(.headline)

                        Text("Enter your 12 or 24 word recovery phrase")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        TextEditor(text: $phrase)
                            .frame(height: 100)
                            .padding(8)
                            .background(Color.kvncLightGray)
                            .cornerRadius(8)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color.gray.opacity(0.3), lineWidth: 1)
                            )
                    }

                    // Passphrase
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Passphrase (Optional)")
                            .font(.headline)

                        SecureField("Enter passphrase", text: $passphrase)
                            .textFieldStyle(RoundedBorderTextFieldStyle())

                        SecureField("Confirm passphrase", text: $confirmPassphrase)
                            .textFieldStyle(RoundedBorderTextFieldStyle())
                    }

                    // Error
                    if let error = viewModel.errorMessage {
                        Text(error)
                            .foregroundColor(.kvncRed)
                            .font(.caption)
                    }

                    // Button
                    Button(action: {
                        viewModel.initializeWallet(phrase: phrase, passphrase: passphrase)
                    }) {
                        HStack {
                            if viewModel.isLoading {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                    .scaleEffect(0.8)
                            }
                            Text("Create Wallet")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.kvncBlue)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .disabled(viewModel.isLoading || phrase.isEmpty)

                    Spacer()
                }
                .padding()
            }
            .navigationBarHidden(true)
        }
    }
}

#Preview {
    WalletSetupView()
        .environmentObject(WalletViewModel())
}
