package io.traaitt.osx;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import com.facebook.react.ReactActivity;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends ReactActivity {

    /**
     * Returns the name of the main component registered from JavaScript.
     * This is used to schedule rendering of the component.
     */
    @Override
    protected String getMainComponentName() {
        return "XTE";
    }

    private Object backCallback;

    /**
     * react-native-screens cannot restore its fragments. When Android recreates
     * the activity (fold/unfold, resize, multi-window, density or theme change,
     * or after process death) the saved fragment state crashes with
     * "Screen fragments should never be restored". Drop the saved state; React
     * Native re-renders the screens from JS anyway.
     * https://github.com/software-mansion/react-native-screens#android
     */
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        rewriteShareIntent(getIntent());
        super.onCreate(null);

        /* Screenshot / recents protection chosen in Settings > Security */
        XTESecurityModule.applySecureScreen(this);

        applyOrientationPolicy(getResources().getConfiguration());
        WalletNotifications.ensureChannels(this);
        registerPredictiveBack();
    }

    @Override
    public void onNewIntent(Intent intent) {
        rewriteShareIntent(intent);
        super.onNewIntent(intent);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Fold/unfold changes the screen size without recreating the activity (configChanges).
        applyOrientationPolicy(newConfig);
    }

    /**
     * Phones stay in portrait. Large screens (unfolded Fold, tablets, desktop windows,
     * sw >= 600dp) rotate freely and get the two-pane layout in JS.
     */
    private void applyOrientationPolicy(Configuration cfg) {
        int want = cfg.smallestScreenWidthDp >= 600
            ? ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
        if (getRequestedOrientation() != want) {
            try {
                setRequestedOrientation(want);
            } catch (IllegalStateException ignored) {
                // Translucent activities on Android 8.0 cannot set an orientation.
            }
        }
    }

    /**
     * Predictive back (android:enableOnBackInvokedCallback). On Android 13+ the system no
     * longer calls onBackPressed for opted-in apps, so route the gesture to React Native's
     * BackHandler; when JS does not handle it, RN falls back to the default (leave the app).
     */
    private void registerPredictiveBack() {
        if (Build.VERSION.SDK_INT < 33) return;
        OnBackInvokedCallback cb = this::onBackPressed;
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb);
        backCallback = cb;
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback((OnBackInvokedCallback) backCallback);
            backCallback = null;
        }
        super.onDestroy();
    }

    private static final Pattern URI_OR_ADDRESS = Pattern.compile("([a-zA-Z]+://)?[A-Za-z0-9]{95,240}(\\?[^\\s]*)?");

    /**
     * "Share to wallet": text with a payment URI or a bare address becomes a VIEW intent
     * with that URI, which React Native's Linking hands to src/Platform.js.
     */
    private void rewriteShareIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text == null) return;
        String scheme = getString(R.string.wallet_payment_scheme);
        Matcher m = URI_OR_ADDRESS.matcher(text.toString().trim());
        Uri uri = null;
        while (m.find()) {
            String found = m.group();
            if (found.startsWith(scheme + "://") || found.startsWith(scheme + ":")) {
                uri = Uri.parse(found);
                break;
            }
            if (m.group(1) == null) {
                uri = Uri.parse(scheme + "://" + found);
                break;
            }
        }
        if (uri == null) {
            uri = WalletWidgetData.route(this, "send");
        }
        intent.setAction(Intent.ACTION_VIEW);
        intent.setData(uri);
        intent.removeExtra(Intent.EXTRA_TEXT);
    }
}
