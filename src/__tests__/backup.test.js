/*
 * Encrypted wallet backups: round trip, wrong password, tampering, and a
 * fixed vector that the iPad wallets (CryptoKit + CommonCrypto) also decrypt.
 */
jest.mock('react-native', () => ({
    Platform: { OS: 'android' },
    NativeModules: {},
    Share: { share: jest.fn() },
}));
jest.mock('@react-native-community/async-storage', () => ({
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
}));

const Config = require('../Config');
const {
    encryptBackup, decryptBackup, parseBackup, passwordProblem, extractBackupText,
} = require('../Backup');

const secrets = {
    spendKey: '1'.repeat(64),
    viewKey: '2'.repeat(64),
    scanHeight: 2000000,
};
const address = Config.coinName === 'XTCASH' ? 'cash' + 'x'.repeat(94) : 'XT' + 'x'.repeat(96);

test('round trip', async () => {
    const text = await encryptBackup({ coin: Config.coinName, address, secrets }, 'correct horse battery', { iterations: 1000 });
    const parsed = JSON.parse(text);
    expect(parsed.format).toBe('traaitt-wallet-backup');
    expect(text).not.toContain(secrets.spendKey);
    expect(text).not.toContain(secrets.viewKey);
    const out = await decryptBackup(text, 'correct horse battery');
    expect(out.spendKey).toBe(secrets.spendKey);
    expect(out.viewKey).toBe(secrets.viewKey);
    expect(out.scanHeight).toBe(2000000);
    expect(out.address).toBe(address);
});

test('wrong password and tampering fail', async () => {
    const text = await encryptBackup({ coin: Config.coinName, address, secrets }, 'correct horse battery', { iterations: 1000 });
    await expect(decryptBackup(text, 'wrong password!!')).rejects.toThrow(/Wrong password/);
    const b = JSON.parse(text);
    b.address = address.slice(0, -1) + 'y';
    await expect(decryptBackup(JSON.stringify(b), 'correct horse battery')).rejects.toThrow(/Wrong password/);
});

test('rejects other coins and short passwords', async () => {
    const text = await encryptBackup({ coin: Config.coinName, address, secrets }, 'correct horse battery', { iterations: 1000 });
    const b = JSON.parse(text);
    b.coin = 'OTHER';
    expect(() => parseBackup(JSON.stringify(b))).toThrow(/not /);
    expect(passwordProblem('short')).toBeDefined();
    expect(passwordProblem('long enough pw', 'different')).toBeDefined();
    await expect(encryptBackup({ coin: Config.coinName, address, secrets }, 'short')).rejects.toThrow();
});

test('extracts the JSON from a shared message', async () => {
    const text = await encryptBackup({ coin: Config.coinName, address, secrets }, 'correct horse battery', { iterations: 1000 });
    const message = 'XTCASH encrypted wallet backup.\nRestore it ...\n\n' + text + '\n';
    expect(extractBackupText(message)).toBe(text);
});

test('fixed cross-platform vector', async () => {
    const text = await encryptBackup({ coin: 'XTCASH', address: 'cashVECTOR', secrets }, 'vector password 1', {
        iterations: 1000,
        salt: Buffer.alloc(16, 7),
        iv: Buffer.alloc(12, 9),
        createdAt: '2026-11-14T00:00:00.000Z',
    }).catch((e) => e);
    if (Config.coinName !== 'XTCASH') {
        return;
    }
    const b = JSON.parse(text);
    /* Same values are asserted in the iPad BackupTests */
    expect(b.cipher.tag).toBe(VECTOR_TAG);
    expect(b.data.slice(0, 24)).toBe(VECTOR_DATA_PREFIX);
});

const VECTOR_TAG = '0QeGbx+8ub3o/HzTecmslA==';
const VECTOR_DATA_PREFIX = 'Jk6XYrfgip1yGdHgvsq6SNPL';
