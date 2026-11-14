// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
package io.traaitt.osx;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.facebook.react.ReactApplication;
import com.facebook.react.ReactInstanceManager;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.jstasks.HeadlessJsTaskConfig;
import com.facebook.react.jstasks.HeadlessJsTaskContext;
import com.facebook.react.jstasks.HeadlessJsTaskEventListener;

import java.util.concurrent.CountDownLatch;

/**
 * Runs a registered headless JS task (AppRegistry.registerHeadlessTask) from a
 * WorkManager worker, creating the React context when the app is not running,
 * and counts the latch down when the task finishes.
 */
final class HeadlessRunner {
    private static final String TAG = "XTEBackground";

    private HeadlessRunner() {}

    static void run(final Context context, final String taskName, final long timeoutMs, final CountDownLatch done) {
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override
            public void run() {
                try {
                    final ReactInstanceManager manager =
                        ((ReactApplication) context.getApplicationContext()).getReactNativeHost().getReactInstanceManager();
                    ReactContext current = manager.getCurrentReactContext();
                    if (current != null) {
                        start(current, taskName, timeoutMs, done);
                        return;
                    }
                    manager.addReactInstanceEventListener(new ReactInstanceManager.ReactInstanceEventListener() {
                        @Override
                        public void onReactContextInitialized(final ReactContext reactContext) {
                            manager.removeReactInstanceEventListener(this);
                            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                                @Override
                                public void run() {
                                    start(reactContext, taskName, timeoutMs, done);
                                }
                            }, 500);
                        }
                    });
                    if (!manager.hasStartedCreatingInitialContext()) {
                        manager.createReactContextInBackground();
                    }
                } catch (Throwable t) {
                    Log.e(TAG, "Could not start headless task " + taskName, t);
                    done.countDown();
                }
            }
        });
    }

    private static void start(ReactContext reactContext, String taskName, long timeoutMs, final CountDownLatch done) {
        try {
            final HeadlessJsTaskContext tasks = HeadlessJsTaskContext.getInstance(reactContext);
            WritableMap data = Arguments.createMap();
            data.putString("source", "workmanager");
            // Allowed in foreground: the JS task itself returns at once when the app is visible.
            HeadlessJsTaskConfig config = new HeadlessJsTaskConfig(taskName, data, timeoutMs, true);
            final int[] id = new int[] { -1 };
            tasks.addTaskEventListener(new HeadlessJsTaskEventListener() {
                @Override
                public void onHeadlessJsTaskStart(int taskId) {}

                @Override
                public void onHeadlessJsTaskFinish(int taskId) {
                    if (taskId == id[0]) {
                        tasks.removeTaskEventListener(this);
                        done.countDown();
                    }
                }
            });
            id[0] = tasks.startTask(config);
        } catch (Throwable t) {
            Log.e(TAG, "Headless task " + taskName + " failed", t);
            done.countDown();
        }
    }
}
