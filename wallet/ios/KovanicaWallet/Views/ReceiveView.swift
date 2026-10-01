import SwiftUI

struct ReceiveView: View {
    let address: String
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        NavigationStack {
            ZStack {
                KVNCBrand.background.ignoresSafeArea()
                VStack(spacing: 24) {
                    Spacer()
                    Text("Your Address")
                        .font(.headline)
                        .foregroundColor(KVNCBrand.foreground)

                    VStack(spacing: 8) {
                        Image(systemName: "arrow.down.circle.fill")
                            .font(.system(size: 48))
                            .foregroundColor(KVNCBrand.accent)
                        Text("Receive \(NetworkConstants.TOKEN_SYMBOL)")
                            .font(.subheadline)
                            .foregroundColor(KVNCBrand.muted)
                    }

                    VStack(spacing: 12) {
                        Text(address)
                            .font(.system(.body, design: .monospaced))
                            .foregroundColor(KVNCBrand.foreground)
                            .textSelection(.enabled)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                            .background(KVNCBrand.secondary.opacity(0.5))
                            .cornerRadius(10)

                        Button {
                            UIPasteboard.general.string = address
                            withAnimation { copied = true }
                            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                withAnimation { copied = false }
                            }
                        } label: {
                            HStack {
                                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                                Text(copied ? "Copied" : "Copy Address")
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(copied ? .green : KVNCBrand.accent)
                    }

                    Text("This is a receive-only watch wallet.\nSend functionality requires ed25519 signing.")
                        .font(.caption)
                        .foregroundColor(KVNCBrand.muted)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)

                    Spacer()
                }
            }
            .navigationTitle("Receive")
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
}
