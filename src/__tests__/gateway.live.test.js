// Live check against the real node's xte-rpc-gateway with the real wallet backend.
// Opt-in: LIVE_GATEWAY=1 npx jest src/__tests__/gateway.live.test.js

import { attachGateway, isGatewayActive, resetGatewayRegistry } from '../Gateway';

const LIVE = process.env.LIVE_GATEWAY === '1';
const maybe = LIVE ? test : test.skip;

const NODE = { host: process.env.LIVE_NODE_HOST || 'main.trrxitte.com', port: 443, ssl: true };
const NAMESPACE = process.env.LIVE_NAMESPACE || 'xte';

jest.setTimeout(180000);

describe('live gateway', () => {
    beforeEach(() => resetGatewayRegistry());

    maybe('syncs 1000 blocks per call through the gateway and stays on it', async () => {
        const host = NAMESPACE === 'xtcash' ? `${NODE.host}/xtcash` : NODE.host;
        const restCalls = [];
        /* REST fallback (daemon /getwalletsyncdata) as the backend's Daemon does it. */
        const daemon = {
            config: { scanCoinbaseTransactions: false },
            getWalletSyncData: async (checkpoints, startHeight, startTimestamp, blockCount) => {
                restCalls.push(startTimestamp);
                const res = await fetch(`https://${host}/getwalletsyncdata`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ blockHashCheckpoints: checkpoints, startHeight, startTimestamp, blockCount, skipCoinbaseTransactions: false }),
                });
                const json = await res.json();
                return [json.items, json.synced ? json.topBlock : true];
            },
        };
        const logs = [];
        attachGateway(daemon, { host, port: NODE.port, ssl: NODE.ssl, namespace: NAMESPACE, blockCount: 1000, logger: (m) => logs.push(m) });
        const health = await (await fetch(`${daemon.gatewayURL}/health`)).json();
        const top = health.topHeight;
        const start = Math.max(0, Number(top) - 3000);
        const [blocks, synced] = await daemon.getWalletSyncData([], start, 0, 100);
        expect(logs).toEqual([]);
        expect(isGatewayActive(daemon.gatewayURL)).toBe(true);
        expect(blocks.length).toBe(1000);
        expect(blocks[0].blockHeight).toBe(start);
        expect(synced).toBe(true);
        expect(restCalls).toEqual([]);

        /* Fresh wallet (timestamp only) must not disable the gateway. */
        const started = Date.now();
        await daemon.getWalletSyncData([], 0, Math.floor(Date.now() / 1000) - 600, 100);
        expect(Date.now() - started).toBeLessThan(15000);
        expect(restCalls).toHaveLength(1);
        expect(isGatewayActive(daemon.gatewayURL)).toBe(true);
    });
});
