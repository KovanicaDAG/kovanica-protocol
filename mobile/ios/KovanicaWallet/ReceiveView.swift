import SwiftUI

struct ReceiveView: View {
    @EnvironmentObject var viewModel: WalletViewModel
    @State private var showCopied = false

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    VStack(spacing: 8) {
                        Image(systemName: "arrow.down.circle.fill")
                            .font(.system(size: 50))
                            .foregroundColor(.kvncGreen)

                        Text("Receive KVNC")
                            .font(.title2)
                            .fontWeight(.bold)
                    }
                    .padding(.top, 20)

                    // QR Code Placeholder
                    VStack(spacing: 16) {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.white)
                            .frame(width: 200, height: 200)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(Color.gray.opacity(0.3), lineWidth: 1)
                            )
                            .overlay(
                                VStack {
                                    Image(systemName: "qrcode")
                                        .font(.system(size: 80))
                                        .foregroundColor(.kvncBlue)
                                    Text("QR Code")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            )

                        Text("Scan to send KVNC")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }

                    // Address
                    VStack(spacing: 12) {
                        Text("Your Address")
                            .font(.headline)

                        if let address = viewModel.walletData?.address {
                            Text(address)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundColor(.secondary)
                                .multilineTextAlignment(.center)
                                .padding()
                                .background(Color.kvncLightGray)
                                .cornerRadius(8)
                                .onTapGesture {
                                    UIPasteboard.general.string = address
                                    showCopied = true
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                        showCopied = false
                                    }
                                }

                            if showCopied {
                                Label("Copied!", systemImage: "checkmark.circle.fill")
                                    .foregroundColor(.kvncGreen)
                                    .font(.caption)
                            }

                            Button(action: {
                                UIPasteboard.general.string = address
                                showCopied = true
                                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                    showCopied = false
                                }
                            }) {
                                HStack {
                                    Image(systemName: "doc.on.doc")
                                    Text("Copy Address")
                                }
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color.kvncBlue)
                                .foregroundColor(.white)
                                .cornerRadius(12)
                            }
                        } else {
                            Text("No address available")
                                .foregroundColor(.secondary)
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
            .navigationTitle("Receive")
        }
    }
}

#Preview {
    ReceiveView()
        .environmentObject(WalletViewModel())
}
