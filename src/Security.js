// Copyright (c) 2026, XTE Foundation
//
// Please see the included LICENSE file for more information.
//
// Optional security features (Settings > Security & Backup, and the
// "Secure your wallet" step after creating or restoring a wallet):
//  - hardware vault: the wallet file is encrypted with a key held in the
//    Secure Enclave (iOS) or Android Keystore StrongBox/TEE before it is
//    written to the database
//  - auto-lock after the app was in the background for a while
//  - PIN/biometric confirmation for sends (Globals.preferences.authConfirmation)
//  - screenshot / app switcher protection
//  - jailbreak / root warning
// Preferences live in AsyncStorage so no database migration is needed.

import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-community/async-storage';

import Config from './Config';

const Native = NativeModules.XTESecurity;

const PREFS_KEY = Config.coinName + 'SecurityPrefs';

export const VAULT_PREFIX = 'XTEVAULT1:';

export const AUTO_LOCK_CHOICES = [
    { seconds: 0, label: 'Immediately' },
    { seconds: 60, label: 'After 1 minute' },
    { seconds: 5 * 60, label: 'After 5 minutes' },
    { seconds: 15 * 60, label: 'After 15 minutes' },
    { seconds: -1, label: 'Never' },
];

const DEFAULTS = {
    /* Encrypt the wallet file with the hardware key */
    hardwareVault: false,
    /* Lock after this many seconds in the background, -1 = never */
    autoLockSeconds: -1,
    /* FLAG_SECURE on Android, blurred app switcher snapshot on iOS */
    screenProtection: false,
    /* The "Secure your wallet" step was shown */
    setupOffered: false,
    /* The user dismissed the jailbreak/root warning for these reasons */
    compromisedAcknowledged: '',
    /* Last successful encrypted backups (ISO dates), informational */
    lastCloudBackup: '',
    lastFileBackup: '',
};

let cached = { ...DEFAULTS };
let loaded = false;

export function securityAvailable() {
    return Native !== undefined && Native !== null;
}

export async function loadSecurityPrefs() {
    try {
        const raw = await AsyncStorage.getItem(PREFS_KEY);
        cached = { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
    } catch (err) {
        cached = { ...DEFAULTS };
    }

    loaded = true;
    return cached;
}

export function getSecurityPrefs() {
    return cached;
}

export async function updateSecurityPrefs(changes) {
    if (!loaded) {
        await loadSecurityPrefs();
    }

    cached = { ...cached, ...changes };
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(cached));

    if (changes.screenProtection !== undefined && securityAvailable()) {
        await Native.setScreenProtection(!!changes.screenProtection);
    }

    return cached;
}

/* ---------- hardware vault ---------- */

export async function vaultInfo() {
    if (!securityAvailable()) {
        return { level: 'Unavailable', hasStrongBox: false };
    }

    try {
        return await Native.vaultInfo();
    } catch (err) {
        return { level: 'Unavailable: ' + err.message, hasStrongBox: false };
    }
}

export async function sealWalletData(json) {
    if (!cached.hardwareVault || !securityAvailable()) {
        return json;
    }

    return VAULT_PREFIX + await Native.vaultEncrypt(json);
}

export function isSealed(data) {
    return typeof data === 'string' && data.startsWith(VAULT_PREFIX);
}

export async function unsealWalletData(data) {
    if (!isSealed(data)) {
        return data;
    }

    if (!securityAvailable()) {
        throw new Error('This wallet is encrypted with a hardware key, but the security module is missing.');
    }

    return Native.vaultDecrypt(data.slice(VAULT_PREFIX.length));
}

/* ---------- auto-lock ---------- */

let backgroundedAt = null;

export function noteAppState(state) {
    if (state === 'background') {
        if (backgroundedAt === null) {
            backgroundedAt = Date.now();
        }
        return false;
    }

    if (state !== 'active' || backgroundedAt === null) {
        return false;
    }

    const elapsed = (Date.now() - backgroundedAt) / 1000;
    backgroundedAt = null;

    return cached.autoLockSeconds >= 0 && elapsed >= cached.autoLockSeconds;
}

/* ---------- jailbreak / root ---------- */

export async function compromisedIndicators() {
    if (!securityAvailable()) {
        return [];
    }

    try {
        return await Native.compromisedIndicators();
    } catch (err) {
        return [];
    }
}

/* Returns reasons the user has not acknowledged yet, or [] */
export async function newCompromisedIndicators() {
    const reasons = await compromisedIndicators();
    const key = reasons.join('|');

    if (reasons.length === 0 || key === cached.compromisedAcknowledged) {
        return [];
    }

    return reasons;
}

export async function acknowledgeCompromised(reasons) {
    await updateSecurityPrefs({ compromisedAcknowledged: reasons.join('|') });
}

/* ---------- KDF used by Backup.js ---------- */

export async function nativePbkdf2(password, saltBase64, iterations, keyBytes) {
    if (!securityAvailable()) {
        return undefined;
    }

    return Native.pbkdf2Sha256(password, saltBase64, iterations, keyBytes);
}

export function platformName() {
    return Platform.OS === 'ios' ? 'iOS' : 'Android';
}
