import {
    gatewayURL, isUsableHealth, buildSyncRequest, parseSyncResponse,
    attachGateway, resetGatewayRegistry, isGatewayActive,
} from '../Gateway';

const hash = (n) => n.toString(16).padStart(64, '0');

const item = (h) => ({
    blockHash: hash(h + 1), blockHeight: h, blockTimestamp: 1700000000 + h,
    transactions: [],
});

function response(status, json) {
    return { status, json: async () => json };
}

describe('gateway helpers', () => {
    test('url drops proxy path and default port', () => {
        expect(gatewayURL('main.trrxitte.com', 443, true, 'xte')).toBe('https://main.trrxitte.com/rpc/xte');
        expect(gatewayURL('main.trrxitte.com/xtcash', 443, true, 'xtcash')).toBe('https://main.trrxitte.com/rpc/xtcash');
        expect(gatewayURL('10.0.0.1', 14485, false, 'xte')).toBe('http://10.0.0.1:14485/rpc/xte');
    });

    test('health check', () => {
        expect(isUsableHealth({ gateway: 'xte-rpc-gateway', coin: 'xte', apiVersion: 1, status: 'ok' }, 'xte')).toBe(true);
        expect(isUsableHealth({ gateway: 'xte-rpc-gateway', coin: 'xtcash', apiVersion: 1, status: 'ok' }, 'xte')).toBe(false);
        expect(isUsableHealth({ gateway: 'xte-rpc-gateway', coin: 'xte', apiVersion: 1, status: 'degraded' }, 'xte')).toBe(false);
        expect(isUsableHealth(undefined, 'xte')).toBe(false);
    });

    test('request body', () => {
        const b = buildSyncRequest('xte', [hash(5)], 0, 0, 1000, true);
        expect(b.method).toBe('xte_syncBlocks');
        expect(b.params[0]).toEqual({ startHeight: 0, blockCount: 1000, skipCoinbase: true, checkpoints: [hash(5)] });
    });

    test('response parsing', () => {
        const [blocks, top] = parseSyncResponse({ result: { items: [item(7), item(8)], synced: false } });
        expect(blocks.map((b) => b.blockHeight)).toEqual([7, 8]);
        expect(top).toBe(true);
        const [, synced] = parseSyncResponse({ result: { items: [], synced: true, topBlock: { height: 9, hash: hash(9) } } });
        expect(synced).toEqual({ height: 9, hash: hash(9) });
        expect(() => parseSyncResponse({ error: { code: -32005, message: 'rate limit exceeded' } })).toThrow('-32005');
    });
});

describe('attachGateway', () => {
    beforeEach(() => resetGatewayRegistry());

    test('uses the gateway when healthy', async () => {
        const calls = [];
        const fetchFn = async (url, opts) => {
            calls.push(url);
            if (url.endsWith('/health')) {
                return response(200, { gateway: 'xte-rpc-gateway', coin: 'xte', apiVersion: 1, status: 'ok' });
            }
            const body = JSON.parse(opts.body);
            expect(body.params[0].blockCount).toBe(1000);
            return response(200, { result: { items: [item(1)], synced: false } });
        };
        const daemon = { getWalletSyncData: jest.fn(async () => [[], true]), config: {} };
        attachGateway(daemon, { host: 'main.trrxitte.com', port: 443, ssl: true, namespace: 'xte', fetchFn });
        const rest = daemon.getWalletSyncData;
        const [blocks] = await daemon.getWalletSyncData([], 1, 0, 100);
        expect(blocks).toHaveLength(1);
        expect(calls).toEqual(['https://main.trrxitte.com/rpc/xte/health', 'https://main.trrxitte.com/rpc/xte']);
        expect(isGatewayActive('https://main.trrxitte.com/rpc/xte')).toBe(true);
        expect(rest).toBeDefined();
    });

    test('falls back to REST without a gateway and after a gateway error', async () => {
        const restCalls = [];
        const daemon = { getWalletSyncData: async (...a) => { restCalls.push(a); return [['rest'], true]; }, config: {} };
        attachGateway(daemon, {
            host: 'node.example', port: 443, ssl: true, namespace: 'xte',
            fetchFn: async () => response(404, {}),
        });
        expect((await daemon.getWalletSyncData([], 0, 0, 100))[0]).toEqual(['rest']);

        resetGatewayRegistry();
        const daemon2 = { getWalletSyncData: async (...a) => { restCalls.push(a); return [['rest2'], true]; }, config: {} };
        attachGateway(daemon2, {
            host: 'node2.example', port: 443, ssl: true, namespace: 'xte',
            fetchFn: async (url) => (url.endsWith('/health')
                ? response(200, { gateway: 'xte-rpc-gateway', coin: 'xte', apiVersion: 1, status: 'ok' })
                : response(200, { error: { code: -32000, message: 'daemon unreachable' } })),
        });
        expect((await daemon2.getWalletSyncData([], 0, 0, 100))[0]).toEqual(['rest2']);
        expect(isGatewayActive('https://node2.example/rpc/xte')).toBe(false);
        expect(restCalls).toHaveLength(2);
        expect(restCalls[1]).toEqual([[], 0, 0, 100]);
    });
});
