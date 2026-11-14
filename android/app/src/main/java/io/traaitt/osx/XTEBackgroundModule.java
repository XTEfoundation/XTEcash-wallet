// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
package io.traaitt.osx;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

/** JS bridge (NativeModules.XTEBackground) for WorkManager sync and the restore service. */
public class XTEBackgroundModule extends ReactContextBaseJavaModule {
    XTEBackgroundModule(ReactApplicationContext context) {
        super(context);
    }

    @Override
    public String getName() {
        return "XTEBackground";
    }

    @ReactMethod
    public void schedulePeriodic(boolean unmeteredOnly, boolean chargingOnly, Promise promise) {
        try {
            WalletSyncWorker.schedule(getReactApplicationContext(), unmeteredOnly, chargingOnly);
            promise.resolve(true);
        } catch (Throwable t) {
            promise.reject("schedule", t.getMessage(), t);
        }
    }

    @ReactMethod
    public void cancelPeriodic(Promise promise) {
        try {
            WalletSyncWorker.cancel(getReactApplicationContext());
            promise.resolve(true);
        } catch (Throwable t) {
            promise.reject("cancel", t.getMessage(), t);
        }
    }

    @ReactMethod
    public void startRestoreService(String text, Promise promise) {
        try {
            Context ctx = getReactApplicationContext();
            Intent i = new Intent(ctx, WalletSyncService.class);
            i.putExtra(WalletSyncService.EXTRA_TEXT, text);
            ContextCompat.startForegroundService(ctx, i);
            promise.resolve(true);
        } catch (Throwable t) {
            // e.g. ForegroundServiceStartNotAllowedException when started from the background.
            promise.reject("start", t.getMessage(), t);
        }
    }

    @ReactMethod
    public void updateRestoreService(String text) {
        try {
            Context ctx = getReactApplicationContext();
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            nm.notify(WalletSyncService.NOTIFICATION_ID, WalletSyncService.buildNotification(ctx, text));
        } catch (Throwable ignored) {
        }
    }

    /** Progress bar (and on Android 16 a Live Update chip) for the restore notification. */
    @ReactMethod
    public void updateRestoreProgress(String text, double walletHeight, double networkHeight) {
        try {
            Context ctx = getReactApplicationContext();
            int max = networkHeight > 0 ? 1000 : 0;
            int progress = networkHeight > 0 ? (int) Math.min(1000, Math.round(walletHeight * 1000 / networkHeight)) : 0;
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            nm.notify(WalletSyncService.NOTIFICATION_ID, WalletSyncService.buildNotification(ctx, text, progress, max));
        } catch (Throwable ignored) {
        }
    }

    @ReactMethod
    public void stopRestoreService() {
        Context ctx = getReactApplicationContext();
        ctx.stopService(new Intent(ctx, WalletSyncService.class));
    }
}
