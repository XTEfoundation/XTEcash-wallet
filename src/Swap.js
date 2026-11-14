// Copyright (c) 2026, XTE Foundation
//
// Please see the included LICENSE file for more information.
//
// "Swap XMR to XTE/XTCASH" through an external instant-swap service.
//
// Status (checked 2026-11-14): no instant-swap service lists XTE or XTCASH.
// ChangeNOW (1257 coins), Exolix, FixedFloat list XMR only; SimpleSwap,
// StealthEX, Trocador need a partner key; NonKYC lists XTE and XTCASH but
// both are inactive ("No longer supported"). So every provider below stays
// disabled until Config.swap has a provider with `enabled: true`, an API key
// (where the service needs one) and the service actually lists the coin.
//
// The swap service takes custody of the XMR between deposit and payout.

import Config from './Config';

const swapConfig = () => Config.swap || { providers: [] };

/* ChangeNOW v2 API (https://documenter.getpostman.com/view/8180765/SVfTPnM8) */
const changenow = {
    id: 'changenow',
    name: 'ChangeNOW',
    website: 'https://changenow.io',
    async quote(cfg, fromAmount) {
        const url = 'https://api.changenow.io/v2/exchange/estimated-amount'
            + `?fromCurrency=xmr&toCurrency=${cfg.toCurrency}&fromAmount=${encodeURIComponent(fromAmount)}`
            + '&flow=standard&type=direct';
        const res = await fetch(url, { headers: { 'x-changenow-api-key': cfg.apiKey } });
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || `Quote failed (${res.status})`);
        }

        return { toAmount: data.toAmount, validUntil: data.validUntil, rateId: data.rateId };
    },
    async create(cfg, fromAmount, address, refundAddress) {
        const res = await fetch('https://api.changenow.io/v2/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-changenow-api-key': cfg.apiKey },
            body: JSON.stringify({
                fromCurrency: 'xmr',
                toCurrency: cfg.toCurrency,
                fromAmount: String(fromAmount),
                address,
                refundAddress: refundAddress || undefined,
                flow: 'standard',
                type: 'direct',
            }),
        });
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || `Could not create the swap (${res.status})`);
        }

        return { id: data.id, depositAddress: data.payinAddress, toAmount: data.toAmount };
    },
    async status(cfg, id) {
        const res = await fetch(`https://api.changenow.io/v2/exchange/by-id?id=${encodeURIComponent(id)}`, {
            headers: { 'x-changenow-api-key': cfg.apiKey },
        });
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || `Status failed (${res.status})`);
        }

        return { status: data.status, payoutHash: data.payoutHash, amountTo: data.amountTo };
    },
};

const IMPLEMENTATIONS = { changenow };

/* Providers that could list the coin, for the "not available" explanation */
export const CANDIDATES = [
    { name: 'ChangeNOW', needs: 'Coin listing request + partner API key', url: 'https://changenow.io/listing' },
    { name: 'Exolix', needs: 'Coin listing request', url: 'https://exolix.com' },
    { name: 'StealthEX', needs: 'Coin listing request + partner API key', url: 'https://stealthex.io' },
    { name: 'SimpleSwap', needs: 'Coin listing request + partner API key', url: 'https://simpleswap.io' },
    { name: 'Trocador', needs: 'An integrated swap service that lists the coin + API key', url: 'https://trocador.app' },
    { name: 'NonKYC (exchange)', needs: 'Re-activate the XTE / XTCASH markets', url: 'https://nonkyc.io' },
];

export function activeSwapProvider() {
    for (const cfg of swapConfig().providers || []) {
        const impl = IMPLEMENTATIONS[cfg.id];

        if (impl && cfg.enabled && (cfg.apiKey || cfg.noKeyNeeded)) {
            return { impl, cfg };
        }
    }

    return null;
}

export const FINAL_STATES = ['finished', 'failed', 'refunded', 'expired'];
