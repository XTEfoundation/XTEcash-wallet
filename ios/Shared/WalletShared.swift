// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
//
// Shared between the app, the widget extension (Home/Lock Screen widgets, Live Activity)
// and - in the iPhone apps - the watch app. Contains only public data: the address, the
// cached balance and the last payment. Never a private key: the spend key and the view key
// stay in the app's private Keychain group, which extensions cannot read.

import Foundation
import Security
#if canImport(UIKit)
import UIKit
#endif
#if canImport(CoreImage) && !os(watchOS)
import CoreImage
import CoreImage.CIFilterBuiltins
#endif
#if canImport(ActivityKit) && os(iOS)
import ActivityKit
#endif

/// Brand constants read from Info.plist (set per app in project.yml / Info.plist).
public enum SharedConfig {
    private static func value(_ key: String, _ fallback: String) -> String {
        (Bundle.main.object(forInfoDictionaryKey: key) as? String).flatMap { $0.isEmpty ? nil : $0 } ?? fallback
    }
    /// "XTE" or "XTCASH".
    public static var ticker: String { value("WalletTicker", "XTE") }
    /// Payment URI scheme, e.g. "xte" or "xtcash".
    public static var paymentScheme: String { value("WalletPaymentScheme", "xte") }
    /// Internal deep-link scheme for widgets, shortcuts and notifications, e.g. "xtewallet".
    public static var routeScheme: String { value("WalletRouteScheme", "xtewallet") }
    /// "<TeamID>.<app bundle id>.shared" - the only Keychain group extensions can read.
    public static var sharedKeychainGroup: String { value("WalletSharedKeychainGroup", "") }
    /// NSUserActivity types (Handoff).
    public static var receiveActivityType: String { value("WalletActivityPrefix", "io.traaitt.wallet") + ".receive" }
    public static var sendActivityType: String { value("WalletActivityPrefix", "io.traaitt.wallet") + ".send" }
}

/// What widgets, Siri and the watch show. Written by the app after each sync.
public struct WalletSnapshot: Codable, Equatable, Sendable {
    public struct Payment: Codable, Equatable, Sendable {
        public var incoming: Bool
        public var amountText: String
        public var date: Date
        public var confirmed: Bool
        public init(incoming: Bool, amountText: String, date: Date, confirmed: Bool) {
            self.incoming = incoming; self.amountText = amountText; self.date = date; self.confirmed = confirmed
        }
    }

    public var ticker: String
    public var address: String
    public var balanceText: String
    public var lockedText: String?
    public var lastPayment: Payment?
    public var walletHeight: UInt64
    public var networkHeight: UInt64
    public var updatedAt: Date
    /// Set when the background check saw a payment the foreground sync has not counted yet.
    public var pendingIncomingText: String?

    public init(ticker: String, address: String, balanceText: String, lockedText: String? = nil,
                lastPayment: Payment? = nil, walletHeight: UInt64 = 0, networkHeight: UInt64 = 0,
                updatedAt: Date = Date(), pendingIncomingText: String? = nil) {
        self.ticker = ticker; self.address = address; self.balanceText = balanceText; self.lockedText = lockedText
        self.lastPayment = lastPayment; self.walletHeight = walletHeight; self.networkHeight = networkHeight
        self.updatedAt = updatedAt; self.pendingIncomingText = pendingIncomingText
    }

    public var isSynced: Bool { networkHeight > 0 && walletHeight + 1 >= networkHeight }

    public var receiveURI: String { "\(SharedConfig.paymentScheme)://\(address)" }

    public static let placeholder = WalletSnapshot(ticker: SharedConfig.ticker, address: "", balanceText: "—")
}

/// Stores the snapshot in the shared Keychain group (no App Group container is needed).
public enum SnapshotStore {
    private static let service = "wallet.shared.snapshot"
    private static let account = "snapshot"

    private static func query() -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let group = SharedConfig.sharedKeychainGroup
        if !group.isEmpty && !group.hasPrefix(".") && !group.hasPrefix("$") { q[kSecAttrAccessGroup as String] = group }
        return q
    }

    /// Unsigned simulator builds have no Keychain entitlement: fall back to the default group.
    private static func withFallback(_ body: ([String: Any]) -> OSStatus) -> OSStatus {
        let q = query()
        let status = body(q)
        if status == errSecMissingEntitlement, q[kSecAttrAccessGroup as String] != nil {
            var plain = q
            plain.removeValue(forKey: kSecAttrAccessGroup as String)
            return body(plain)
        }
        return status
    }

    public static func load() -> WalletSnapshot? {
        var out: CFTypeRef?
        let status = withFallback { q in
            var q = q
            q[kSecReturnData as String] = true
            q[kSecMatchLimit as String] = kSecMatchLimitOne
            return SecItemCopyMatching(q as CFDictionary, &out)
        }
        guard status == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(WalletSnapshot.self, from: data)
    }

    @discardableResult
    public static func save(_ snapshot: WalletSnapshot) -> Bool {
        guard let data = try? JSONEncoder().encode(snapshot) else { return false }
        let status = withFallback { q in
            let update: [String: Any] = [
                kSecValueData as String: data,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            ]
            var s = SecItemUpdate(q as CFDictionary, update as CFDictionary)
            if s == errSecItemNotFound {
                var add = q
                add.merge(update) { $1 }
                s = SecItemAdd(add as CFDictionary, nil)
            }
            return s
        }
        return status == errSecSuccess
    }

    public static func clear() {
        _ = withFallback { q in SecItemDelete(q as CFDictionary) }
    }
}

/// Deep links used by widgets, shortcuts, notifications and Handoff:
/// <routeScheme>://wallet | receive | send?amount=<text>&to=<address> | transactions | addressbook
public enum AppRoute: Equatable, Sendable {
    case wallet
    case receive
    case send(amount: String?, address: String?)
    case transactions
    case addressBook

    public var url: URL {
        var c = URLComponents()
        c.scheme = SharedConfig.routeScheme
        switch self {
        case .wallet: c.host = "wallet"
        case .receive: c.host = "receive"
        case .transactions: c.host = "transactions"
        case .addressBook: c.host = "addressbook"
        case let .send(amount, address):
            c.host = "send"
            var items: [URLQueryItem] = []
            if let amount, !amount.isEmpty { items.append(URLQueryItem(name: "amount", value: amount)) }
            if let address, !address.isEmpty { items.append(URLQueryItem(name: "to", value: address)) }
            if !items.isEmpty { c.queryItems = items }
        }
        return c.url ?? URL(string: "\(SharedConfig.routeScheme)://wallet")!
    }

    public init?(url: URL) {
        guard url.scheme?.lowercased() == SharedConfig.routeScheme.lowercased() else { return nil }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func q(_ name: String) -> String? { items.first { $0.name == name }?.value }
        switch url.host?.lowercased() ?? "" {
        case "receive": self = .receive
        case "send": self = .send(amount: q("amount"), address: q("to"))
        case "transactions": self = .transactions
        case "addressbook": self = .addressBook
        default: self = .wallet
        }
    }
}

#if canImport(CoreImage) && canImport(UIKit) && !os(watchOS)
public enum SharedQR {
    /// Crisp QR code image (nearest-neighbour scaled) for widgets and the watch.
    public static func image(for string: String, scale: CGFloat = 8) -> UIImage? {
        guard !string.isEmpty else { return nil }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: scale, y: scale)),
              let cg = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
#endif

#if canImport(ActivityKit) && os(iOS)
/// Live Activity / Dynamic Island: wallet sync progress or an outgoing transaction.
@available(iOS 16.1, *)
public struct WalletActivityAttributes: ActivityAttributes {
    public enum Kind: String, Codable, Hashable, Sendable { case sync, send }

    public struct ContentState: Codable, Hashable, Sendable {
        /// 0...1
        public var progress: Double
        public var walletHeight: UInt64
        public var networkHeight: UInt64
        /// Send: "Broadcast", "In block 123", "Confirmed"
        public var status: String
        public var done: Bool
        public init(progress: Double, walletHeight: UInt64, networkHeight: UInt64, status: String, done: Bool) {
            self.progress = progress; self.walletHeight = walletHeight; self.networkHeight = networkHeight
            self.status = status; self.done = done
        }
    }

    public var kind: Kind
    public var ticker: String
    /// Send only: amount text and a shortened destination.
    public var amountText: String?
    public var destinationShort: String?
    public var txHashShort: String?

    public init(kind: Kind, ticker: String, amountText: String? = nil, destinationShort: String? = nil, txHashShort: String? = nil) {
        self.kind = kind; self.ticker = ticker; self.amountText = amountText
        self.destinationShort = destinationShort; self.txHashShort = txHashShort
    }
}
#endif

public extension String {
    /// "XTEabc…wxyz" for compact UI.
    var walletShortened: String {
        count > 16 ? "\(prefix(8))…\(suffix(6))" : self
    }
}
