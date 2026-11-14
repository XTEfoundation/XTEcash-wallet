// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
package io.traaitt.osx;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Bundle;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.facebook.react.HeadlessJsTaskService;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.jstasks.HeadlessJsTaskConfig;

/**
 * Optional foreground service for a long restore: keeps the process alive with an
 * ongoing notification while the wallet catches up in the background. Runs the
 * headless JS task "XTEWalletRestore", which ends when the wallet is synced or the
 * user stops it.
 */
public class WalletSyncService extends HeadlessJsTaskService {
    static final String CHANNEL_ID = "wallet_sync";
    static final int NOTIFICATION_ID = 4711;
    static final String EXTRA_TEXT = "text";

    static Notification buildNotification(Context context, String text) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Wallet sync", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shown while the wallet catches up in the background");
            nm.createNotificationChannel(channel);
        }
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent pi = PendingIntent.getActivity(context, 0, open, flags);
        return new NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(context.getString(R.string.app_name) + " is syncing")
            .setContentText(text == null ? "Catching up with the network" : text)
            .setSmallIcon(R.mipmap.ic_notification)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pi)
            .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String text = intent != null ? intent.getStringExtra(EXTRA_TEXT) : null;
        Notification n = buildNotification(this, text);
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
        return super.onStartCommand(intent, flags, startId);
    }

    @Override
    protected @Nullable HeadlessJsTaskConfig getTaskConfig(Intent intent) {
        Bundle extras = intent != null && intent.getExtras() != null ? intent.getExtras() : new Bundle();
        // No timeout: the JS task resolves when the restore is done or stopped.
        return new HeadlessJsTaskConfig("XTEWalletRestore", Arguments.fromBundle(extras), 0, true);
    }

    @Override
    public void onHeadlessJsTaskFinish(int taskId) {
        super.onHeadlessJsTaskFinish(taskId);
        stopForeground(true);
    }
}
