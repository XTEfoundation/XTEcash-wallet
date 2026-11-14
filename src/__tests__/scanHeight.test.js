/*
 * Date based scan heights must never land past the real chain height
 * (XTE blocks average ~58 s, not the 45 s target).
 */
import moment from 'moment';

jest.mock('react-native', () => ({
    Platform: { OS: 'ios' },
    NativeModules: {},
    Alert: { alert: jest.fn() },
    ToastAndroid: {},
    Text: 'Text',
}));
jest.mock('react-navigation', () => ({ StackActions: {}, NavigationActions: {} }));
jest.mock('../Globals', () => ({ Globals: { logger: { addLogMessage: jest.fn() } } }));

const Config = require('../Config');
const { getApproximateBlockHeight, dateToScanHeight } = require('../Utilities');

const cps = Config.scanHeightCheckpoints;

test('checkpoints are real and ascending', () => {
    expect(cps.length).toBeGreaterThan(10);
    for (let i = 1; i < cps.length; i++) {
        expect(cps[i][0]).toBeGreaterThan(cps[i - 1][0]);
        expect(cps[i][1]).toBeGreaterThan(cps[i - 1][1]);
    }
});

test('never above the real height at a checkpoint', () => {
    for (const [height, time] of cps) {
        const guess = getApproximateBlockHeight(new Date(time * 1000));
        expect(guess).toBeLessThanOrEqual(height);
        expect(height - guess).toBeLessThan(50000);
    }
});

test('a month pick starts before that date and below the tip', () => {
    const [lastHeight, lastTime] = cps[cps.length - 1];
    const scan = dateToScanHeight(moment(lastTime * 1000));
    expect(scan).toBeLessThan(lastHeight);
    expect(scan).toBeGreaterThan(lastHeight - 10000);
    const old = Math.floor((lastTime * 1000 - Config.chainLaunchTimestamp) / 1000 / Config.blockTargetTime);
    expect(old).toBeGreaterThan(lastHeight);
});

test('backup / swap / hardware wallet config defaults are off', () => {
    expect(Config.googleDriveBackup.clientId).toBe('');
    expect(Config.swap.providers).toEqual([]);
    expect(Config.hardwareWallet.ledgerTransportFactory).toBeNull();
});
