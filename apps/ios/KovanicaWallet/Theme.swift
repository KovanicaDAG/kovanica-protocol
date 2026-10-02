import SwiftUI

extension Color {
    static let kvncBlue = Color(red: 0.2, green: 0.4, blue: 0.9)
    static let kvncDarkBlue = Color(red: 0.1, green: 0.2, blue: 0.6)
    static let kvncGreen = Color(red: 0.2, green: 0.7, blue: 0.4)
    static let kvncOrange = Color(red: 0.9, green: 0.5, blue: 0.2)
    static let kvncRed = Color(red: 0.9, green: 0.2, blue: 0.2)
    static let kvncGray = Color(red: 0.5, green: 0.5, blue: 0.5)
    static let kvncLightGray = Color(red: 0.95, green: 0.95, blue: 0.95)
}

struct KovanicaTheme {
    static let primary = Color.kvncBlue
    static let secondary = Color.kvncDarkBlue
    static let success = Color.kvncGreen
    static let warning = Color.kvncOrange
    static let error = Color.kvncRed
    static let background = Color.kvncLightGray
}
