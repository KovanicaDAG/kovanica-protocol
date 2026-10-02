import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = WalletViewModel()

    var body: some View {
        Group {
            if viewModel.isWalletReady {
                MainTabView()
                    .environmentObject(viewModel)
            } else {
                WalletSetupView()
                    .environmentObject(viewModel)
            }
        }
    }
}

struct MainTabView: View {
    @EnvironmentObject var viewModel: WalletViewModel

    var body: some View {
        TabView {
            HomeView()
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }

            SendView()
                .tabItem {
                    Label("Send", systemImage: "arrow.up.circle.fill")
                }

            ReceiveView()
                .tabItem {
                    Label("Receive", systemImage: "arrow.down.circle.fill")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape.fill")
                }
        }
        .accentColor(.kvncBlue)
    }
}

#Preview {
    ContentView()
}
