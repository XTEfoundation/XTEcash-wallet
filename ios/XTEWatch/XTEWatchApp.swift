// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
//
// Apple Watch companion: balance, last payment, sync state and the receive QR code.
// Gets only the public snapshot (and a pre-rendered QR image) from the iPhone over
// WatchConnectivity; there are no keys on the watch and it cannot send.

import SwiftUI
import UIKit
import WatchConnectivity

@main
struct XTEWatchApp: App {
    @StateObject private var model = WatchModel()

    var body: some Scene {
        WindowGroup {
            WatchRootView().environmentObject(model)
        }
    }
}

final class WatchModel: NSObject, ObservableObject, WCSessionDelegate {
    @Published var snapshot: WalletSnapshot?
    @Published var qr: UIImage?

    private let defaults = UserDefaults.standard

    override init() {
        super.init()
        if let data = defaults.data(forKey: "snapshot") { snapshot = try? JSONDecoder().decode(WalletSnapshot.self, from: data) }
        if let data = defaults.data(forKey: "qr") { qr = UIImage(data: data) }
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    func refresh() {
        let s = WCSession.default
        guard s.activationState == .activated else { return }
        apply(s.receivedApplicationContext)
        guard s.isReachable else { return }
        s.sendMessage(["get": "snapshot"], replyHandler: { [weak self] reply in self?.apply(reply) }, errorHandler: nil)
    }

    private func apply(_ context: [String: Any]) {
        if context["cleared"] != nil {
            DispatchQueue.main.async {
                self.snapshot = nil
                self.qr = nil
                self.defaults.removeObject(forKey: "snapshot")
                self.defaults.removeObject(forKey: "qr")
            }
            return
        }
        guard let data = context["snapshot"] as? Data,
              let snap = try? JSONDecoder().decode(WalletSnapshot.self, from: data) else { return }
        let qrData = context["qr"] as? Data
        DispatchQueue.main.async {
            if let current = self.snapshot, current.updatedAt > snap.updatedAt { return }
            self.snapshot = snap
            self.defaults.set(data, forKey: "snapshot")
            if let qrData {
                self.qr = UIImage(data: qrData)
                self.defaults.set(qrData, forKey: "qr")
            }
        }
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if activationState == .activated { refresh() }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        apply(applicationContext)
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        if session.isReachable { refresh() }
    }
}

struct WatchRootView: View {
    @EnvironmentObject private var model: WatchModel

    var body: some View {
        if let s = model.snapshot, !s.address.isEmpty {
            TabView {
                BalancePage(snapshot: s)
                ReceivePage(snapshot: s, qr: model.qr)
            }
            .tabViewStyle(.page)
            .onAppear { model.refresh() }
        } else {
            VStack(spacing: 8) {
                Image(systemName: "iphone")
                    .font(.title2)
                Text("Open \(SharedConfig.ticker) on your iPhone to show your wallet here.")
                    .font(.footnote)
                    .multilineTextAlignment(.center)
            }
            .padding()
            .onAppear { model.refresh() }
        }
    }
}

struct BalancePage: View {
    let snapshot: WalletSnapshot

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                Text(snapshot.ticker)
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text(snapshot.balanceText)
                    .font(.title3.weight(.semibold))
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                if let locked = snapshot.lockedText {
                    Text("\(locked) locked")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                if let pending = snapshot.pendingIncomingText {
                    Label("Incoming \(pending)", systemImage: "arrow.down.circle")
                        .font(.caption2)
                        .foregroundColor(.green)
                }
                Divider()
                if let p = snapshot.lastPayment {
                    Label(p.amountText, systemImage: p.incoming ? "arrow.down.left" : "arrow.up.right")
                        .font(.footnote)
                        .foregroundColor(p.incoming ? .green : .primary)
                    Text(p.date, style: .relative)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                Text(snapshot.isSynced ? "Synced" : "Syncing \(snapshot.walletHeight) / \(snapshot.networkHeight)")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct ReceivePage: View {
    let snapshot: WalletSnapshot
    let qr: UIImage?

    var body: some View {
        VStack(spacing: 4) {
            if let qr {
                Image(uiImage: qr)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .padding(4)
                    .background(Color.white)
            }
            Text(snapshot.address.walletShortened)
                .font(.system(.caption2, design: .monospaced))
                .lineLimit(1)
        }
    }
}
