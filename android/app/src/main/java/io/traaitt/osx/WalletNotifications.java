// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
package io.traaitt.osx;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationChannelGroup;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import java.lang.reflect.Method;

/**
 * Notification channels and the rich notifications: incoming payments (with actions),
 * outgoing transactions until confirmed, and sync progress. On Android 16 the progress
 * notifications use Notification.ProgressStyle and ask to be promoted to a Live Update
 * (via reflection, so the app still builds against SDK 34).
 */
public final class WalletNotifications {
    public static final String CHANNEL_PAYMENTS = "payments";
    public static final String CHANNEL_SENDS = "outgoing";
    public static final String CHANNEL_SYNC = WalletSyncService.CHANNEL_ID;
    private static final String GROUP = "wallet";
    private static final String PAYMENT_GROUP_KEY = "io.traaitt.wallet.PAYMENTS";

    private WalletNotifications() {}

    public static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.createNotificationChannelGroup(new NotificationChannelGroup(GROUP, c.getString(R.string.app_name)));

        NotificationChannel pay = new NotificationChannel(CHANNEL_PAYMENTS, c.getString(R.string.channel_payments), NotificationManager.IMPORTANCE_HIGH);
        pay.setDescription(c.getString(R.string.channel_payments_description));
        pay.setGroup(GROUP);
        pay.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        pay.enableVibration(true);
        nm.createNotificationChannel(pay);

        NotificationChannel send = new NotificationChannel(CHANNEL_SENDS, c.getString(R.string.channel_sends), NotificationManager.IMPORTANCE_DEFAULT);
        send.setDescription(c.getString(R.string.channel_sends_description));
        send.setGroup(GROUP);
        send.setSound(null, null);
        nm.createNotificationChannel(send);

        NotificationChannel sync = new NotificationChannel(CHANNEL_SYNC, c.getString(R.string.channel_sync), NotificationManager.IMPORTANCE_LOW);
        sync.setDescription(c.getString(R.string.channel_sync_description));
        sync.setGroup(GROUP);
        sync.setShowBadge(false);
        nm.createNotificationChannel(sync);
    }

    static PendingIntent route(Context c, String route, int requestCode) {
        return BalanceWidgetProvider.open(c, route, requestCode);
    }

    private static boolean canPost(Context c) {
        return NotificationManagerCompat.from(c).areNotificationsEnabled();
    }

    /** "XTE received" with "Show transactions" and "Show receive QR" actions. */
    public static void payment(Context c, String title, String body, String hash) {
        ensureChannels(c);
        if (!canPost(c)) return;
        int id = hash == null ? (int) System.currentTimeMillis() : hash.hashCode();
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL_PAYMENTS)
            .setSmallIcon(R.mipmap.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(new NotificationCompat.Builder(c, CHANNEL_PAYMENTS)
                .setSmallIcon(R.mipmap.ic_notification)
                .setContentTitle(title)
                .setContentText(c.getString(R.string.notification_hidden_amount))
                .build())
            .setGroup(PAYMENT_GROUP_KEY)
            .setAutoCancel(true)
            .setContentIntent(route(c, "transactions", 200))
            .addAction(0, c.getString(R.string.action_show_transactions), route(c, "transactions", 201))
            .addAction(0, c.getString(R.string.action_show_receive), route(c, "receive", 202));
        try {
            NotificationManagerCompat.from(c).notify(id, b.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS not granted
        }
    }

    /** Ongoing notification for an outgoing transaction until it is confirmed. */
    public static void send(Context c, String hash, String amountText, String status, int progress, boolean done) {
        ensureChannels(c);
        if (!canPost(c) || hash == null) return;
        String title = c.getString(done ? R.string.send_confirmed_title : R.string.send_pending_title, amountText);
        Notification n = progressNotification(c, CHANNEL_SENDS, title, status, progress, 100, !done, route(c, "transactions", 210));
        try {
            NotificationManagerCompat.from(c).notify(("send:" + hash).hashCode(), n);
        } catch (SecurityException ignored) {
        }
    }

    public static void cancelSend(Context c, String hash) {
        NotificationManagerCompat.from(c).cancel(("send:" + hash).hashCode());
    }

    /**
     * Progress notification. Android 16+: Notification.ProgressStyle + promoted ongoing
     * (Live Update); older: NotificationCompat with a progress bar.
     */
    public static Notification progressNotification(Context c, String channel, String title, String text,
                                                    int progress, int max, boolean ongoing, PendingIntent tap) {
        if (Build.VERSION.SDK_INT >= 36) {
            Notification live = liveUpdate(c, channel, title, text, progress, max, ongoing, tap);
            if (live != null) return live;
        }
        return new NotificationCompat.Builder(c, channel)
            .setSmallIcon(R.mipmap.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setProgress(max, Math.max(0, Math.min(progress, max)), max <= 0)
            .setOngoing(ongoing)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setTimeoutAfter(ongoing ? 0 : 15 * 60 * 1000)
            .setContentIntent(tap)
            .build();
    }

    private static Notification liveUpdate(Context c, String channel, String title, String text,
                                           int progress, int max, boolean ongoing, PendingIntent tap) {
        try {
            Notification.Builder b = new Notification.Builder(c, channel)
                .setSmallIcon(R.mipmap.ic_notification)
                .setContentTitle(title)
                .setContentText(text)
                .setOngoing(ongoing)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_PROGRESS)
                .setContentIntent(tap);
            Class<?> styleCls = Class.forName("android.app.Notification$ProgressStyle");
            Object style = styleCls.getConstructor().newInstance();
            int clamped = Math.max(0, Math.min(progress, Math.max(max, 1)));
            // A single segment spanning the whole range, then the current progress.
            Class<?> segCls = Class.forName("android.app.Notification$ProgressStyle$Segment");
            Object seg = segCls.getConstructor(int.class).newInstance(Math.max(max, 1));
            styleCls.getMethod("addProgressSegment", segCls).invoke(style, seg);
            styleCls.getMethod("setProgress", int.class).invoke(style, clamped);
            if (max <= 0) styleCls.getMethod("setProgressIndeterminate", boolean.class).invoke(style, true);
            b.setStyle((Notification.Style) style);
            if (ongoing) {
                // Live Update (status chip). Needs POST_PROMOTED_NOTIFICATIONS; ignored otherwise.
                Method promote = Notification.Builder.class.getMethod("setRequestPromotedOngoing", boolean.class);
                promote.invoke(b, true);
                try {
                    Method chip = Notification.Builder.class.getMethod("setShortCriticalText", String.class);
                    chip.invoke(b, max > 0 ? (clamped * 100 / max) + "%" : "…");
                } catch (NoSuchMethodException ignored) {
                }
            } else {
                b.setTimeoutAfter(15 * 60 * 1000);
            }
            return b.build();
        } catch (Throwable t) {
            return null;
        }
    }
}
