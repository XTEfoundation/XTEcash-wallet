// Copyright (C) 2018, Zpalmtree
// Copyright (c) 2026, TRRXITTE Int., incorporate.
//
// Please see the included LICENSE file for more information.
//
// Background sync.
//
//  - Android: WorkManager runs the headless task "XTEWalletSync" about every
//    15 minutes (battery not low, optionally Wi-Fi/charging only). An optional
//    foreground service ("XTEWalletRestore") keeps a long restore going while
//    the app is in the background.
//  - iOS: react-native-background-fetch (BGAppRefresh) plus a BGProcessing task
//    (com.transistorsoft.xtesync) for longer runs.
//
// When the full wallet is already loaded in this process it is synced as
// before. Otherwise (cold headless start) only a view-only copy of the wallet
// is synced: it is built from the address and the private view key, never
// the spend key or the main wallet file. It finds incoming payments for the
// notifications, and it never touches the main wallet's sync loop or the
// auto-lock.

import BackgroundFetch from 'react-native-background-fetch';

import { AppState, Platform, NativeModules } from 'react-native';

import AsyncStorage from '@react-native-community/async-storage';

import PushNotificationIOS from '@react-native-community/push-notification-ios';

import { WalletBackend, LogLevel } from 'traaittcash-wallet-backend';

import PushNotification from 'react-native-push-notification';

import NetInfo from '@react-native-community/netinfo';

import Config from './Config';

import { Globals } from './Globals';

import { processBlockOutputs } from './NativeCode';

import {
    saveToDatabase, haveWallet, openDB, loadPreferencesFromDatabase,
} from './Database';

import { sealWalletData, unsealWalletData } from './Security';

const Native = NativeModules.XTEBackground;

export const IOS_PROCESSING_TASK = 'com.transistorsoft.xtesync';

/* Start the restore service when the wallet is this many blocks behind. */
const RESTORE_SERVICE_THRESHOLD = 5000;

const KEY = (name) => `${Config.coinName}BgSync.${name}`;

const KEYS = {
    enabled: KEY('enabled'),
    chargingOnly: KEY('chargingOnly'),
    restoreService: KEY('restoreService'),
    seed: KEY('viewSeed'),
    viewWallet: KEY('viewWallet'),
    notified: KEY('notified'),
};

export const DEFAULT_BACKGROUND_PREFS = {
    /* Same behaviour as before (background fetch was always on). */
    enabled: true,
    chargingOnly: false,
    /* The ongoing notification is visible, so the user opts in. */
    restoreService: false,
};

function log(msg) {
    if (Globals.logger) {
        Globals.logger.addLogMessage(`[Background Sync] ${msg}`);
    }
}

/* ---------- preferences ---------- */

export async function loadBackgroundPrefs() {
    const prefs = { ...DEFAULT_BACKGROUND_PREFS };
    try {
        const values = await AsyncStorage.multiGet([KEYS.enabled, KEYS.chargingOnly, KEYS.restoreService]);
        for (const [key, value] of values) {
            if (value === null || value === undefined) {
                continue;
            }
            const name = Object.keys(KEYS).find((k) => KEYS[k] === key);
            prefs[name] = value === 'true';
        }
    } catch (err) {
        /* defaults */
    }
    Globals.backgroundPrefs = prefs;
    return prefs;
}

export async function setBackgroundPref(name, value) {
    await AsyncStorage.setItem(KEYS[name], value ? 'true' : 'false');
    const prefs = await loadBackgroundPrefs();
    await initBackgroundSync(prefs);
    if (name === 'enabled' && !value) {
        await clearBackgroundWallet();
    }
    return prefs;
}

/* ---------- view-only copy ---------- */

/** Remembers address, view key and height of the loaded wallet for headless runs. */
export async function rememberWalletForBackground(wallet) {
    try {
        const prefs = Globals.backgroundPrefs || await loadBackgroundPrefs();
        if (!prefs.enabled || !wallet) {
            return;
        }
        const [walletHeight] = wallet.getSyncStatus();
        const seed = {
            address: wallet.getPrimaryAddress(),
            viewKey: wallet.getPrivateViewKey(),
            height: walletHeight,
        };
        await AsyncStorage.setItem(KEYS.seed, await sealWalletData(JSON.stringify(seed)));
    } catch (err) {
        log('Could not store the view key: ' + err);
    }
}

export async function clearBackgroundWallet() {
    await AsyncStorage.multiRemove([KEYS.seed, KEYS.viewWallet, KEYS.notified]);
}

async function loadSeed() {
    const raw = await AsyncStorage.getItem(KEYS.seed);
    if (!raw) {
        return undefined;
    }
    return JSON.parse(await unsealWalletData(raw));
}

/* ---------- notifications ---------- */

let notifiedCache;

/** True the first time it is called for a transaction hash (persisted). */
export async function claimNotification(hash) {
    if (notifiedCache === undefined) {
        try {
            notifiedCache = JSON.parse(await AsyncStorage.getItem(KEYS.notified)) || [];
        } catch (err) {
            notifiedCache = [];
        }
    }
    if (notifiedCache.includes(hash)) {
        return false;
    }
    notifiedCache = [hash, ...notifiedCache].slice(0, 200);
    await AsyncStorage.setItem(KEYS.notified, JSON.stringify(notifiedCache));
    return true;
}

function configurePushNotifications() {
    PushNotification.configure({
        onNotification: (notification) => {
            notification.finish(PushNotificationIOS.FetchResult.NoData);
        },
        permissions: { alert: true, badge: true, sound: true },
        popInitialNotification: true,
        requestPermissions: true,
    });
}

/* ---------- scheduling ---------- */

export async function initBackgroundSync(prefsIn) {
    const prefs = prefsIn || await loadBackgroundPrefs();
    const limitData = !!(Globals.preferences && Globals.preferences.limitData);

    if (Platform.OS === 'android') {
        /* Older versions scheduled react-native-background-fetch jobs. */
        try {
            BackgroundFetch.stop();
        } catch (err) {
            /* not configured */
        }
        if (!Native) {
            return;
        }
        try {
            if (prefs.enabled) {
                await Native.schedulePeriodic(limitData, prefs.chargingOnly);
            } else {
                await Native.cancelPeriodic();
            }
        } catch (err) {
            log('WorkManager scheduling failed: ' + err);
        }
        return;
    }

    if (!prefs.enabled) {
        BackgroundFetch.stop();
        return;
    }

    const network = limitData ? BackgroundFetch.NETWORK_TYPE_UNMETERED : BackgroundFetch.NETWORK_TYPE_ANY;

    BackgroundFetch.configure({
        minimumFetchInterval: 15, // <-- minutes (15 is minimum allowed)
        stopOnTerminate: false,
        startOnBoot: true,
        forceReload: false,
        enableHeadless: true,
        requiredNetworkType: network,
        requiresCharging: prefs.chargingOnly,
    }, async (taskId) => {
        try {
            await backgroundSync(taskId === IOS_PROCESSING_TASK ? 'processing' : 'fetch');
        } finally {
            BackgroundFetch.finish(taskId);
        }
    }, (error) => {
        log('RNBackgroundFetch failed to start: ' + error);
    });

    BackgroundFetch.scheduleTask({
        taskId: IOS_PROCESSING_TASK,
        delay: 30 * 60 * 1000,
        periodic: true,
        stopOnTerminate: false,
        requiredNetworkType: network,
        requiresCharging: prefs.chargingOnly,
    }).catch((err) => log('BGProcessing schedule failed: ' + err));
}

/* ---------- running ---------- */

const RUN_BUDGET_SECONDS = {
    fetch: 25, // iOS BGAppRefresh: ~30 s
    processing: 4 * 60, // iOS BGProcessing: minutes, may be expired early
    worker: 8 * 60, // Android WorkManager: 10 min hard limit
};

let State = {
    shouldStop: false,
    running: false,
    unsubscribe: () => {},
};

function onStateChange(state) {
    if (state !== 'background') {
        State.shouldStop = true;
    }
}

function handleNetInfoChange({ type }) {
    if (Globals.preferences && Globals.preferences.limitData && type === 'cellular') {
        log('Network changed to cellular and data is limited. Stopping.');
        State.shouldStop = true;
    }
}

async function ensurePreferences() {
    if (Globals.preferencesLoadedForBackground || Globals.wallet !== undefined) {
        return;
    }
    await openDB();
    const prefs = await loadPreferencesFromDatabase();
    if (prefs !== undefined) {
        Globals.preferences = prefs;
    }
    Globals.preferencesLoadedForBackground = true;
}

/**
 * Entry point for every background wake-up.
 * @param kind 'fetch' | 'processing' | 'worker'
 */
export async function backgroundSync(kind = 'fetch') {
    if (State.running) {
        log('Already running. Not starting.');
        return;
    }
    if (AppState.currentState === 'active') {
        log('Launched while in foreground. Not starting.');
        return;
    }

    State.running = true;
    State.shouldStop = false;

    try {
        const prefs = await loadBackgroundPrefs();
        if (!prefs.enabled) {
            return;
        }

        if (Globals.wallet === undefined && !await haveWallet()) {
            return;
        }

        await ensurePreferences();

        const netInfo = await NetInfo.fetch();
        if (Globals.preferences.limitData && netInfo.type === 'cellular') {
            log('On mobile data. Not starting.');
            return;
        }

        State.unsubscribe = NetInfo.addEventListener(handleNetInfoChange);
        AppState.addEventListener('change', onStateChange);

        const budget = RUN_BUDGET_SECONDS[kind] || RUN_BUDGET_SECONDS.fetch;

        if (Globals.wallet !== undefined) {
            await syncLoadedWallet(budget);
        } else {
            await syncViewWallet(budget);
        }
    } catch (err) {
        log('Failed: ' + err);
    } finally {
        AppState.removeEventListener('change', onStateChange);
        State.unsubscribe();
        State.unsubscribe = () => {};
        State.running = false;
        log('Background sync complete.');
    }
}

/** Android WorkManager headless task. */
export async function headlessWalletSync() {
    await backgroundSync('worker');
}

async function runSyncLoop(wallet, budgetSeconds, save) {
    const startTime = Date.now();

    while (!State.shouldStop && (Date.now() - startTime) / 1000 < budgetSeconds) {
        await wallet.internal().updateDaemonInfo();

        const [walletBlockCount, localDaemonBlockCount, networkBlockCount] = wallet.getSyncStatus();

        /* Synced, don't drain the battery */
        if (walletBlockCount >= localDaemonBlockCount || walletBlockCount >= networkBlockCount) {
            log('Wallet is synced.');
            break;
        }

        /* Process up to ~1000 blocks per round (one gateway request) */
        let progressed = false;
        for (let i = 0; i < Math.ceil(1000 / Config.blocksPerTick); i++) {
            if (State.shouldStop) {
                break;
            }
            const syncedBlocks = await wallet.internal().sync(false);
            if (!syncedBlocks) {
                break;
            }
            progressed = true;
        }

        await save();

        if (!progressed) {
            /* Node problem or nothing new; try again next wake-up. */
            break;
        }
    }
}

async function syncLoadedWallet(budgetSeconds) {
    log('Syncing the loaded wallet...');
    /* Shares the lock with pull-to-refresh, so neither cancels the other. */
    const { runExclusive } = require('./SyncNow');
    await runExclusive(() => runSyncLoop(Globals.wallet, budgetSeconds, () => saveToDatabase(Globals.wallet)));
}

async function syncViewWallet(budgetSeconds) {
    let seed;
    try {
        seed = await loadSeed();
    } catch (err) {
        log('View key is not readable in the background: ' + err);
        return;
    }
    if (!seed || !seed.address || !seed.viewKey) {
        log('No view key stored yet. Open the wallet once to enable background sync.');
        return;
    }

    const daemon = Globals.getDaemon();
    let wallet;

    try {
        const stored = await AsyncStorage.getItem(KEYS.viewWallet);
        if (stored) {
            const [loaded, err] = WalletBackend.loadWalletFromJSON(daemon, await unsealWalletData(stored), Config);
            if (!err && loaded.getPrimaryAddress() === seed.address && loaded.getSyncStatus()[0] + 100 >= seed.height) {
                wallet = loaded;
            }
        }
    } catch (err) {
        wallet = undefined;
    }

    if (wallet === undefined) {
        const [created, err] = WalletBackend.importViewWallet(daemon, seed.height, seed.viewKey, seed.address, Config);
        if (err) {
            log('Could not create the view-only wallet: ' + err);
            return;
        }
        wallet = created;
    }

    configurePushNotifications();

    wallet.scanCoinbaseTransactions(Globals.preferences.scanCoinbaseTransactions);
    wallet.setBlockOutputProcessFunc(processBlockOutputs);
    wallet.setLoggerCallback((prettyMessage, message) => log(message));
    wallet.setLogLevel(LogLevel.DEBUG);

    wallet.on('incomingtx', (transaction) => {
        /* Older payments are already known to the main wallet. */
        if (transaction.blockHeight > seed.height) {
            notifyIncoming(transaction);
        }
    });

    log(`Syncing the view-only copy from ${wallet.getSyncStatus()[0]}...`);

    await runSyncLoop(wallet, budgetSeconds, async () => {
        await AsyncStorage.setItem(KEYS.viewWallet, await sealWalletData(wallet.toJSONString()));
    });

    try {
        await wallet.stop();
    } catch (err) {
        /* never started */
    }
}

/* Lazy require: MainScreen imports this module. */
function notifyIncoming(transaction) {
    /* Widgets / tile / watch show it until the main wallet counts it. */
    require('./Platform').notePendingIncoming(transaction.totalAmount());
    const { sendNotification } = require('./MainScreen');
    sendNotification(transaction);
}

/* ---------- Android restore service ---------- */

let restoreRunning = false;

/** Starts the foreground service when the user enabled it and the wallet is far behind. */
export async function maybeStartRestoreService() {
    if (Platform.OS !== 'android' || !Native || restoreRunning || Globals.wallet === undefined) {
        return;
    }
    const prefs = Globals.backgroundPrefs || await loadBackgroundPrefs();
    if (!prefs.enabled || !prefs.restoreService) {
        return;
    }
    const [walletHeight, , networkHeight] = Globals.wallet.getSyncStatus();
    if (networkHeight - walletHeight < RESTORE_SERVICE_THRESHOLD) {
        return;
    }
    try {
        /* Must start while the app is visible (Android 12+). */
        await Native.startRestoreService(restoreText());
        restoreRunning = true;
    } catch (err) {
        log('Restore service not started: ' + err);
    }
}

function restoreText() {
    if (Globals.wallet === undefined) {
        return 'Syncing wallet...';
    }
    const [walletHeight, , networkHeight] = Globals.wallet.getSyncStatus();
    const pct = networkHeight > 0 ? Math.min(100, (walletHeight / networkHeight) * 100) : 0;
    return `Syncing wallet: ${pct.toFixed(1)}% (${walletHeight} / ${networkHeight})`;
}

/**
 * Headless task bound to the foreground service. The wallet keeps syncing on
 * its own timers; this only keeps the process alive, updates the progress
 * notification and stops the service when synced.
 */
export async function restoreServiceTask() {
    restoreRunning = true;
    try {
        while (restoreRunning && Globals.wallet !== undefined) {
            await new Promise((resolve) => setTimeout(resolve, 10000));
            if (!restoreRunning || Globals.wallet === undefined) {
                break;
            }
            const [walletHeight, localHeight, networkHeight] = Globals.wallet.getSyncStatus();
            if (walletHeight >= localHeight || walletHeight >= networkHeight) {
                await saveToDatabase(Globals.wallet);
                break;
            }
            if (Native.updateRestoreProgress) {
                Native.updateRestoreProgress(restoreText(), walletHeight, networkHeight);
            } else {
                Native.updateRestoreService(restoreText());
            }
        }
    } finally {
        restoreRunning = false;
        if (Native) {
            Native.stopRestoreService();
        }
    }
}

export function stopRestoreService() {
    if (Platform.OS === 'android' && Native && restoreRunning) {
        Native.stopRestoreService();
        restoreRunning = false;
    }
}
