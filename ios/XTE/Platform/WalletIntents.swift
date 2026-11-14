// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
//
// Siri / Shortcuts / Spotlight actions. They read the cached public snapshot only;
// "Send" just opens the Send screen pre-filled - nothing is signed without the wallet
// PIN / Face ID inside the app.

#if canImport(AppIntents)
import AppIntents
import Foundation

@available(iOS 16.0, *)
struct ShowBalanceIntent: AppIntent {
    static var title: LocalizedStringResource = "Show balance"
    static var description = IntentDescription("Shows the wallet balance from the last sync.")
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let s = SnapshotStore.load(), !s.address.isEmpty else {
            return .result(dialog: "There is no wallet on this device yet.")
        }
        var text = "Your \(s.ticker) balance is \(s.balanceText)"
        if let locked = s.lockedText { text += ", including \(locked) locked" }
        text += s.isSynced ? "." : ". The wallet is still syncing."
        return .result(dialog: IntentDialog(stringLiteral: text))
    }
}

@available(iOS 16.0, *)
struct ShowReceiveAddressIntent: AppIntent {
    static var title: LocalizedStringResource = "Show receive address"
    static var description = IntentDescription("Opens your address and QR code.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        RouteDispatcher.open(AppRoute.receive.url)
        return .result()
    }
}

@available(iOS 16.0, *)
struct OpenSendIntent: AppIntent {
    static var title: LocalizedStringResource = "Send"
    static var description = IntentDescription("Opens the Send screen, optionally with an amount and recipient. Nothing is sent without your confirmation.")
    static var openAppWhenRun = true

    @Parameter(title: "Amount")
    var amount: Double?

    @Parameter(title: "Recipient address")
    var address: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Send \(\.$amount) to \(\.$address)")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        let amountText = amount.map { String(format: "%.2f", $0) }
        RouteDispatcher.open(AppRoute.send(amount: amountText, address: address).url)
        return .result()
    }
}

@available(iOS 16.0, *)
struct WalletShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: ShowBalanceIntent(), phrases: [
            "Show my \(.applicationName) balance",
            "\(.applicationName) balance",
        ])
        AppShortcut(intent: ShowReceiveAddressIntent(), phrases: [
            "Show my \(.applicationName) address",
            "Receive with \(.applicationName)",
        ])
        AppShortcut(intent: OpenSendIntent(), phrases: [
            "Send with \(.applicationName)",
            "Pay with \(.applicationName)",
        ])
    }
}
#endif
