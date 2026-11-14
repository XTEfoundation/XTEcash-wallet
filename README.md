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

## iOS build and release

The Xcode project lives in `ios/XTE.xcodeproj` (React Native 0.68, JSC, old architecture). Always open the workspace that CocoaPods creates.

| | |
|---|---|
| Display name | XTE |
| Bundle identifier | `io.traaitt.osx` |
| Version / build | `1.020.0` / `1020` (`MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in the project) |
| URL scheme | `xte://` |
| Minimum iOS | 13.0, iPhone only, portrait |

Requirements: macOS with Xcode 16 (CI uses Xcode 16.4 on `macos-15`), Node 18, Yarn 1, CocoaPods 1.15 or newer.

```bash
yarn install --frozen-lockfile
cd ios && pod install && cd ..
yarn ios            # or open ios/XTE.xcworkspace in Xcode
```

Notes:

- **Simulator architecture.** `react-native-background-fetch` 3.1 ships `TSBackgroundFetch.framework` without an arm64 simulator slice, so simulator builds exclude arm64 and run as x86_64 (Rosetta on Apple Silicon). Device builds are unaffected.
- **Native crypto.** `ios/XTE/XTEModule.mm` exposes the same `XTE` native module as Android. It compiles the shared C++ in `android/app/src/main/jni` (`crypto.cpp`, `BlockOutputs.cpp`, ...) so both platforms use one implementation. iOS uses it for key derivation, key images, ring signatures and block output scanning. `getWalletSyncData` (the cancellable HTTP request on Android) is not ported; iOS uses the JS HTTP client for that request.
- **Background sync** uses BGTaskScheduler (`com.transistorsoft.fetch` in `Info.plist`). iOS decides when, and how often, it runs.
- **Pods patches.** `patches/react-native+0.68.7.patch` points the boost podspec at `archives.boost.io` (the old JFrog URL is gone). The `Podfile` `post_install` raises every pod to iOS 13 and defines `_LIBCPP_ENABLE_CXX17_REMOVED_UNARY_BINARY_FUNCTION`, which current libc++ needs for RN 0.68's boost/Folly.

CI (`.github/workflows/ci.yml`, job `ios`) runs `pod install` and an **unsigned** Release simulator build (`CODE_SIGNING_ALLOWED=NO`). It does not produce an installable or uploadable app.

### Signing and App Store upload

Nothing needed for signing is in this repository and none of it should be committed: no certificates (`.p12`), provisioning profiles (`.mobileprovision`), App Store Connect API keys (`.p8`) or team-specific `ExportOptions.plist`. `.gitignore` excludes them.

To ship a build:

1. In the Apple Developer account of the publishing organisation, register the App ID `io.traaitt.osx` and create the App Store Connect app record for it.
2. Local release: open `ios/XTE.xcworkspace`, select the `XTE` target, *Signing & Capabilities*, choose your team and leave *Automatically manage signing* on (or select a distribution certificate and an App Store provisioning profile). Do not commit the resulting `DEVELOPMENT_TEAM` change if this is a shared branch. Then *Product, Archive* and *Distribute App, App Store Connect*.
3. CI release (optional, not set up here): store the distribution certificate (base64 `.p12` plus password), the provisioning profile and an App Store Connect API key as encrypted GitHub Actions secrets. Import them into a temporary keychain in the job, pass `DEVELOPMENT_TEAM`, `CODE_SIGN_STYLE=Manual` and `PROVISIONING_PROFILE_SPECIFIER` to `xcodebuild archive`, and upload with `xcodebuild -exportArchive` or `xcrun altool` / Transporter. Delete the keychain at the end of the job.

Before App Store submission, also check: the Xcode/SDK version Apple currently requires for uploads (the project is verified on Xcode 16.4; newer SDKs may require an RN upgrade), the export-compliance answer (the app uses cryptography beyond HTTPS for wallet keys and signatures), a privacy manifest (`PrivacyInfo.xcprivacy`) for the required-reason APIs used by the app and its pods, and App Review's crypto-wallet rules (guideline 3.1.5: wallets must be published by an organisation).

## Tests

```bash
yarn test
```

## What is not in this release

- **A signed iOS build and an App Store listing.** The iOS project builds unsigned in CI; signing, the App Store Connect record and submission are separate steps (see *iOS build and release*).
- **Play Store listing and a new upload key.** `applicationId` stays `io.traaitt.osx`. Store submission is a separate step after signing.
- **React Native upgrade, Play targetSdk 35, and navigation v6.** AGP is 7.4.2 with compileSdk/targetSdk 34 so this dependency set still builds. Google Play's current target API is higher; that upgrade has to land with an AGP/namespace pass, not as a drive-by.
- **The JS library package name** `traaittcash-wallet-backend`. That is the published module this app imports. It is not a user-visible name.

## Reporting issues

https://github.com/XTEfoundation/XTEcash-wallet/issues
