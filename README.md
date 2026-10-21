# XTE Wallet

Mobile wallet for traaitt [XTE], published by the [XTE Foundation](https://github.com/XTEfoundation).

This tree is a React Native **0.68.7** app (React 18.1). Earlier migration notes that claimed React Native 0.76.1 did not match `package.json` and have been removed. Stay on 0.68.7 until an upgrade is done on its own branch.

License: [AGPL-3.0](LICENSE). Existing copyright notices stay in place.

## Requirements

- Node.js 18 (Node 16 also works). Node 22 is not supported by this React Native version.
- JDK 17. Gradle and Android Gradle Plugin 7.4.2 do not support JDK 21.
- Android SDK platform 34, build-tools 34.0.0, and NDK `25.1.8937393`.
- Yarn 1.

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_HOME=$HOME/Android/Sdk
yarn install
```

`yarn install` runs `patch-package`, `rn-nodeify`, and `jetify`. That is required for the Node polyfills this wallet uses.

`react-native-svg` is pinned to 12.5.1 and `react-native-qrcode-svg` to 6.1.2. SVG 14 generates Android code that imports React Native classes this 0.68 tree does not have. `react-native-screens` is pinned to 3.18.2 because the tab navigator imports it and 4.x does not build on this Android Gradle Plugin. `react-native-reanimated` is pinned to 2.17.0 and `react-native-safe-area-context` to 4.8.2, which are the versions the React Navigation 4 navigators in this app can load on React Native 0.68. `patches/react-native-tcp+3.3.2.patch` replaces the removed Gradle `compile` configuration and the old support-library import. `patches/react-native-udp+2.7.0.patch` makes the same import change. `patches/react-native-fingerprint-scanner+6.0.0.patch` loads FingerprintIdentify 1.2.6 from JitPack, because `com.wei.android.lib:fingerprintidentify` is no longer on Maven Central. `patches/react-native-background-fetch+3.1.0.patch` pins `tsbackgroundfetch` to 0.4.5, the copy shipped with that module. A dynamic version resolves 4.x and fails to compile. `patches/react-native-screens+3.18.2.patch` lets that module compile against Android SDK 34.

## Run on a device or emulator

```bash
yarn start
# second terminal
yarn android
```

The JS component name is `XTE` (`app.json`). The Android application id is `io.traaitt.osx`.

## Network

Configured in `src/Config.js`. Do not replace these with guessed hosts.

| Setting | Value |
| --- | --- |
| Coin | XTE, address prefix `1334` (addresses start with `XT`) |
| Default daemon | `main.trrxitte.com:443` TLS. This is a daemon, not a cache API. |
| Node list | `https://raw.githubusercontent.com/TRRXITTE/XTEnetworkserver/refs/heads/main/traaitt.json` |

That node list publishes regional daemons on port `14485` without TLS. The wallet stores a node as `host:port:ssl` or `host:port:plain`. Older `host:port` values are still accepted: port 443 is treated as TLS, every other port as plain TCP.

Payment URIs use `xte://`, for example:

```text
xte://XT...address?amount=10000&name=Example&paymentid=<64 hex chars>
```

`amount` is in atomic units (two decimal places, so `10000` is `100.00 XTE`).

## Android release

Versions are aligned at versionCode `1020` / versionName `1.020.0`:

- `package.json` `version`
- `android/app/build.gradle` `versionCode` and `versionName`
- `src/Config.js` `appVersion` (`v1.020.0`, the string shown in settings)
- HTTP user agent `XTE-v` + `versionName`, built from `BuildConfig.VERSION_NAME`

Bump all of those together for the next release.

### Signing

No upload key lives in this repository. `assembleRelease` with no signing config produces an **unsigned** APK (`app-release-unsigned.apk`). Play upload needs a key you generate and keep outside git.

Provide all four values, using any one of these mechanisms:

Environment variables:

```bash
export XTE_UPLOAD_STORE_FILE=/absolute/path/upload.keystore
export XTE_UPLOAD_STORE_PASSWORD='...'
export XTE_UPLOAD_KEY_ALIAS='...'
export XTE_UPLOAD_KEY_PASSWORD='...'
```

Gradle properties (not written into `android/gradle.properties`):

```bash
./gradlew assembleRelease \
  -PMYAPP_UPLOAD_STORE_FILE=/absolute/path/upload.keystore \
  -PMYAPP_UPLOAD_STORE_PASSWORD='...' \
  -PMYAPP_UPLOAD_KEY_ALIAS='...' \
  -PMYAPP_UPLOAD_KEY_PASSWORD='...'
```

Or copy `android/keystore.properties.example` to `android/keystore.properties` (gitignored). `storeFile` is resolved relative to `android/app` unless it is absolute.

The debug build uses the standard Android debug keystore checked in at `android/app/debug.keystore`. Its password is the public debug password `android`. It is not an upload key.

```bash
cd android
./gradlew assembleRelease
```

`build-apk.sh` runs the same unsigned release build from the repo root.

Create an upload key (example):

```bash
keytool -genkeypair -v \
  -keystore upload.keystore \
  -alias xte \
  -keyalg RSA -keysize 2048 -validity 10000
```

If an upload key was ever committed here, treat it as compromised, generate a new one, and reset it with Play App Signing. Removing the files from the current tree does not erase them from git history.

### Sentry

Release reporting is off unless `SENTRY_DSN` is set in the environment when the JS bundle is built. Babel inlines that variable and leaves reporting disabled when it is unset. Do not commit a DSN. Native symbol upload, if you enable it later, reads `android/sentry.properties` copied from `android/sentry.properties.example`. The auth token in that file is a secret and stays untracked. The Sentry Gradle plugin is not applied.

## Tests

```bash
yarn test
```

## What is not in this release

- **iOS.** `ios/TonChan` sources do not match the Xcode project, which still points at `traaittCashMobile` paths. Native crypto is disabled on iOS in `src/Config.js`. Android is the release target.
- **Play Store listing and a new upload key.** `applicationId` stays `io.traaitt.osx`. Store submission is a separate step after signing.
- **React Native upgrade, Play targetSdk 35, and navigation v6.** AGP is 7.4.2 with compileSdk/targetSdk 34 so this dependency set still builds. Google Play's current target API is higher; that upgrade has to land with an AGP/namespace pass, not as a drive-by.
- **The JS library package name** `traaittcash-wallet-backend`. That is the published module this app imports. It is not a user-visible name.

## Reporting issues

https://github.com/XTEfoundation/XTEcash-wallet/issues
