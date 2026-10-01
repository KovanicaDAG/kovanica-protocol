import SwiftUI

extension Color {
    static let kvncBackground = Color(red: 0.035, green: 0.035, blue: 0.043)
    static let kvncForeground = Color(red: 0.847, green: 0.831, blue: 0.796)
    static let kvncAccent = Color(red: 0.788, green: 0.635, blue: 0.153)
    static let kvncSecondary = Color(red: 0.165, green: 0.165, blue: 0.180)
    static let kvncMuted = Color(red: 0.400, green: 0.400, blue: 0.420)
}

enum KVNCBrand {
    static let background = Color.kvncBackground
    static let foreground = Color.kvncForeground
    static let accent = Color.kvncAccent
    static let secondary = Color.kvncSecondary
    static let muted = Color.kvncMuted

    static let backgroundHex = "#09090B"
    static let foregroundHex = "#D8D4CC"
    static let accentHex = "#C9A227"
}
