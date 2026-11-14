// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
package io.traaitt.osx;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.text.format.DateUtils;
import android.view.View;
import android.widget.RemoteViews;

/** Home-screen widget: balance and the last payment from the cached snapshot. */
public class BalanceWidgetProvider extends AppWidgetProvider {
    static PendingIntent open(Context c, String route, int requestCode) {
        Intent i = new Intent(Intent.ACTION_VIEW, WalletWidgetData.route(c, route), c, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getActivity(c, requestCode, i, flags);
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        WalletWidgetData d = WalletWidgetData.load(c);
        String ticker = c.getString(R.string.wallet_ticker);
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_balance);
            v.setTextViewText(R.id.widget_title, c.getString(R.string.widget_wallet_title, ticker));
            if (!d.hasWallet()) {
                v.setTextViewText(R.id.widget_balance, "—");
                v.setTextViewText(R.id.widget_last_payment, c.getString(R.string.widget_no_wallet));
                v.setViewVisibility(R.id.widget_updated, View.GONE);
            } else {
                v.setTextViewText(R.id.widget_balance, d.hideBalance ? "••••• " + ticker : d.balanceText);
                v.setTextViewText(R.id.widget_last_payment, d.lastPaymentText.isEmpty()
                    ? c.getString(R.string.widget_no_payments)
                    : c.getString(d.lastPaymentIncoming ? R.string.widget_last_in : R.string.widget_last_out,
                        d.hideBalance ? "•••" : d.lastPaymentText,
                        DateUtils.getRelativeTimeSpanString(d.lastPaymentTime, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS)));
                v.setViewVisibility(R.id.widget_updated, View.VISIBLE);
                v.setTextViewText(R.id.widget_updated, d.isSynced()
                    ? c.getString(R.string.widget_updated, DateUtils.getRelativeTimeSpanString(d.updatedAt, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS))
                    : c.getString(R.string.widget_syncing, d.walletHeight, d.networkHeight));
            }
            v.setOnClickPendingIntent(R.id.widget_root, open(c, "wallet", 100));
            v.setOnClickPendingIntent(R.id.widget_send, open(c, "send", 101));
            v.setOnClickPendingIntent(R.id.widget_receive, open(c, "receive", 102));
            m.updateAppWidget(id, v);
        }
    }
}
