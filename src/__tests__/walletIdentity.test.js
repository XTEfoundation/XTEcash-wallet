import Config from '../Config';
import { formatListedNode, formatNode, parseNode, sameNode } from '../NodeAddress';

jest.mock('react-native', () => ({
    Platform: { OS: 'ios' },
    NativeModules: {},
}));

describe('XTE network identity', () => {
    test('uses the documented coin parameters', () => {
        expect(Config.coinName).toBe('XTE');
        expect(Config.ticker).toBe('XTE');
        expect(Config.addressPrefix).toBe(1334);
        expect(Config.uriPrefix).toBe('xte://');
        expect(Config.appName).toBe('XTE');
        expect(Config.appVersion).toBe('v1.020.0');
    });

    test('default daemon is the TLS node, not a cache API', () => {
        expect(Config.defaultDaemon.host).toBe('main.trrxitte.com');
        expect(Config.defaultDaemon.port).toBe(443);
        expect(Config.defaultDaemon.ssl).toBe(true);
        expect(Config.defaultDaemon.sslDetermined).toBe(true);
        expect(Config.defaultDaemon.isCacheApi).toBe(false);
        expect(Config.defaultNode).toBe('main.trrxitte.com:443:ssl');
        expect(Config.nodeListURL).toBe(
            'https://raw.githubusercontent.com/TRRXITTE/XTEnetworkserver/refs/heads/main/traaitt.json',
        );
        expect(Config.repoLink).toBe('https://github.com/XTEfoundation/XTEcash-wallet');
    });
});

describe('node addresses', () => {
    test('round-trips ssl and plain nodes', () => {
        expect(parseNode(formatNode('main.trrxitte.com', 443, true))).toEqual({
            host: 'main.trrxitte.com',
            port: 443,
            ssl: true,
        });
        expect(parseNode(formatNode('us-east.trrxitte.com', 14485, false))).toEqual({
            host: 'us-east.trrxitte.com',
            port: 14485,
            ssl: false,
        });
    });

    test('legacy connection strings keep TLS only on port 443', () => {
        expect(parseNode('main.trrxitte.com:443').ssl).toBe(true);
        expect(parseNode('eu.trrxitte.com:14485').ssl).toBe(false);
    });

    test('matches a listed node against the stored address', () => {
        const listed = {
            url: 'asia-east.trrxitte.com',
            port: 14485,
            ssl: false,
        };

        expect(formatListedNode(listed)).toBe('asia-east.trrxitte.com:14485:plain');
        expect(sameNode('asia-east.trrxitte.com:14485:plain', listed)).toBe(true);
        expect(sameNode('asia-east.trrxitte.com:14485', listed)).toBe(true);
        expect(sameNode('main.trrxitte.com:443:ssl', listed)).toBe(false);
    });
});
