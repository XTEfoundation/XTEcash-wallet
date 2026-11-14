// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
package io.traaitt.osx;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.graphics.Bitmap;
import android.widget.RemoteViews;

/** Home-screen widget: the receive address as a QR code. */
public class ReceiveWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        WalletWidgetData d = WalletWidgetData.load(c);
        Bitmap qr = d.hasWallet() ? QrBitmap.encode(d.address, 360) : null;
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_receive);
            if (qr != null) {
                v.setImageViewBitmap(R.id.widget_qr, qr);
            } else {
                v.setImageViewResource(R.id.widget_qr, R.mipmap.ic_launcher_foreground);
            }
            String a = d.address;
            v.setTextViewText(R.id.widget_address, d.hasWallet()
                ? (a.length() > 18 ? a.substring(0, 10) + "…" + a.substring(a.length() - 6) : a)
                : c.getString(R.string.widget_no_wallet));
            v.setOnClickPendingIntent(R.id.widget_root, BalanceWidgetProvider.open(c, "receive", 110));
            m.updateAppWidget(id, v);
        }
    }
}
