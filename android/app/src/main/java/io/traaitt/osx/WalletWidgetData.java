// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
package io.traaitt.osx;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONObject;

/**
 * Public wallet snapshot for widgets, the Quick Settings tile, shortcuts and the watch:
 * address, balance text, last payment. Written by JS after each sync. Never a key.
 * Stored in its own SharedPreferences file, which backup_rules.xml excludes like all app data.
 */
public final class WalletWidgetData {
    private static final String PREFS = "wallet_widget_snapshot";

    public final String address;
    public final String balanceText;
    public final String lockedText;
    public final String lastPaymentText;
    public final boolean lastPaymentIncoming;
    public final long lastPaymentTime;
    public final long walletHeight;
    public final long networkHeight;
    public final long updatedAt;
    public final boolean hideBalance;

    private WalletWidgetData(SharedPreferences p) {
        address = p.getString("address", "");
        balanceText = p.getString("balanceText", "");
        lockedText = p.getString("lockedText", "");
        lastPaymentText = p.getString("lastPaymentText", "");
        lastPaymentIncoming = p.getBoolean("lastPaymentIncoming", true);
        lastPaymentTime = p.getLong("lastPaymentTime", 0);
        walletHeight = p.getLong("walletHeight", 0);
        networkHeight = p.getLong("networkHeight", 0);
        updatedAt = p.getLong("updatedAt", 0);
        hideBalance = p.getBoolean("hideBalance", false);
    }

    public boolean hasWallet() {
        return address != null && !address.isEmpty();
    }

    public boolean isSynced() {
        return networkHeight > 0 && walletHeight + 1 >= networkHeight;
    }

    public static WalletWidgetData load(Context c) {
        return new WalletWidgetData(c.getSharedPreferences(PREFS, Context.MODE_PRIVATE));
    }

    /** JSON from src/Platform.js. Only public fields are accepted. */
    public static void save(Context c, String json) throws Exception {
        JSONObject o = new JSONObject(json);
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("address", o.optString("address", ""))
            .putString("balanceText", o.optString("balanceText", ""))
            .putString("lockedText", o.optString("lockedText", ""))
            .putString("lastPaymentText", o.optString("lastPaymentText", ""))
            .putBoolean("lastPaymentIncoming", o.optBoolean("lastPaymentIncoming", true))
            .putLong("lastPaymentTime", o.optLong("lastPaymentTime", 0))
            .putLong("walletHeight", o.optLong("walletHeight", 0))
            .putLong("networkHeight", o.optLong("networkHeight", 0))
            .putBoolean("hideBalance", o.optBoolean("hideBalance", false))
            .putLong("updatedAt", System.currentTimeMillis())
            .apply();
        refreshAll(c);
    }

    /** A payment seen by the view-only background sync before the wallet counted it. */
    public static void notePendingIncoming(Context c, String amountText) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("lastPaymentText", "+" + amountText)
            .putBoolean("lastPaymentIncoming", true)
            .putLong("lastPaymentTime", System.currentTimeMillis())
            .apply();
        refreshAll(c);
    }

    public static void clear(Context c) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        refreshAll(c);
    }

    /** Redraws the widgets, the tile and the watch copy. */
    public static void refreshAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        for (Class<?> cls : new Class<?>[] { BalanceWidgetProvider.class, ReceiveWidgetProvider.class }) {
            int[] ids = m.getAppWidgetIds(new ComponentName(c, cls));
            if (ids.length == 0) continue;
            Intent i = new Intent(c, cls);
            i.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
            i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
            c.sendBroadcast(i);
        }
        WalletTileService.requestUpdate(c);
        WearBridge.publish(c, load(c));
    }

    /** Internal deep link, e.g. xtewallet://receive (handled in src/Platform.js). */
    public static Uri route(Context c, String route) {
        return Uri.parse(c.getString(R.string.wallet_route_scheme) + "://" + route);
    }
}
