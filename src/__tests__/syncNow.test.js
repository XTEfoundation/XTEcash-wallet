jest.mock('../Config', () => ({ __esModule: true, default: { ticker: 'XTE' } }));
jest.mock('../Globals', () => ({ Globals: {} }));
jest.mock('../Database', () => ({ saveToDatabase: jest.fn(async () => {}) }));

const { Globals } = require('../Globals');
const { syncNow, runExclusive, syncInProgress } = require('../SyncNow');

function fakeWallet({ threadRunning }) {
    let height = 90;
    const internal = {
        syncThread: { started: threadRunning, shouldStop: !threadRunning },
        updateDaemonInfo: jest.fn(async () => {}),
        sync: jest.fn(async () => {
            if (height >= 100) return false;
            height += 5;
            return true;
        }),
    };
    return {
        internal: () => internal,
        getSyncStatus: () => [height, 100, 100],
        bump: () => { height = Math.min(100, height + 5); },
        internalRef: internal,
    };
}

describe('pull-to-refresh sync', () => {
    test('syncs directly when the wallet sync thread is stopped', async () => {
        const w = fakeWallet({ threadRunning: false });
        Globals.wallet = w;
        const res = await syncNow();
        expect(res.synced).toBe(true);
        expect(res.blocks).toBe(10);
        expect(w.internalRef.updateDaemonInfo).toHaveBeenCalled();
    });

    test('a second pull joins the running one instead of starting another', async () => {
        const w = fakeWallet({ threadRunning: false });
        Globals.wallet = w;
        const a = syncNow();
        const b = syncNow();
        expect(syncInProgress()).toBe(true);
        expect(a).toBe(b);
        await a;
        expect(syncInProgress()).toBe(false);
    });

    test('joins the running sync thread without calling sync() itself', async () => {
        const w = fakeWallet({ threadRunning: true });
        Globals.wallet = w;
        const timer = setInterval(() => w.bump(), 50);
        const res = await syncNow();
        clearInterval(timer);
        expect(res.synced).toBe(true);
        expect(w.internalRef.sync).not.toHaveBeenCalled();
    });

    test('runExclusive is released after an error', async () => {
        await expect(runExclusive(async () => { throw new Error('x'); })).rejects.toThrow('x');
        expect(syncInProgress()).toBe(false);
    });
});
