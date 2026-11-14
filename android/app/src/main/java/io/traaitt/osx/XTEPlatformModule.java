// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
package io.traaitt.osx;

import android.app.Activity;
import android.app.LocaleManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.LocaleList;
import android.provider.Settings;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import androidx.fragment.app.FragmentActivity;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;

/**
 * JS bridge (NativeModules.XTEPlatform) for Android platform features: widgets / tile /
 * watch snapshot, app shortcuts, rich notifications, BiometricPrompt, Material You colours
 * and per-app language. See src/Platform.js.
 */
public class XTEPlatformModule extends ReactContextBaseJavaModule {
    XTEPlatformModule(ReactApplicationContext context) {
        super(context);
    }

    @Override
    public String getName() {
        return "XTEPlatform";
    }

    private Context ctx() {
        return getReactApplicationContext();
    }

    /* ---------- widgets, tile, watch ---------- */

    @ReactMethod
    public void updateWidgetData(String json, Promise promise) {
        try {
            WalletWidgetData.save(ctx(), json);
            promise.resolve(true);
        } catch (Throwable t) {
            promise.reject("widget", t.getMessage(), t);
        }
    }

    @ReactMethod
    public void notePendingIncoming(String amountText) {
        WalletWidgetData.notePendingIncoming(ctx(), amountText);
    }

    @ReactMethod
    public void clearWidgetData() {
        WalletWidgetData.clear(ctx());
    }

    /* ---------- shortcuts (launcher long-press, Assistant) ---------- */

    /** [{id, label, uri}] - "Pay <contact>" shortcuts for the most used recipients. */
    @ReactMethod
    public void setDynamicShortcuts(String json, Promise promise) {
        try {
            Context c = ctx();
            JSONArray arr = new JSONArray(json);
            List<ShortcutInfoCompat> list = new ArrayList<>();
            int max = Math.min(arr.length(), Math.max(0, ShortcutManagerCompat.getMaxShortcutCountPerActivity(c) - 4));
            for (int i = 0; i < max; i++) {
                JSONObject o = arr.getJSONObject(i);
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(o.getString("uri")), c, MainActivity.class);
                list.add(new ShortcutInfoCompat.Builder(c, "pay-" + o.getString("id"))
                    .setShortLabel(o.getString("label"))
                    .setLongLabel(c.getString(R.string.shortcut_pay_contact, o.getString("label")))
                    .setIcon(IconCompat.createWithResource(c, R.drawable.ic_shortcut_contact))
                    .setIntent(intent)
                    .setRank(i)
                    .build());
            }
            ShortcutManagerCompat.setDynamicShortcuts(c, list);
            promise.resolve(list.size());
        } catch (Throwable t) {
            promise.reject("shortcuts", t.getMessage(), t);
        }
    }

    @ReactMethod
    public void reportShortcutUsed(String id) {
        try {
            ShortcutManagerCompat.reportShortcutUsed(ctx(), id);
        } catch (Throwable ignored) {
        }
    }

    @ReactMethod
    public void requestPinWidget(String which, Promise promise) {
        try {
            Context c = ctx();
            if (Build.VERSION.SDK_INT < 26) { promise.resolve(false); return; }
            android.appwidget.AppWidgetManager m = c.getSystemService(android.appwidget.AppWidgetManager.class);
            Class<?> cls = "receive".equals(which) ? ReceiveWidgetProvider.class : BalanceWidgetProvider.class;
            if (m == null || !m.isRequestPinAppWidgetSupported()) { promise.resolve(false); return; }
            promise.resolve(m.requestPinAppWidget(new android.content.ComponentName(c, cls), null, null));
        } catch (Throwable t) {
            promise.reject("pin", t.getMessage(), t);
        }
    }

    /* ---------- notifications ---------- */

    @ReactMethod
    public void showPaymentNotification(String title, String body, String hash) {
        WalletNotifications.payment(ctx(), title, body, hash);
    }

    @ReactMethod
    public void showSendProgress(String hash, String amountText, String status, int progress, boolean done) {
        WalletNotifications.send(ctx(), hash, amountText, status, progress, done);
    }

    @ReactMethod
    public void cancelSendProgress(String hash) {
        WalletNotifications.cancelSend(ctx(), hash);
    }

    @ReactMethod
    public void openNotificationSettings() {
        Context c = ctx();
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, c.getPackageName())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        c.startActivity(i);
    }

    /* ---------- BiometricPrompt ---------- */

    /**
     * Fingerprint / face, falling back to the screen lock (PIN, pattern, password).
     * Resolves "ok", "unavailable" (no secure lock screen) or rejects on cancel/failure.
     */
    @ReactMethod
    public void authenticate(final String title, final String subtitle, final Promise promise) {
        final Activity activity = getCurrentActivity();
        if (!(activity instanceof FragmentActivity)) {
            promise.reject("no_activity", "No activity");
            return;
        }
        final int authenticators = Build.VERSION.SDK_INT >= 30
            ? BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL
            : BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
        int can = BiometricManager.from(activity).canAuthenticate(authenticators);
        if (can != BiometricManager.BIOMETRIC_SUCCESS) {
            promise.resolve("unavailable");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Executor executor = ContextCompat.getMainExecutor(activity);
                BiometricPrompt prompt = new BiometricPrompt((FragmentActivity) activity, executor,
                    new BiometricPrompt.AuthenticationCallback() {
                        boolean settled = false;

                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            if (settled) return;
                            settled = true;
                            promise.resolve("ok");
                        }

                        @Override
                        public void onAuthenticationError(int code, CharSequence msg) {
                            if (settled) return;
                            settled = true;
                            promise.reject(code == BiometricPrompt.ERROR_USER_CANCELED || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                                || code == BiometricPrompt.ERROR_CANCELED ? "cancelled" : "error", msg.toString());
                        }
                    });
                BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setAllowedAuthenticators(authenticators)
                    .setConfirmationRequired(true)
                    .build();
                prompt.authenticate(info);
            } catch (Throwable t) {
                promise.reject("error", t.getMessage(), t);
            }
        });
    }

    /* ---------- Material You ---------- */

    private static String hex(int color) {
        return String.format("#%06X", 0xFFFFFF & color);
    }

    /** Android 12+ wallpaper colours, or null. */
    @ReactMethod
    public void getDynamicColors(Promise promise) {
        if (Build.VERSION.SDK_INT < 31) {
            promise.resolve(null);
            return;
        }
        Context c = ctx();
        WritableMap m = Arguments.createMap();
        m.putString("accent1_100", hex(c.getColor(android.R.color.system_accent1_100)));
        m.putString("accent1_200", hex(c.getColor(android.R.color.system_accent1_200)));
        m.putString("accent1_600", hex(c.getColor(android.R.color.system_accent1_600)));
        m.putString("accent1_800", hex(c.getColor(android.R.color.system_accent1_800)));
        m.putString("accent2_200", hex(c.getColor(android.R.color.system_accent2_200)));
        m.putString("accent2_600", hex(c.getColor(android.R.color.system_accent2_600)));
        m.putString("accent3_200", hex(c.getColor(android.R.color.system_accent3_200)));
        m.putString("accent3_600", hex(c.getColor(android.R.color.system_accent3_600)));
        m.putString("neutral1_10", hex(c.getColor(android.R.color.system_neutral1_10)));
        m.putString("neutral1_50", hex(c.getColor(android.R.color.system_neutral1_50)));
        m.putString("neutral1_900", hex(c.getColor(android.R.color.system_neutral1_900)));
        m.putString("neutral2_100", hex(c.getColor(android.R.color.system_neutral2_100)));
        m.putString("neutral2_700", hex(c.getColor(android.R.color.system_neutral2_700)));
        m.putString("neutral2_800", hex(c.getColor(android.R.color.system_neutral2_800)));
        boolean night = (c.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        m.putBoolean("night", night);
        promise.resolve(m);
    }

    /* ---------- per-app language (Android 13+) ---------- */

    @ReactMethod
    public void getAppLanguage(Promise promise) {
        if (Build.VERSION.SDK_INT < 33) { promise.resolve(""); return; }
        LocaleManager lm = ctx().getSystemService(LocaleManager.class);
        LocaleList l = lm.getApplicationLocales();
        promise.resolve(l.isEmpty() ? "" : l.get(0).toLanguageTag());
    }

    /** "" = follow the system. */
    @ReactMethod
    public void setAppLanguage(String tag, Promise promise) {
        if (Build.VERSION.SDK_INT < 33) { promise.resolve(false); return; }
        LocaleManager lm = ctx().getSystemService(LocaleManager.class);
        lm.setApplicationLocales(tag == null || tag.isEmpty() ? LocaleList.getEmptyLocaleList() : LocaleList.forLanguageTags(tag));
        promise.resolve(true);
    }

    /** Opens Settings > Apps > <app> > Language (Android 13+). */
    @ReactMethod
    public void openLanguageSettings() {
        Context c = ctx();
        Intent i = Build.VERSION.SDK_INT >= 33
            ? new Intent(Settings.ACTION_APP_LOCALE_SETTINGS, Uri.parse("package:" + c.getPackageName()))
            : new Intent(Settings.ACTION_LOCALE_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        c.startActivity(i);
    }

    /* ---------- window ---------- */

    @ReactMethod
    public void getWindowInfo(Promise promise) {
        Configuration cfg = ctx().getResources().getConfiguration();
        WritableMap m = Arguments.createMap();
        m.putInt("smallestWidthDp", cfg.smallestScreenWidthDp);
        m.putInt("widthDp", cfg.screenWidthDp);
        m.putInt("heightDp", cfg.screenHeightDp);
        promise.resolve(m);
    }
}
