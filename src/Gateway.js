// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
//
// Fast sync path through xte-rpc-gateway (XTEfoundation/xte-rpc-gateway): an
// Ethereum-style JSON-RPC 2.0 API at https://<node host>/rpc/<coin>. Its
// <coin>_syncBlocks returns up to 1000 cached blocks per call. The wallet checks
// GET /rpc/<coin>/health first and keeps using the daemon's REST API
// (/getwalletsyncdata) when the node has no gateway or a gateway call fails.

import { Block } from 'traaittcash-wallet-backend/dist/lib/Types';

export const GATEWAY_NAME = 'xte-rpc-gateway';
export const GATEWAY_API_VERSION = 1;

const RECHECK_AVAILABLE_MS = 30 * 60 * 1000;
/* A gateway that failed is retried soon: one slow answer on a mobile link must
 * not push the wallet onto the (much slower) REST path for long. */
const RETRY_UNAVAILABLE_MS = 2 * 60 * 1000;
/* Consecutive transport failures before the gateway is skipped for RETRY_UNAVAILABLE_MS. */
const FAILURES_BEFORE_DISABLE = 2;
/* Cold 1000-block ranges with coinbase take 10-15 s on the server, more on mobile data. */
export const SYNC_TIMEOUT_MS = 90 * 1000;

/* url -> { ok: bool, at: ms } */
const registry = new Map();
const inFlight = new Map();
/* url -> consecutive transport failures */
const failures = new Map();

/** https://host[:port]/rpc/<namespace>; any proxy path in the host ("host/xtcash") is dropped. */
export function gatewayURL(host, port, ssl, namespace) {
    const bareHost = String(host || '').split('/')[0];
    const defaultPort = ssl ? 443 : 80;
    const portPart = Number(port) === defaultPort ? '' : `:${port}`;
    return `${ssl ? 'https' : 'http'}://${bareHost}${portPart}/rpc/${namespace}`;
}

export function isUsableHealth(health, namespace) {
    return !!health
        && health.gateway === GATEWAY_NAME
        && health.coin === namespace
        && health.apiVersion === GATEWAY_API_VERSION
        && health.status === 'ok';
}

/**
 * True when the wallet only knows a creation timestamp (fresh wallet, no block
 * scanned yet). The gateway cannot resolve timestamps: such a request hangs
 * ~30 s and ends with -32000 "daemon read failed". These go to REST once; the
 * next call has a checkpoint and uses the gateway.
 */
export function isTimestampOnlyRequest(blockHashCheckpoints, startHeight, startTimestamp) {
    return !!startTimestamp && !startHeight && !(blockHashCheckpoints && blockHashCheckpoints.length > 0);
}

export function buildSyncRequest(namespace, blockHashCheckpoints, startHeight, startTimestamp, blockCount, skipCoinbase) {
    const params = {
        startHeight: startHeight || 0,
        blockCount,
        skipCoinbase: !!skipCoinbase,
    };
    if (blockHashCheckpoints && blockHashCheckpoints.length > 0) {
        params.checkpoints = blockHashCheckpoints;
    }
    /* startTimestamp is never sent: the gateway answers it with -32000 after a 30 s hang. */
    return { jsonrpc: '2.0', id: 1, method: `${namespace}_syncBlocks`, params: [params] };
}

/** Maps a syncBlocks result to what Daemon.getWalletSyncData returns: [blocks, topBlock|true]. */
export function parseSyncResponse(json) {
    if (!json || json.error) {
        const e = json && json.error ? json.error : { code: 0, message: 'empty response' };
        const err = new Error(`Gateway error ${e.code}: ${e.message}`);
        /* The gateway answered: it is up, only this request failed. */
        err.gatewayRpcError = true;
        throw err;
    }
    const r = json.result;
    if (!r || !Array.isArray(r.items)) {
        throw new Error('Unexpected gateway response');
    }
    const blocks = r.items.map(Block.fromJSON);
    if (r.synced && r.topBlock && r.topBlock.height && r.topBlock.hash) {
        return [blocks, r.topBlock];
    }
    return [blocks, true];
}

async function fetchWithTimeout(fetchFn, url, options, timeoutMs) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timer = setTimeout(() => controller && controller.abort(), timeoutMs);
    try {
        return await fetchFn(url, { ...options, signal: controller ? controller.signal : undefined });
    } finally {
        clearTimeout(timer);
    }
}

export async function probeGateway(url, namespace, fetchFn = fetch) {
    try {
        const res = await fetchWithTimeout(fetchFn, `${url}/health`, { method: 'GET', headers: { Accept: 'application/json' } }, 8000);
        if (!res || res.status !== 200) {
            return false;
        }
        return isUsableHealth(await res.json(), namespace);
    } catch (e) {
        return false;
    }
}

export async function gatewayAvailable(url, namespace, fetchFn = fetch, now = Date.now()) {
    const entry = registry.get(url);
    if (entry) {
        if (entry.ok && now - entry.at < RECHECK_AVAILABLE_MS) {
            return true;
        }
        if (!entry.ok && now - entry.at < RETRY_UNAVAILABLE_MS) {
            return false;
        }
    }
    if (inFlight.has(url)) {
        return inFlight.get(url);
    }
    const p = probeGateway(url, namespace, fetchFn).then((ok) => {
        registry.set(url, { ok, at: Date.now() });
        inFlight.delete(url);
        return ok;
    });
    inFlight.set(url, p);
    return p;
}

/** Transport/HTTP failure. Disables the gateway briefly after repeated failures. */
export function markGatewayFailed(url, now = Date.now()) {
    const n = (failures.get(url) || 0) + 1;
    failures.set(url, n);
    if (n >= FAILURES_BEFORE_DISABLE) {
        registry.set(url, { ok: false, at: now });
        failures.set(url, 0);
    }
}

export function markGatewaySucceeded(url, now = Date.now()) {
    failures.set(url, 0);
    registry.set(url, { ok: true, at: now });
}

export function isGatewayActive(url) {
    const entry = registry.get(url);
    return !!(entry && entry.ok);
}

export function resetGatewayRegistry() {
    registry.clear();
    inFlight.clear();
    failures.clear();
}

/**
 * Wraps daemon.getWalletSyncData with the gateway fast path. Falls back to the
 * original REST call for this one request when the gateway fails; only repeated
 * transport failures disable the gateway, and only for RETRY_UNAVAILABLE_MS.
 */
export function attachGateway(daemon, { host, port, ssl, namespace, blockCount = 1000, fetchFn, logger } = {}) {
    const url = gatewayURL(host, port, ssl, namespace);
    const rest = daemon.getWalletSyncData.bind(daemon);
    const doFetch = fetchFn || ((...args) => fetch(...args));

    daemon.gatewayURL = url;

    daemon.getWalletSyncData = async function getWalletSyncDataFast(blockHashCheckpoints, startHeight, startTimestamp, restBlockCount) {
        if (isTimestampOnlyRequest(blockHashCheckpoints, startHeight, startTimestamp)) {
            return rest(blockHashCheckpoints, startHeight, startTimestamp, restBlockCount);
        }
        if (await gatewayAvailable(url, namespace, doFetch)) {
            try {
                const skipCoinbase = !(daemon.config && daemon.config.scanCoinbaseTransactions);
                const body = buildSyncRequest(namespace, blockHashCheckpoints, startHeight, startTimestamp, blockCount, skipCoinbase);
                const res = await fetchWithTimeout(doFetch, url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify(body),
                }, SYNC_TIMEOUT_MS);
                if (!res || res.status !== 200) {
                    throw new Error(`Gateway HTTP ${res ? res.status : 'error'}`);
                }
                const result = parseSyncResponse(await res.json());
                markGatewaySucceeded(url);
                /* Same bookkeeping as the REST path: the node is alive. */
                daemon.lastUpdatedNetworkHeight = new Date();
                daemon.lastUpdatedLocalHeight = new Date();
                return result;
            } catch (err) {
                if (!err.gatewayRpcError) {
                    markGatewayFailed(url);
                }
                if (logger) {
                    logger(`[gateway] ${err.toString()} - using REST sync`);
                }
            }
        }
        return rest(blockHashCheckpoints, startHeight, startTimestamp, restBlockCount);
    };

    return daemon;
}
