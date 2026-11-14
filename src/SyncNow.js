// Copyright (c) 2026, TRRXITTE Int., incorporate.
//
// Please see the included LICENSE file for more information.
//
// Pull-to-refresh sync. One sync at a time: a second pull (or a pull while the
// background sync runs) joins the running one instead of cancelling it.
//
//  - The wallet's own sync thread running: refresh the node height now and wait
//    until the wallet catches up (or stops making progress). Running a second
//    processBlocks() next to it would process the same stored blocks twice.
//  - Sync thread stopped (e.g. "limit data" on cellular): sync here directly,
//    gateway first (Daemon.getWalletSyncData is wrapped by attachGateway, which
//    falls back to REST /getwalletsyncdata by itself).

import Config from './Config';

import { Globals } from './Globals';

let inflight;

const MAX_SECONDS = 45;
const STALL_SECONDS = 10;

function log(msg) {
    if (Globals.logger) {
        Globals.logger.addLogMessage(`[sync now] ${msg}`);
    }
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSynced(wallet) {
    const [walletHeight, localHeight, networkHeight] = wallet.getSyncStatus();
    const target = Math.max(localHeight, networkHeight);
    return target > 0 && walletHeight + 1 >= target;
}

/** Runs fn exclusively; callers arriving while it runs get the same promise. */
export function runExclusive(fn) {
    if (inflight) {
        return inflight;
    }
    inflight = (async () => {
        try {
            return await fn();
        } finally {
            inflight = undefined;
        }
    })();
    return inflight;
}

export function syncInProgress() {
    return inflight !== undefined;
}

async function syncOnce() {
    const wallet = Globals.wallet;
    if (!wallet) {
        return { synced: false, blocks: 0 };
    }
    const internal = wallet.internal();
    const start = Date.now();
    const startHeight = wallet.getSyncStatus()[0];

    try {
        /* Fresh node / network height right now instead of at the next 10 s tick. */
        await internal.updateDaemonInfo();
    } catch (err) {
        log(`node info failed: ${err}`);
    }

    const threadRunning = !!(internal.syncThread && internal.syncThread.started && !internal.syncThread.shouldStop);

    if (!threadRunning) {
        /* Nobody else is syncing this wallet: do it here. */
        while (!isSynced(wallet) && (Date.now() - start) / 1000 < MAX_SECONDS) {
            const progressed = await internal.sync(false);
            if (!progressed) {
                break;
            }
        }
    } else {
        /* Join the running sync: wait for it to catch up or stall. */
        let lastHeight = wallet.getSyncStatus()[0];
        let lastProgress = Date.now();
        while (!isSynced(wallet) && (Date.now() - start) / 1000 < MAX_SECONDS) {
            await delay(400);
            const height = wallet.getSyncStatus()[0];
            if (height !== lastHeight) {
                lastHeight = height;
                lastProgress = Date.now();
            } else if ((Date.now() - lastProgress) / 1000 > STALL_SECONDS) {
                break;
            }
        }
    }

    const endHeight = wallet.getSyncStatus()[0];
    const synced = isSynced(wallet);
    log(`${endHeight - startHeight} blocks in ${Math.round((Date.now() - start) / 100) / 10}s, ${synced ? 'synced' : 'not synced yet'} (${Config.ticker})`);

    if (endHeight !== startHeight) {
        try {
            const { saveToDatabase } = require('./Database');
            await saveToDatabase(wallet);
        } catch (err) {
            /* saved again by the regular timer */
        }
    }
    return { synced, blocks: endHeight - startHeight };
}

/** Immediate sync for pull-to-refresh. Never throws; joins a running pull. */
export function syncNow() {
    return runExclusive(async () => {
        try {
            return await syncOnce();
        } catch (err) {
            log(`failed: ${err}`);
            return { synced: false, blocks: 0, error: err };
        }
    });
}
