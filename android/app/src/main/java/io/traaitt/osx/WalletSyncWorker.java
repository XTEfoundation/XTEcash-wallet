// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
package io.traaitt.osx;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Periodic background sync (WorkManager, every 15 minutes at the earliest, chosen by
 * Android). Runs the headless JS task "XTEWalletSync" (src/BackgroundSync.js), which
 * syncs a view-only copy of the wallet and posts payment notifications.
 */
public class WalletSyncWorker extends Worker {
    static final String UNIQUE_NAME = "xte-wallet-background-sync";
    static final String TASK_NAME = "XTEWalletSync";
    /** JS budget; WorkManager stops a worker after 10 minutes. */
    static final long TASK_TIMEOUT_MS = 9 * 60 * 1000;

    public WalletSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        CountDownLatch done = new CountDownLatch(1);
        HeadlessRunner.run(getApplicationContext(), TASK_NAME, TASK_TIMEOUT_MS, done);
        try {
            done.await(TASK_TIMEOUT_MS + 30_000, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return Result.success();
    }

    static void schedule(Context context, boolean unmeteredOnly, boolean chargingOnly) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(unmeteredOnly ? NetworkType.UNMETERED : NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true)
            .setRequiresCharging(chargingOnly)
            .build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(WalletSyncWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(UNIQUE_NAME, ExistingPeriodicWorkPolicy.REPLACE, request);
    }

    static void cancel(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_NAME);
    }
}
