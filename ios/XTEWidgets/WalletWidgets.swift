// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
//
// Home Screen and Lock Screen widgets (balance, last payment, receive QR) and the
// Live Activity / Dynamic Island for sync progress and outgoing transactions.
// Reads only the cached public snapshot (SnapshotStore); no keys are available here.

import ActivityKit
import SwiftUI
import WidgetKit

struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snapshot: WalletSnapshot
    let hasWallet: Bool
}

struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry {
        SnapshotEntry(date: Date(), snapshot: WalletSnapshot(ticker: SharedConfig.ticker, address: "", balanceText: "1,234.56 \(SharedConfig.ticker)",
                                                             lastPayment: .init(incoming: true, amountText: "+12.00 \(SharedConfig.ticker)", date: Date(), confirmed: true)),
                      hasWallet: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : current())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        // The app reloads the timelines after every sync; this is only a safety refresh.
        completion(Timeline(entries: [current()], policy: .after(Date(timeIntervalSinceNow: 30 * 60))))
    }

    private func current() -> SnapshotEntry {
        if let s = SnapshotStore.load(), !s.address.isEmpty { return SnapshotEntry(date: Date(), snapshot: s, hasWallet: true) }
        return SnapshotEntry(date: Date(), snapshot: .placeholder, hasWallet: false)
    }
}

// MARK: Balance widget

struct BalanceWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        content
            .widgetURL(AppRoute.wallet.url)
            .modifier(WidgetBackground())
    }

    @ViewBuilder private var content: some View {
        let s = entry.snapshot
        switch family {
        case .accessoryInline:
            Text("\(s.ticker) \(s.balanceText)").privacySensitive()
        case .accessoryCircular:
            VStack(spacing: 0) {
                Image(systemName: "creditcard")
                Text(compact(s.balanceText)).font(.caption2).minimumScaleFactor(0.5).privacySensitive()
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(s.ticker).font(.headline)
                Text(s.balanceText).font(.body.monospacedDigit()).minimumScaleFactor(0.6).privacySensitive()
                if let p = s.lastPayment {
                    Text(p.amountText).font(.caption2).foregroundStyle(.secondary).privacySensitive()
                }
            }
        default:
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Image(systemName: "creditcard.fill").foregroundStyle(.tint)
                    Text("\(s.ticker) Wallet").font(.caption.bold())
                    Spacer()
                    if entry.hasWallet && !s.isSynced { Image(systemName: "arrow.triangle.2.circlepath").font(.caption2) }
                }
                if entry.hasWallet {
                    Text(s.balanceText).font(.title2.bold().monospacedDigit()).minimumScaleFactor(0.5).lineLimit(1).privacySensitive()
                    if let locked = s.lockedText { Text("Locked \(locked)").font(.caption2).foregroundStyle(.secondary).privacySensitive() }
                    Spacer(minLength: 0)
                    if let pending = s.pendingIncomingText {
                        Label(pending, systemImage: "arrow.down.circle").font(.caption2).foregroundStyle(.green).privacySensitive()
                    } else if let p = s.lastPayment {
                        LastPaymentRow(payment: p)
                    }
                    Text("Updated \(s.updatedAt, style: .relative) ago").font(.system(size: 9)).foregroundStyle(.secondary)
                } else {
                    Spacer()
                    Text("Open the app to set up your wallet").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func compact(_ text: String) -> String {
        text.replacingOccurrences(of: " \(entry.snapshot.ticker)", with: "")
    }
}

struct LastPaymentRow: View {
    let payment: WalletSnapshot.Payment
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: payment.incoming ? "arrow.down.circle.fill" : "arrow.up.circle.fill")
                .foregroundStyle(payment.incoming ? .green : .orange)
            Text(payment.amountText).font(.caption.monospacedDigit()).lineLimit(1).minimumScaleFactor(0.6).privacySensitive()
            Spacer(minLength: 0)
            Text(payment.date, style: .date).font(.system(size: 9)).foregroundStyle(.secondary)
        }
    }
}

struct BalanceWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WalletBalance", provider: SnapshotProvider()) { entry in
            BalanceWidgetView(entry: entry)
        }
        .configurationDisplayName("Balance")
        .description("Your balance and the last payment, from the last sync.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryInline, .accessoryCircular, .accessoryRectangular])
    }
}

// MARK: Receive QR widget

struct ReceiveWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        Group {
            if entry.hasWallet, let img = SharedQR.image(for: entry.snapshot.address) {
                if family == .systemSmall {
                    Image(uiImage: img).interpolation(.none).resizable().scaledToFit()
                        .padding(4).background(Color.white)
                } else {
                    HStack(spacing: 12) {
                        Image(uiImage: img).interpolation(.none).resizable().scaledToFit()
                            .padding(4).background(Color.white)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Receive \(entry.snapshot.ticker)").font(.headline)
                            Text(entry.snapshot.address).font(.system(size: 9).monospaced()).lineLimit(6)
                        }
                    }
                }
            } else {
                VStack { Image(systemName: "qrcode"); Text("No wallet yet").font(.caption) }
            }
        }
        .widgetURL(AppRoute.receive.url)
        .modifier(WidgetBackground())
    }
}

struct ReceiveWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WalletReceiveQR", provider: SnapshotProvider()) { entry in
            ReceiveWidgetView(entry: entry)
        }
        .configurationDisplayName("Receive QR")
        .description("Your receive address as a QR code.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: Live Activity

@available(iOS 16.1, *)
struct WalletLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WalletActivityAttributes.self) { context in
            LockScreenActivityView(attributes: context.attributes, state: context.state)
                .padding()
                .activityBackgroundTint(Color.black.opacity(0.6))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(context.attributes.kind == .send ? AppRoute.transactions.url : AppRoute.wallet.url)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.attributes.kind == .send ? "Sending" : "Syncing",
                          systemImage: context.attributes.kind == .send ? "arrow.up.circle" : "arrow.triangle.2.circlepath")
                        .font(.caption)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.attributes.kind == .send ? (context.attributes.amountText ?? "") : percent(context.state.progress))
                        .font(.caption.monospacedDigit())
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading) {
                        ProgressView(value: context.state.progress)
                        Text(detail(context.attributes, context.state)).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            } compactLeading: {
                Image(systemName: context.attributes.kind == .send ? "arrow.up.circle" : "arrow.triangle.2.circlepath")
            } compactTrailing: {
                Text(context.state.done ? "✓" : percent(context.state.progress)).font(.caption2.monospacedDigit())
            } minimal: {
                Image(systemName: context.state.done ? "checkmark.circle" : "arrow.triangle.2.circlepath")
            }
            .widgetURL(context.attributes.kind == .send ? AppRoute.transactions.url : AppRoute.wallet.url)
        }
    }
}

@available(iOS 16.1, *)
struct LockScreenActivityView: View {
    let attributes: WalletActivityAttributes
    let state: WalletActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: attributes.kind == .send ? "arrow.up.circle.fill" : "arrow.triangle.2.circlepath")
                Text(attributes.kind == .send ? "Sending \(attributes.amountText ?? attributes.ticker)" : "\(attributes.ticker) wallet sync")
                    .font(.headline)
                Spacer()
                Text(state.done ? "Done" : percent(state.progress)).font(.headline.monospacedDigit())
            }
            ProgressView(value: state.progress)
            Text(detail(attributes, state)).font(.caption).foregroundStyle(.secondary)
        }
        .foregroundStyle(.white)
    }
}

@available(iOS 16.1, *)
private func detail(_ a: WalletActivityAttributes, _ s: WalletActivityAttributes.ContentState) -> String {
    switch a.kind {
    case .send:
        return [a.destinationShort.map { "To \($0)" }, s.status].compactMap { $0 }.joined(separator: " · ")
    case .sync:
        return s.done ? "Up to date at block \(s.walletHeight)" : "Block \(s.walletHeight) of \(s.networkHeight)"
    }
}

private func percent(_ p: Double) -> String { "\(Int((min(max(p, 0), 1) * 100).rounded(.down)))%" }

/// iOS 17 needs containerBackground for widgets; iOS 16 uses a plain background.
struct WidgetBackground: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            content.containerBackground(for: .widget) { Color(.systemBackground) }
        } else {
            content.padding().background(Color(.systemBackground))
        }
    }
}

@main
struct WalletWidgetBundle: WidgetBundle {
    var body: some Widget {
        BalanceWidget()
        ReceiveWidget()
        WalletLiveActivity()
    }
}
