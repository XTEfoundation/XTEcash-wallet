// Copyright (c) 2026, XTE Foundation
//
// Please see the included LICENSE file for more information.
//
// Device security helpers for the wallet (NativeModules.XTESecurity):
//  - hardware-backed vault: AES-256-GCM key in the Android Keystore, created
//    in StrongBox when the device has one, else in the TEE. The wallet file is
//    encrypted with it before it is written to SQLite. The key never leaves
//    secure hardware and cannot be exported or backed up.
//  - FLAG_SECURE (no screenshots, blank preview in recents)
//  - root indicators
//  - PBKDF2-HMAC-SHA256 for password based backup encryption

package io.traaitt.osx;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.WindowManager;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import java.io.File;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;

public class XTESecurityModule extends ReactContextBaseJavaModule {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String VAULT_ALIAS = "xte-wallet-vault-v1";
    static final String PREFS = "xte-security";
    static final String PREF_SECURE_SCREEN = "secureScreen";

    public XTESecurityModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return "XTESecurity";
    }

    /* ---------- hardware vault ---------- */

    private static SecretKey vaultKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);

        if (ks.containsAlias(VAULT_ALIAS)) {
            return (SecretKey) ks.getKey(VAULT_ALIAS, null);
        }

        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);

        if (Build.VERSION.SDK_INT >= 28) {
            try {
                gen.init(vaultSpec(true));
                return gen.generateKey();
            } catch (Exception strongBoxUnavailable) {
                /* StrongBoxUnavailableException or a vendor quirk: use the TEE */
            }
        }

        gen.init(vaultSpec(false));
        return gen.generateKey();
    }

    private static KeyGenParameterSpec vaultSpec(boolean strongBox) {
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(
            VAULT_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true);

        if (Build.VERSION.SDK_INT >= 28 && strongBox) {
            b.setIsStrongBoxBacked(true);
        }

        /* No user authentication binding: background sync must be able to
           open the wallet. The app-level PIN/biometric lock guards the UI. */
        return b.build();
    }

    private static String securityLevel(SecretKey key) {
        try {
            SecretKeyFactory f = SecretKeyFactory.getInstance(key.getAlgorithm(), KEYSTORE);
            KeyInfo info = (KeyInfo) f.getKeySpec(key, KeyInfo.class);

            if (Build.VERSION.SDK_INT >= 31) {
                switch (info.getSecurityLevel()) {
                    case KeyProperties.SECURITY_LEVEL_STRONGBOX: return "StrongBox";
                    case KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT: return "TEE";
                    case KeyProperties.SECURITY_LEVEL_SOFTWARE: return "Software";
                    default: return "Unknown secure hardware";
                }
            }

            return info.isInsideSecureHardware() ? "Secure hardware (TEE or StrongBox)" : "Software";
        } catch (Exception e) {
            return "Unknown";
        }
    }

    @ReactMethod
    public void vaultInfo(Promise promise) {
        try {
            SecretKey key = vaultKey();
            WritableMap map = Arguments.createMap();
            map.putString("level", securityLevel(key));
            map.putBoolean("hasStrongBox", Build.VERSION.SDK_INT >= 28
                && getReactApplicationContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE));
            promise.resolve(map);
        } catch (Exception e) {
            promise.reject("vault", e.getMessage(), e);
        }
    }

    /** Encrypts UTF-8 text. Returns base64(iv(12) || ciphertext+tag). */
    @ReactMethod
    public void vaultEncrypt(final String plaintext, final Promise promise) {
        new Thread(() -> {
            try {
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.ENCRYPT_MODE, vaultKey());
                byte[] iv = c.getIV();
                byte[] ct = c.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
                ByteBuffer out = ByteBuffer.allocate(iv.length + ct.length);
                out.put(iv).put(ct);
                promise.resolve(Base64.encodeToString(out.array(), Base64.NO_WRAP));
            } catch (Exception e) {
                promise.reject("vault", e.getMessage(), e);
            }
        }).start();
    }

    @ReactMethod
    public void vaultDecrypt(final String encoded, final Promise promise) {
        new Thread(() -> {
            try {
                byte[] all = Base64.decode(encoded, Base64.NO_WRAP);
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.DECRYPT_MODE, vaultKey(), new GCMParameterSpec(128, all, 0, 12));
                byte[] pt = c.doFinal(all, 12, all.length - 12);
                promise.resolve(new String(pt, StandardCharsets.UTF_8));
            } catch (Exception e) {
                promise.reject("vault", e.getMessage(), e);
            }
        }).start();
    }

    /* ---------- screen protection ---------- */

    static void applySecureScreen(Activity activity) {
        if (activity == null) {
            return;
        }

        SharedPreferences p = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        if (p.getBoolean(PREF_SECURE_SCREEN, false)) {
            activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        } else {
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
    }

    @ReactMethod
    public void setScreenProtection(final boolean enabled, final Promise promise) {
        getReactApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(PREF_SECURE_SCREEN, enabled).apply();

        final Activity activity = getCurrentActivity();

        if (activity != null) {
            activity.runOnUiThread(() -> applySecureScreen(activity));
        }

        promise.resolve(enabled);
    }

    /* ---------- root indicators ---------- */

    @ReactMethod
    public void compromisedIndicators(Promise promise) {
        WritableArray reasons = Arguments.createArray();

        String[] paths = {
            "/system/app/Superuser.apk", "/sbin/su", "/system/bin/su", "/system/xbin/su",
            "/data/local/xbin/su", "/data/local/bin/su", "/system/sd/xbin/su",
            "/system/bin/failsafe/su", "/data/local/su", "/su/bin/su", "/system/xbin/daemonsu",
            "/sbin/.magisk", "/data/adb/magisk", "/cache/.disable_magisk",
        };

        for (String path : paths) {
            if (new File(path).exists()) {
                reasons.pushString("Found " + path);
            }
        }

        if (Build.TAGS != null && Build.TAGS.contains("test-keys")) {
            reasons.pushString("System is signed with test keys");
        }

        String[] packages = { "com.topjohnwu.magisk", "eu.chainfire.supersu", "com.koushikdutta.superuser", "com.noshufou.android.su" };
        PackageManager pm = getReactApplicationContext().getPackageManager();

        for (String pkg : packages) {
            try {
                pm.getPackageInfo(pkg, 0);
                reasons.pushString("Root manager app installed (" + pkg + ")");
            } catch (Exception notInstalled) {
                /* Fine. Android 11+ may also hide it without a <queries> entry. */
            }
        }

        promise.resolve(reasons);
    }

    /* ---------- password KDF ---------- */

    @ReactMethod
    public void pbkdf2Sha256(final String password, final String saltBase64, final double iterations, final double keyBytes, final Promise promise) {
        new Thread(() -> {
            try {
                byte[] salt = Base64.decode(saltBase64, Base64.NO_WRAP);
                PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, (int) iterations, (int) keyBytes * 8);
                byte[] key = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
                spec.clearPassword();
                promise.resolve(Base64.encodeToString(key, Base64.NO_WRAP));
            } catch (Exception e) {
                promise.reject("pbkdf2", e.getMessage(), e);
            }
        }).start();
    }

    /* iCloud Keychain does not exist on Android; keep the JS API uniform. */
    @ReactMethod
    public void cloudKeychainAvailable(Promise promise) {
        promise.resolve(false);
    }
}
