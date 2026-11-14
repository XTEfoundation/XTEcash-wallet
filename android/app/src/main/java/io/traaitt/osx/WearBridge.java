// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
package io.traaitt.osx;

import android.content.Context;

import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.PutDataRequest;
import com.google.android.gms.wearable.Wearable;

/**
 * Sends the public snapshot (address, balance text, last payment) to the Wear OS app
 * over the Wear Data Layer. No keys. Does nothing without Google Play services or a watch.
 */
public final class WearBridge {
    public static final String PATH = "/wallet/snapshot";

    private WearBridge() {}

    public static void publish(Context c, WalletWidgetData d) {
        try {
            PutDataMapRequest req = PutDataMapRequest.create(PATH);
            req.getDataMap().putString("ticker", c.getString(R.string.wallet_ticker));
            req.getDataMap().putString("address", d.address);
            req.getDataMap().putString("balanceText", d.hideBalance ? "" : d.balanceText);
            req.getDataMap().putString("lastPaymentText", d.hideBalance ? "" : d.lastPaymentText);
            req.getDataMap().putBoolean("lastPaymentIncoming", d.lastPaymentIncoming);
            req.getDataMap().putLong("lastPaymentTime", d.lastPaymentTime);
            req.getDataMap().putLong("updatedAt", d.updatedAt);
            req.getDataMap().putBoolean("synced", d.isSynced());
            PutDataRequest put = req.asPutDataRequest();
            Wearable.getDataClient(c.getApplicationContext()).putDataItem(put);
        } catch (Throwable ignored) {
            // No Play services / no Wear API on this device.
        }
    }
}
