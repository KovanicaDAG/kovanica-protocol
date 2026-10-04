import SwiftUI

struct SendView: View {
    @EnvironmentObject var viewModel: WalletViewModel
    @State private var recipientAddress = ""
    @State private var amount = ""
    @State private var showConfirmation = false

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // Header
                    VStack(spacing: 8) {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 50))
                            .foregroundColor(.kvncBlue)

                        Text("Send KVNC")
                            .font(.title2)
                            .fontWeight(.bold)
                    }
                    .padding(.top, 20)

                    // Form
                    VStack(spacing: 16) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Recipient Address")
                                .font(.headline)

                            TextField("kvnc1...", text: $recipientAddress)
                                .textFieldStyle(RoundedBorderTextFieldStyle())
                                .autocapitalization(.none)
                                .disableAutocorrection(true)
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            Text("Amount (KVNC)")
                                .font(.headline)

                            TextField("0.00", text: $amount)
                                .textFieldStyle(RoundedBorderTextFieldStyle())
                                .keyboardType(.decimalPad)

                            if let balance = viewModel.walletData?.balance {
                                Text("Available: \(formatKVNC(balance)) KVNC")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }

                        // Error
                        if let error = viewModel.errorMessage {
                            Text(error)
                                .foregroundColor(.kvncRed)
                                .font(.caption)
                        }

                        // Send Button
                        Button(action: {
                            showConfirmation = true
                        }) {
                            HStack {
                                if viewModel.isLoading {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                        .scaleEffect(0.8)
                                }
                                Text("Send Transaction")
                                    .fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(isValidInput ? Color.kvncBlue : Color.gray)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                        }
                        .disabled(!isValidInput || viewModel.isLoading)

                        // Result
                        if let result = viewModel.sendResult {
                            Text(result)
                                .font(.caption)
                                .foregroundColor(.kvncGreen)
                                .padding()
                                .background(Color.kvncGreen.opacity(0.1))
                                .cornerRadius(8)
                        }
                    }
                    .padding()
                    .background(Color.white)
                    .cornerRadius(12)
                    .shadow(radius: 2)

                    Spacer()
                }
                .padding()
            }
            .navigationTitle("Send")
            .alert("Confirm Transaction", isPresented: $showConfirmation) {
                Button("Cancel", role: .cancel) { }
                Button("Send") {
                    Task {
                        await viewModel.send(to: recipientAddress, amount: amount)
                    }
                }
            } message: {
                Text("Send \(amount) KVNC to \(recipientAddress)?")
            }
        }
    }

    private var isValidInput: Bool {
        !recipientAddress.isEmpty && !amount.isEmpty && Double(amount) != nil
    }
}

#Preview {
    SendView()
        .environmentObject(WalletViewModel())
}
