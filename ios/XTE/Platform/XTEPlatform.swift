// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
//
// iOS side of src/Platform.js (NativeModules.XTEPlatform):
//  - WidgetKit snapshot (public data only: address, balance text, last payment)
//  - Live Activities / Dynamic Island for sync progress and outgoing transactions
//  - Face ID / Touch ID / passcode prompt for the address book and sending
//  - Home Screen quick actions ("Pay <contact>"), Handoff, payment notification actions
//  - Apple Watch companion via WatchConnectivity
// The wallet keys never pass through here.

import Foundation
import LocalAuthentication
import UIKit
import UserNotifications
import WatchConnectivity
#if canImport(WidgetKit)
import WidgetKit
#endif
#if canImport(ActivityKit)
import ActivityKit
#endif

typealias XTEResolve = (Any?) -> Void
typealias XTEReject = (String?, String?, Error?) -> Void

@objc(XTEPlatform)
final class XTEPlatform: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { false }

    // MARK: Widgets

    @objc(updateWidgetData:resolver:rejecter:)
    func updateWidgetData(_ json: String, resolver resolve: @escaping XTEResolve, rejecter reject: @escaping XTEReject) {
        guard let data = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let address = o["address"] as? String, !address.isEmpty else {
            reject("bad_snapshot", "Invalid widget data", nil)
            return
        }
        let hide = (o["hideBalance"] as? Bool) ?? false
        let ticker = SharedConfig.ticker
        let lastText = (o["lastPaymentText"] as? String) ?? ""
        let millis = (o["lastPaymentTime"] as? Double) ?? Date().timeIntervalSince1970 * 1000
        let payment = lastText.isEmpty ? nil : WalletSnapshot.Payment(
            incoming: (o["lastPaymentIncoming"] as? Bool) ?? true,
            amountText: hide ? "•••" : lastText,
            date: Date(timeIntervalSince1970: millis / 1000),
            confirmed: true)
        let locked = (o["lockedText"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let snapshot = WalletSnapshot(ticker: ticker, address: address,
                                      balanceText: hide ? "•••" : ((o["balanceText"] as? String) ?? "—"),
                                      lockedText: hide ? nil : locked,
                                      lastPayment: payment,
                                      walletHeight: UInt64(max(0, (o["walletHeight"] as? Double) ?? 0)),
                                      networkHeight: UInt64(max(0, (o["networkHeight"] as? Double) ?? 0)),
                                      updatedAt: Date())
        SnapshotStore.save(snapshot)
        Self.reloadWidgets()
        WatchBridge.shared.send(snapshot)
        resolve(true)
    }

    @objc(notePendingIncoming:)
    func notePendingIncoming(_ text: String) {
        guard var s = SnapshotStore.load() else { return }
        s.pendingIncomingText = text
        s.lastPayment = .init(incoming: true, amountText: text, date: Date(), confirmed: false)
        SnapshotStore.save(s)
        Self.reloadWidgets()
    }

    @objc func clearWidgetData() {
        SnapshotStore.clear()
        Self.reloadWidgets()
        WatchBridge.shared.clear()
        DispatchQueue.main.async { UIApplication.shared.shortcutItems = [] }
        LiveActivityController.endAll()
    }

    static func reloadWidgets() {
        #if canImport(WidgetKit)
        if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
        #endif
    }

    // MARK: Quick actions

    /// [{id, label, uri}] -> "Pay <contact>" Home Screen quick actions (after the static ones).
    @objc(setDynamicShortcuts:resolver:rejecter:)
    func setDynamicShortcuts(_ json: String, resolver resolve: @escaping XTEResolve, rejecter reject: @escaping XTEReject) {
        let list = (json.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [[String: Any]]) ?? []
        let items: [UIApplicationShortcutItem] = list.prefix(2).compactMap { p in
            guard let label = p["label"] as? String, let uri = p["uri"] as? String else { return nil }
            return UIApplicationShortcutItem(type: "io.traaitt.wallet.pay", localizedTitle: "Pay \(label)",
                                             localizedSubtitle: nil,
                                             icon: UIApplicationShortcutIcon(systemImageName: "person.crop.circle"),
                                             userInfo: ["url": uri as NSString])
        }
        DispatchQueue.main.async {
            UIApplication.shared.shortcutItems = items
            resolve(items.count)
        }
    }

    @objc(reportShortcutUsed:)
    func reportShortcutUsed(_ id: String) {}

    /// Route that cold-started the app (quick action, notification action, Handoff), stored by AppDelegate.
    @objc(consumePendingRoute:rejecter:)
    func consumePendingRoute(_ resolve: @escaping XTEResolve, rejecter reject: @escaping XTEReject) {
        let d = UserDefaults.standard
        let url = d.string(forKey: "XTEPendingRoute")
        let at = d.double(forKey: "XTEPendingRouteAt")
        d.removeObject(forKey: "XTEPendingRoute")
        d.removeObject(forKey: "XTEPendingRouteAt")
        resolve(url != nil && Date().timeIntervalSince1970 - at < 120 ? url : nil)
    }

    // MARK: Handoff

    private var activity: NSUserActivity?

    @objc(setHandoff:uri:)
    func setHandoff(_ kind: String, uri: String) {
        DispatchQueue.main.async {
            let type = kind == "send" ? SharedConfig.sendActivityType : SharedConfig.receiveActivityType
            let a = NSUserActivity(activityType: type)
            a.title = kind == "send" ? "Send \(SharedConfig.ticker)" : "Receive \(SharedConfig.ticker)"
            a.userInfo = ["uri": uri]
            a.requiredUserInfoKeys = ["uri"]
            a.isEligibleForHandoff = true
            a.isEligibleForSearch = false
            if #available(iOS 12.0, *) { a.isEligibleForPrediction = kind != "send" }
            self.activity?.invalidate()
            self.activity = a
            a.becomeCurrent()
        }
    }

    // MARK: Notifications

    @objc(showPaymentNotification:body:hash:)
    func showPaymentNotification(_ title: String, body: String, hash: String) {
        PaymentNotifications.installCategory()
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.categoryIdentifier = PaymentNotifications.category
        content.threadIdentifier = "wallet.payments"
        content.userInfo = ["hash": hash]
        let request = UNNotificationRequest(identifier: "payment-\(hash)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    // MARK: Live Activities

    @objc(showSendProgress:amountText:status:progress:done:)
    func showSendProgress(_ hash: String, amountText: String, status: String, progress: Double, done: Bool) {
        LiveActivityController.send(hash: hash, amountText: amountText, status: status, progress: progress / 100, done: done)
    }

    @objc(cancelSendProgress:)
    func cancelSendProgress(_ hash: String) {
        LiveActivityController.cancelSend(hash: hash)
    }

    @objc(updateSyncActivity:networkHeight:)
    func updateSyncActivity(_ walletHeight: Double, networkHeight: Double) {
        LiveActivityController.sync(walletHeight: UInt64(max(0, walletHeight)), networkHeight: UInt64(max(0, networkHeight)))
    }

    // MARK: Face ID / Touch ID / passcode

    @objc(authenticate:subtitle:resolver:rejecter:)
    func authenticate(_ title: String, subtitle: String, resolver resolve: @escaping XTEResolve, rejecter reject: @escaping XTEReject) {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            // No passcode set: nothing to check against (same as Android without a screen lock).
            resolve("none")
            return
        }
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: title) { ok, err in
            if ok { resolve("ok") } else { reject("cancelled", err?.localizedDescription ?? "Cancelled", err) }
        }
    }
}

// MARK: - Payment notification actions

@objc(XTEPaymentNotifications)
public final class PaymentNotifications: NSObject {
    static let category = "WALLET_PAYMENT"
    static let actionShowTransactions = "SHOW_TRANSACTIONS"
    static let actionShowReceive = "SHOW_RECEIVE"

    /// Public so the generated XTE-Swift.h exposes it (the app has no bridging header).
    /// Called from AppDelegate at launch, and before each payment notification.
    @objc public static func installCategory() {
        let center = UNUserNotificationCenter.current()
        let show = UNNotificationAction(identifier: actionShowTransactions, title: "Show transactions", options: [.foreground])
        let receive = UNNotificationAction(identifier: actionShowReceive, title: "Show receive QR", options: [.foreground])
        let category = UNNotificationCategory(identifier: Self.category, actions: [show, receive], intentIdentifiers: [],
                                              options: [.hiddenPreviewsShowTitle])
        center.getNotificationCategories { existing in
            var all = existing.filter { $0.identifier != Self.category }
            all.insert(category)
            center.setNotificationCategories(all)
        }
    }

    /// Route URL for a tapped payment notification, or nil when it is not ours.
    @objc(routeURLForResponse:) public static func routeURL(for response: UNNotificationResponse) -> URL? {
        guard response.notification.request.content.categoryIdentifier == category else { return nil }
        return (response.actionIdentifier == actionShowReceive ? AppRoute.receive : AppRoute.transactions).url
    }

    /// Route URL for a Handoff activity, or nil when it is not ours.
    @objc(routeURLForActivity:) public static func routeURL(forActivity activity: NSUserActivity) -> URL? {
        if activity.activityType == SharedConfig.receiveActivityType { return AppRoute.receive.url }
        if activity.activityType == SharedConfig.sendActivityType {
            if let uri = activity.userInfo?["uri"] as? String, let url = URL(string: uri) { return url }
            return AppRoute.send(amount: nil, address: nil).url
        }
        return nil
    }

    /// Static quick actions (Info.plist UIApplicationShortcutItems) carry the route in "url".
    @objc(routeURLForShortcut:) public static func routeURL(forShortcut item: UIApplicationShortcutItem) -> URL? {
        if let s = item.userInfo?["url"] as? String, let url = URL(string: s) { return url }
        switch item.type {
        case "io.traaitt.wallet.receive": return AppRoute.receive.url
        case "io.traaitt.wallet.send": return AppRoute.send(amount: nil, address: nil).url
        case "io.traaitt.wallet.transactions": return AppRoute.transactions.url
        default: return nil
        }
    }

    @objc public static func activateWatch() {
        WatchBridge.shared.activate()
    }
}

// MARK: - Route dispatch

/// Hands a route URL to React Native: live via Linking's "url" event, and kept for
/// consumePendingRoute() in case JS was not listening yet (cold start).
@objc(XTERouteDispatcher)
public final class RouteDispatcher: NSObject {
    @objc public static func open(_ url: URL) {
        let d = UserDefaults.standard
        d.set(url.absoluteString, forKey: "XTEPendingRoute")
        d.set(Date().timeIntervalSince1970, forKey: "XTEPendingRouteAt")
        DispatchQueue.main.async {
            // Same notification RCTLinkingManager posts for application:openURL:.
            NotificationCenter.default.post(name: Notification.Name("RCTOpenURLNotification"), object: nil,
                                            userInfo: ["url": url.absoluteString])
        }
    }
}

// MARK: - Live Activities

enum LiveActivityController {
    /// Only a real catch-up gets a sync activity, not the next block.
    static let syncThreshold: UInt64 = 500
    private static let queue = DispatchQueue(label: "wallet.liveactivities")
    private static var syncID: String?
    private static var sends: [String: String] = [:]   // tx hash -> activity id

    static func sync(walletHeight: UInt64, networkHeight: UInt64) {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *), networkHeight > 0 else { return }
        queue.async {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
            let behind = networkHeight > walletHeight + 1 ? networkHeight - walletHeight - 1 : 0
            let state = WalletActivityAttributes.ContentState(progress: min(1, Double(walletHeight) / Double(networkHeight)),
                                                              walletHeight: walletHeight, networkHeight: networkHeight,
                                                              status: "", done: behind == 0)
            if let id = syncID, let a = Activity<WalletActivityAttributes>.activities.first(where: { $0.id == id }) {
                let content = ActivityContent(state: state, staleDate: nil)
                Task {
                    if behind == 0 { await a.end(content, dismissalPolicy: .after(Date(timeIntervalSinceNow: 60))) }
                    else { await a.update(content) }
                }
                if behind == 0 { syncID = nil }
                return
            }
            guard behind >= syncThreshold else { return }
            if let a = try? Activity.request(attributes: WalletActivityAttributes(kind: .sync, ticker: SharedConfig.ticker),
                                             content: ActivityContent(state: state, staleDate: nil), pushType: nil) {
                syncID = a.id
            }
        }
        #endif
    }

    static func send(hash: String, amountText: String, status: String, progress: Double, done: Bool) {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { return }
        queue.async {
            let state = WalletActivityAttributes.ContentState(progress: min(1, max(0, progress)), walletHeight: 0,
                                                              networkHeight: 0, status: status, done: done)
            let content = ActivityContent(state: state, staleDate: nil)
            if let id = sends[hash], let a = Activity<WalletActivityAttributes>.activities.first(where: { $0.id == id }) {
                Task {
                    if done { await a.end(content, dismissalPolicy: .after(Date(timeIntervalSinceNow: 15 * 60))) }
                    else { await a.update(content) }
                }
                if done { sends[hash] = nil }
                return
            }
            guard !done, ActivityAuthorizationInfo().areActivitiesEnabled else { return }
            let attrs = WalletActivityAttributes(kind: .send, ticker: SharedConfig.ticker, amountText: amountText,
                                                 destinationShort: nil, txHashShort: hash.walletShortened)
            if let a = try? Activity.request(attributes: attrs, content: content, pushType: nil) {
                sends[hash] = a.id
            }
        }
        #endif
    }

    static func cancelSend(hash: String) {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { return }
        queue.async {
            guard let id = sends.removeValue(forKey: hash) else { return }
            for a in Activity<WalletActivityAttributes>.activities where a.id == id {
                Task { await a.end(nil, dismissalPolicy: .immediate) }
            }
        }
        #endif
    }

    static func endAll() {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { return }
        queue.async {
            syncID = nil
            sends.removeAll()
            for a in Activity<WalletActivityAttributes>.activities {
                Task { await a.end(nil, dismissalPolicy: .immediate) }
            }
        }
        #endif
    }
}

// MARK: - Apple Watch

/// Sends the public snapshot and a receive QR code (CoreImage is not available on watchOS).
final class WatchBridge: NSObject, WCSessionDelegate {
    static let shared = WatchBridge()
    private var pending: [String: Any]?

    func activate() {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        s.delegate = self
        s.activate()
    }

    func send(_ snapshot: WalletSnapshot) {
        guard WCSession.isSupported(), let json = try? JSONEncoder().encode(snapshot) else { return }
        var context: [String: Any] = ["snapshot": json]
        if let qr = SharedQR.image(for: snapshot.receiveURI, scale: 4)?.pngData() { context["qr"] = qr }
        push(context)
    }

    func clear() {
        guard WCSession.isSupported() else { return }
        push(["cleared": Date().timeIntervalSince1970])
    }

    private func push(_ context: [String: Any]) {
        let s = WCSession.default
        guard s.activationState == .activated else { pending = context; activate(); return }
        guard s.isPaired, s.isWatchAppInstalled else { return }
        try? s.updateApplicationContext(context)
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if activationState == .activated, let p = pending {
            pending = nil
            push(p)
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { session.activate() }

    /// The watch asks for fresh data when it launches.
    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        guard let s = SnapshotStore.load(), let json = try? JSONEncoder().encode(s) else { replyHandler([:]); return }
        var reply: [String: Any] = ["snapshot": json]
        if let qr = SharedQR.image(for: s.receiveURI, scale: 4)?.pngData() { reply["qr"] = qr }
        replyHandler(reply)
    }
}
