// Copyright (c) 2026, TRRXITTE Int., incorporate.
//
// Please see the included LICENSE file for more information.
//
// Platform features. Android native side: XTEPlatformModule and friends; iOS native side:
// ios/XTE/Platform/XTEPlatform.swift (WidgetKit snapshot, Live Activities, Face ID, Home
// Screen quick actions, Handoff, payment notification actions, Apple Watch bridge).
// Android:
//  - home-screen widgets (balance + last payment, receive QR), Quick Settings tile and the
//    Wear OS copy, all from a public snapshot (address, balance text, last payment; no keys)
//  - internal deep links <ticker>wallet://wallet|receive|send|transactions|addressbook used
//    by widgets, the tile, static/dynamic shortcuts, Assistant App Actions and notifications
//  - rich payment notifications with actions, outgoing-transaction progress notifications
//  - BiometricPrompt for the address book and sending
//  - Material You colours, per-app language

import { NativeModules, Platform as RNPlatform, Dimensions, Share } from 'react-native';

import AsyncStorage from '@react-native-community/async-storage';

import { prettyPrintAmount } from 'traaittcash-wallet-backend';

import Config from './Config';

import { Globals } from './Globals';

const Native = NativeModules.XTEPlatform;

const ANDROID = RNPlatform.OS === 'android';
const IOS = RNPlatform.OS === 'ios';

export const ROUTE_SCHEME = `${Config.ticker.toLowerCase()}wallet://`;

const PREF_KEY = `${Config.coinName}PlatformPrefs`;

export const DEFAULT_PLATFORM_PREFS = {
    /* BiometricPrompt (or screen lock) before opening the address book */
    protectAddressBook: true,
    /* BiometricPrompt (or screen lock) before a transaction is sent */
    biometricSend: true,
    /* Material You (wallpaper) colours on Android 12+ */
    dynamicColor: false,
    /* Show "•••" instead of the balance in widgets, the tile and on the watch */
    hideBalanceInWidgets: false,
};

export async function loadPlatformPrefs() {
    let prefs = { ...DEFAULT_PLATFORM_PREFS };
    try {
        const raw = await AsyncStorage.getItem(PREF_KEY);
        if (raw) {
            prefs = { ...prefs, ...JSON.parse(raw) };
        }
    } catch (err) {
        /* defaults */
    }
    Globals.platformPrefs = prefs;
    return prefs;
}

export async function setPlatformPref(name, value) {
    const prefs = { ...(Globals.platformPrefs || await loadPlatformPrefs()), [name]: value };
    Globals.platformPrefs = prefs;
    await AsyncStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    if (name === 'hideBalanceInWidgets') {
        publishWidgetData(true);
    }
    if (name === 'dynamicColor' && Globals.updateTheme) {
        Globals.updateTheme();
    }
    return prefs;
}

function platformPrefs() {
    return Globals.platformPrefs || DEFAULT_PLATFORM_PREFS;
}

/* ---------- widgets / tile / watch ---------- */

let lastPublished = '';
let lastPublishTime = 0;

/** Writes the public snapshot. Cheap; call after balance or height changes. */
export function publishWidgetData(force = false) {
    if (!Native || !Globals.wallet) {
        return;
    }
    try {
        const [unlocked, locked] = Globals.wallet.getBalance();
        const [walletHeight, , networkHeight] = Globals.wallet.getSyncStatus();
        const [last] = Globals.wallet.getTransactions(0, 1, false);
        const data = {
            address: Globals.wallet.getPrimaryAddress(),
            balanceText: prettyPrintAmount(unlocked + locked, Config),
            lockedText: locked > 0 ? prettyPrintAmount(locked, Config) : '',
            lastPaymentText: last ? `${last.totalAmount() >= 0 ? '+' : ''}${prettyPrintAmount(last.totalAmount(), Config)}` : '',
            lastPaymentIncoming: last ? last.totalAmount() >= 0 : true,
            lastPaymentTime: last && last.timestamp ? last.timestamp * 1000 : Date.now(),
            walletHeight,
            networkHeight,
            hideBalance: !!platformPrefs().hideBalanceInWidgets,
        };
        updateSyncActivity(walletHeight, networkHeight);
        const key = JSON.stringify({ ...data, walletHeight: Math.floor(walletHeight / 100) });
        /* Heights change every block; redraw at most every 2 minutes unless something else changed. */
        if (!force && key === lastPublished && Date.now() - lastPublishTime < 2 * 60 * 1000) {
            return;
        }
        lastPublished = key;
        lastPublishTime = Date.now();
        Native.updateWidgetData(JSON.stringify(data)).catch(() => {});
    } catch (err) {
        /* wallet not ready */
    }
}

let lastSyncActivity = 0;

/** iOS: Live Activity / Dynamic Island while a long catch-up runs (native side decides when). */
function updateSyncActivity(walletHeight, networkHeight) {
    if (!IOS || !Native || !Native.updateSyncActivity) {
        return;
    }
    const done = networkHeight > 0 && walletHeight + 1 >= networkHeight;
    if (!done && Date.now() - lastSyncActivity < 5000) {
        return;
    }
    lastSyncActivity = Date.now();
    Native.updateSyncActivity(walletHeight, networkHeight);
}

export function clearWidgetData() {
    if (Native) {
        Native.clearWidgetData();
    }
}

/** From the view-only background sync: show the payment in widgets before the wallet counts it. */
export function notePendingIncoming(amountAtomic) {
    if (Native) {
        Native.notePendingIncoming(prettyPrintAmount(amountAtomic, Config));
    }
}

export function requestPinWidget(which) {
    return Native && ANDROID ? Native.requestPinWidget(which).catch(() => false) : Promise.resolve(false);
}

/* ---------- shortcuts ---------- */

/** "Pay <contact>" launcher shortcuts for the first address-book entries. */
export function updateDynamicShortcuts() {
    if (!Native) {
        return;
    }
    const payees = (Globals.payees || []).slice(0, 4).map((p) => {
        const q = p.paymentID ? `?paymentid=${p.paymentID}&name=${encodeURIComponent(p.nickname)}` : `?name=${encodeURIComponent(p.nickname)}`;
        return {
            id: p.nickname.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40),
            label: p.nickname.slice(0, 24),
            uri: `${Config.uriPrefix}${p.address}${q}`,
        };
    });
    Native.setDynamicShortcuts(JSON.stringify(payees)).catch(() => {});
}

/* ---------- deep links ---------- */

export function isInternalRoute(url) {
    return typeof url === 'string' && url.toLowerCase().startsWith(ROUTE_SCHEME);
}

const APP_LINK_PREFIX = `https://main.trrxitte.com/pay/${Config.ticker.toLowerCase()}/`;

/** Handles <ticker>wallet:// links and https App Links. Returns true when handled. */
export function handleRoute(url, navigation) {
    if (typeof url === 'string' && url.toLowerCase().startsWith(APP_LINK_PREFIX) && navigation) {
        const { handleURI } = require('./Utilities');
        handleURI(Config.uriPrefix + url.slice(APP_LINK_PREFIX.length), navigation);
        return true;
    }
    if (!isInternalRoute(url) || !navigation) {
        return false;
    }
    const rest = url.slice(ROUTE_SCHEME.length);
    const [host, query = ''] = rest.split('?');
    const params = {};
    for (const pair of query.split('&')) {
        if (!pair) continue;
        const [k, v = ''] = pair.split('=');
        params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    }
    if (Native && Native.reportShortcutUsed) {
        Native.reportShortcutUsed(host);
    }
    switch (host.replace(/\/$/, '').toLowerCase()) {
        case 'receive':
            navigation.navigate('Main', { showAddress: true });
            break;
        case 'send':
            if (params.to) {
                const { handleURI } = require('./Utilities');
                const uri = params.to.includes('://') ? params.to : `${Config.uriPrefix}${params.to}`;
                const amount = params.amount && !uri.includes('amount=')
                    ? `${uri.includes('?') ? '&' : '?'}amount=${Math.round(Number(params.amount) * Math.pow(10, Config.decimalPlaces))}`
                    : '';
                handleURI(uri + amount, navigation);
            } else {
                navigation.navigate('ChoosePayee');
            }
            break;
        case 'transactions':
            navigation.navigate('Transactions');
            break;
        case 'addressbook':
            navigation.navigate('Recipients');
            break;
        default:
            navigation.navigate('Main');
    }
    return true;
}

/* ---------- notifications ---------- */

/**
 * Payment notification with "Show transactions" / "Show receive QR" actions (Android channel,
 * iOS notification category); returns false when the caller should use its fallback.
 */
export function showPaymentNotification(transaction) {
    if (!Native || !Native.showPaymentNotification) {
        return false;
    }
    const amount = prettyPrintAmount(transaction.totalAmount(), Config);
    Native.showPaymentNotification(
        `${Config.ticker} received`,
        `You were sent ${amount}.`,
        transaction.hash,
    );
    return true;
}

const pendingSends = new Map();

/** Ongoing notification for a sent transaction until it has 3 confirmations. */
export function trackOutgoing(hash, amountAtomic) {
    if (!Native || !hash) {
        return;
    }
    const amountText = prettyPrintAmount(Math.abs(amountAtomic || 0), Config);
    pendingSends.set(hash, { amountText, since: Date.now() });
    Native.showSendProgress(hash, amountText, 'Broadcast, waiting for a block', 20, false);
}

export function updateOutgoing() {
    if (!Native || pendingSends.size === 0 || !Globals.wallet) {
        return;
    }
    const [, , networkHeight] = Globals.wallet.getSyncStatus();
    const txs = Globals.wallet.getTransactions(0, 20, false);
    for (const [hash, info] of pendingSends) {
        const tx = txs.find((t) => t.hash === hash);
        if (tx && tx.blockHeight > 0) {
            const confirmations = Math.max(0, networkHeight - tx.blockHeight);
            const done = confirmations >= 3;
            Native.showSendProgress(hash, info.amountText,
                done ? `Confirmed in block ${tx.blockHeight}` : `In block ${tx.blockHeight} · ${confirmations} confirmations`,
                done ? 100 : 50 + Math.round(50 * confirmations / 3), done);
            if (done) {
                pendingSends.delete(hash);
            }
        } else if (Date.now() - info.since > 60 * 60 * 1000) {
            /* Not mined after an hour: stop the ongoing notification, the transaction list shows the status. */
            Native.cancelSendProgress(hash);
            pendingSends.delete(hash);
        }
    }
}

/* ---------- BiometricPrompt ---------- */

/**
 * Asks for fingerprint / face or the screen lock. Resolves true when allowed
 * (also when the device has no secure lock screen), false when cancelled.
 */
export async function biometricAuth(title, subtitle = '') {
    if (!Native) {
        return true;
    }
    try {
        await Native.authenticate(title, subtitle || Config.appName);
        return true;
    } catch (err) {
        return false;
    }
}

export function addressBookNeedsAuth() {
    return !!(Native && platformPrefs().protectAddressBook);
}

export function sendNeedsBiometric() {
    return !!(Native && platformPrefs().biometricSend);
}

/* ---------- Material You ---------- */

let dynamicColors;

export async function loadDynamicColors() {
    if (!Native || !ANDROID) {
        return undefined;
    }
    try {
        dynamicColors = await Native.getDynamicColors();
    } catch (err) {
        dynamicColors = undefined;
    }
    return dynamicColors;
}

export function dynamicColorAvailable() {
    return !!dynamicColors;
}

/** The chosen theme with wallpaper accent colours applied (Android 12+, when enabled). */
export function applyDynamicColor(theme) {
    if (!theme || !dynamicColors || !platformPrefs().dynamicColor) {
        return theme;
    }
    const dark = Globals.preferences.theme !== 'lightMode';
    return {
        ...theme,
        primaryColour: dark ? dynamicColors.accent1_200 : dynamicColors.accent1_800,
        buttonThemeColour: dark ? dynamicColors.accent1_200 : dynamicColors.accent1_600,
        secondaryColour: dark ? dynamicColors.accent3_200 : dynamicColors.accent3_600,
        pinCodeBackgroundColour: dark ? dynamicColors.accent1_200 : dynamicColors.accent1_600,
        backgroundColour: dark ? dynamicColors.neutral1_900 : dynamicColors.neutral1_10,
        pinCodeForegroundColour: dark ? dynamicColors.neutral1_900 : dynamicColors.neutral1_10,
    };
}

/* ---------- per-app language ---------- */

export function openLanguageSettings() {
    if (Native && ANDROID) {
        Native.openLanguageSettings();
    }
}

/* ---------- launch routes, Handoff, sharing ---------- */

/**
 * iOS: a Home Screen quick action, notification action or Handoff that launched the app
 * before JS listened for links. Resolves the route URL or null (and clears it).
 */
export async function consumePendingRoute() {
    if (!IOS || !Native || !Native.consumePendingRoute) {
        return null;
    }
    try {
        return await Native.consumePendingRoute();
    } catch (err) {
        return null;
    }
}

/** iOS Handoff: continue "receive" (address / QR) on another device signed in to the same Apple ID. */
export function advertiseReceive(address) {
    if (IOS && Native && Native.setHandoff && address) {
        Native.setHandoff('receive', `${Config.uriPrefix}${address}`);
    }
}

/** System share sheet with the payment URI (both platforms). */
export function shareAddress(address) {
    if (!address) {
        return;
    }
    const uri = `${Config.uriPrefix}${address}`;
    Share.share(IOS ? { message: uri, url: uri } : { message: uri, title: `${Config.ticker} address` }).catch(() => {});
}

/* ---------- large screens ---------- */

/** Two panes on unfolded foldables and tablets (width >= 600 dp). */
export function isWideLayout(window = Dimensions.get('window')) {
    return window.width >= 600;
}

export async function initPlatform() {
    await loadPlatformPrefs();
    await loadDynamicColors();
}
