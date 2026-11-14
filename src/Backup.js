// Copyright (c) 2026, XTE Foundation
//
// Please see the included LICENSE file for more information.
//
// Optional, password-encrypted wallet backups.
//
// Format (shared by the XTE/XTCASH phone and iPad wallets):
// {
//   "format": "traaitt-wallet-backup", "version": 1,
//   "coin": "XTCASH", "address": "cash...",
//   "kdf": { "name": "PBKDF2-HMAC-SHA256", "iterations": 310000, "salt": base64(16) },
//   "cipher": { "name": "AES-256-GCM", "iv": base64(12), "tag": base64(16) },
//   "data": base64(ciphertext)
// }
// AAD is "traaitt-wallet-backup:v1:<coin>:<address>", so a backup cannot be
// swapped between coins or addresses. The plaintext is JSON
// { spendKey, viewKey, scanHeight, createdAt }. The password never leaves the
// device and nothing unencrypted is ever stored or sent.
//
// Destinations:
//  - iOS: iCloud Keychain (synchronizable Keychain item, end-to-end encrypted
//    by Apple) via NativeModules.XTESecurity
//  - any platform: share sheet (Gmail, Google Drive, Files, ...) as text
//  - Google Drive appDataFolder: needs a Google OAuth client id
//    (Config.googleDriveBackup.clientId); hidden while it is empty

import { NativeModules, Platform, Share } from 'react-native';

import Config from './Config';
import { nativePbkdf2 } from './Security';

const crypto = require('crypto');

export const BACKUP_FORMAT = 'traaitt-wallet-backup';
export const BACKUP_VERSION = 1;
export const PBKDF2_ITERATIONS = 310000;
export const MIN_PASSWORD_LENGTH = 10;

function aad(coin, address) {
    return Buffer.from(`${BACKUP_FORMAT}:v${BACKUP_VERSION}:${coin}:${address}`, 'utf8');
}

async function deriveKey(password, salt, iterations) {
    const native = await nativePbkdf2(password, salt.toString('base64'), iterations, 32).catch(() => undefined);

    if (native) {
        return Buffer.from(native, 'base64');
    }

    return crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256');
}

export function passwordProblem(password, confirm) {
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
        return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }

    if (confirm !== undefined && password !== confirm) {
        return 'The passwords do not match.';
    }

    return undefined;
}

/**
 * Encrypts wallet keys. `secrets` = { spendKey, viewKey, scanHeight }.
 * `options.iterations`, `options.salt`, `options.iv` are only for tests.
 */
export async function encryptBackup({ coin, address, secrets }, password, options = {}) {
    const problem = passwordProblem(password);

    if (problem) {
        throw new Error(problem);
    }

    const iterations = options.iterations || PBKDF2_ITERATIONS;
    const salt = options.salt || crypto.randomBytes(16);
    const iv = options.iv || crypto.randomBytes(12);
    const key = await deriveKey(password, salt, iterations);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad(coin, address));

    const plaintext = Buffer.from(JSON.stringify({
        spendKey: secrets.spendKey,
        viewKey: secrets.viewKey,
        scanHeight: secrets.scanHeight || 0,
        createdAt: options.createdAt || new Date().toISOString(),
    }), 'utf8');

    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    return JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        coin,
        address,
        kdf: { name: 'PBKDF2-HMAC-SHA256', iterations, salt: salt.toString('base64') },
        cipher: { name: 'AES-256-GCM', iv: iv.toString('base64'), tag: tag.toString('base64') },
        data: data.toString('base64'),
    });
}

export function parseBackup(text) {
    let backup;

    try {
        backup = typeof text === 'string' ? JSON.parse(text.trim()) : text;
    } catch (err) {
        throw new Error('This is not a wallet backup.');
    }

    if (!backup || backup.format !== BACKUP_FORMAT) {
        throw new Error('This is not a wallet backup.');
    }

    if (backup.version !== BACKUP_VERSION) {
        throw new Error(`Unsupported backup version ${backup.version}.`);
    }

    if (backup.coin !== Config.coinName) {
        throw new Error(`This backup is for ${backup.coin}, not ${Config.coinName}.`);
    }

    return backup;
}

export async function decryptBackup(text, password) {
    const backup = parseBackup(text);

    if (backup.kdf.name !== 'PBKDF2-HMAC-SHA256' || backup.cipher.name !== 'AES-256-GCM') {
        throw new Error('Unsupported backup encryption.');
    }

    const key = await deriveKey(password, Buffer.from(backup.kdf.salt, 'base64'), backup.kdf.iterations);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(backup.cipher.iv, 'base64'));
    decipher.setAAD(aad(backup.coin, backup.address));
    decipher.setAuthTag(Buffer.from(backup.cipher.tag, 'base64'));

    let plaintext;

    try {
        plaintext = Buffer.concat([decipher.update(Buffer.from(backup.data, 'base64')), decipher.final()]);
    } catch (err) {
        throw new Error('Wrong password, or the backup was changed.');
    }

    const secrets = JSON.parse(plaintext.toString('utf8'));

    return { address: backup.address, ...secrets };
}

/* ---------- wallet helpers ---------- */

export function walletSecrets(wallet, approximateHeight) {
    const [spendKey, viewKey] = wallet.getPrimaryAddressPrivateKeys();
    let scanHeight = 0;

    try {
        const json = JSON.parse(wallet.toJSONString());
        const sub = json.subWallets.subWallet[0];

        if (sub.syncStartHeight) {
            scanHeight = sub.syncStartHeight;
        } else if (sub.syncStartTimestamp && approximateHeight) {
            scanHeight = approximateHeight(new Date(sub.syncStartTimestamp * 1000));
        }
    } catch (err) {
        scanHeight = 0;
    }

    return { spendKey, viewKey, scanHeight };
}

/* ---------- destinations ---------- */

const cloudAccount = () => `${Config.coinName}-wallet-backup`;

export async function cloudBackupAvailable() {
    const native = NativeModules.XTESecurity;

    if (Platform.OS !== 'ios' || !native) {
        return false;
    }

    return native.cloudKeychainAvailable();
}

export async function saveToCloud(encrypted) {
    await NativeModules.XTESecurity.cloudKeychainSet(cloudAccount(), encrypted);
}

export async function loadFromCloud() {
    if (!(await cloudBackupAvailable())) {
        return null;
    }

    return NativeModules.XTESecurity.cloudKeychainGet(cloudAccount());
}

export async function deleteFromCloud() {
    if (await cloudBackupAvailable()) {
        await NativeModules.XTESecurity.cloudKeychainDelete(cloudAccount());
    }
}

/* Share sheet: pick Gmail to mail it to yourself, or Google Drive / Files. */
export async function shareBackup(encrypted) {
    const title = `${Config.appName} encrypted wallet backup`;

    return Share.share({
        title,
        subject: title,
        message:
            `${title} (${new Date().toISOString().slice(0, 10)}).\n` +
            `Restore it in ${Config.appName}: Import wallet > Encrypted backup, then enter your backup password.\n` +
            'Without the password this file cannot be decrypted.\n\n' +
            encrypted,
    }, { subject: title, dialogTitle: 'Save encrypted backup' });
}

/* Pulls the JSON out of a pasted share message, or takes raw JSON */
export function extractBackupText(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');

    if (start === -1 || end <= start) {
        return text;
    }

    return text.slice(start, end + 1);
}

/* ---------- Google Drive appDataFolder (needs an OAuth client) ---------- */

export function googleDriveConfigured() {
    return !!(Config.googleDriveBackup && Config.googleDriveBackup.clientId);
}

/**
 * Uploads to the hidden per-app Drive folder with an OAuth access token
 * (scope https://www.googleapis.com/auth/drive.appdata). Getting the token
 * needs Google Sign-In with Config.googleDriveBackup.clientId.
 */
export async function uploadToGoogleDrive(encrypted, accessToken) {
    const boundary = 'xte' + crypto.randomBytes(8).toString('hex');
    const name = `${Config.coinName.toLowerCase()}-wallet-backup.json`;
    const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name, parents: ['appDataFolder'] }) +
        `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${encrypted}\r\n--${boundary}--`;

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
    });

    if (!res.ok) {
        throw new Error(`Google Drive upload failed (${res.status})`);
    }

    return res.json();
}
