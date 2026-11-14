// Copyright (c) 2026, XTE Foundation
//
// Please see the included LICENSE file for more information.
//
// Hardware wallet providers.
//
// 1. Ledger (Nano X / Stax / Flex over Bluetooth on iOS and Android, any
//    Nano over USB on Android). Talks to the TurtleCoin Ledger app protocol
//    (CLA 0xE0, see github.com/XTEfoundation/ledger-app-traaitt), rebuilt
//    with the XTE / XTCASH address prefix. The app is not in Ledger Live:
//    it has to be side-loaded, and this build ships without the Bluetooth/
//    USB transport library, so the provider reports itself as unavailable
//    instead of failing later.
// 2. Air-gapped QR signer: a second, always-offline phone runs this wallet
//    and holds the spend key. The online phone imports a watch-only wallet
//    from a QR code (address + private view key) to see balance and
//    incoming payments. QR transaction signing between the two is not built
//    yet; spending still happens on the offline phone.

import { WalletBackend } from 'traaittcash-wallet-backend';

import Config from './Config';

export const LEDGER_CLA = 0xe0;

export const LedgerIns = {
    VERSION: 0x01,
    IDENT: 0x05,
    PUBLIC_KEYS: 0x10,
    VIEW_SECRET_KEY: 0x11,
    ADDRESS: 0x30,
    TX_STATE: 0x70,
    TX_START: 0x71,
    TX_START_INPUT_LOAD: 0x72,
    TX_LOAD_INPUT: 0x73,
    TX_START_OUTPUT_LOAD: 0x74,
    TX_LOAD_OUTPUT: 0x75,
    TX_FINALIZE_PREFIX: 0x76,
    TX_SIGN: 0x77,
    TX_DUMP: 0x78,
    TX_RESET: 0x79,
};

const P1_CONFIRM = 0x01;
const P1_NON_CONFIRM = 0x00;

export class HardwareWalletError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

/**
 * Speaks the Ledger app protocol over any transport with
 * `exchange(Buffer) -> Promise<Buffer>` (Ledger's hw-transport interface).
 */
export class LedgerClient {
    constructor(transport) {
        this.transport = transport;
    }

    async send(ins, p1 = P1_NON_CONFIRM, p2 = 0, data = Buffer.alloc(0)) {
        const apdu = Buffer.concat([Buffer.from([LEDGER_CLA, ins, p1, p2, data.length]), data]);
        const response = Buffer.from(await this.transport.exchange(apdu));

        if (response.length < 2) {
            throw new HardwareWalletError('bad-response', 'Empty response from the Ledger');
        }

        const sw = response.readUInt16BE(response.length - 2);

        if (sw === 0x6e00 || sw === 0x6d00) {
            throw new HardwareWalletError('app-not-open', `Open the ${Config.ticker} app on your Ledger`);
        }

        if (sw === 0x6985) {
            throw new HardwareWalletError('rejected', 'Rejected on the Ledger');
        }

        if (sw !== 0x9000) {
            throw new HardwareWalletError('device-error', `Ledger error 0x${sw.toString(16)}`);
        }

        return response.slice(0, response.length - 2);
    }

    async version() {
        const v = await this.send(LedgerIns.VERSION);
        return `${v[0]}.${v[1]}.${v[2]}`;
    }

    async publicKeys(confirm = false) {
        const keys = await this.send(LedgerIns.PUBLIC_KEYS, confirm ? P1_CONFIRM : P1_NON_CONFIRM);
        return { spend: keys.slice(0, 32).toString('hex'), view: keys.slice(32, 64).toString('hex') };
    }

    /* Exporting the private view key always asks on the device */
    async privateViewKey() {
        return (await this.send(LedgerIns.VIEW_SECRET_KEY, P1_CONFIRM)).slice(0, 32).toString('hex');
    }

    async address(confirm = true) {
        return (await this.send(LedgerIns.ADDRESS, confirm ? P1_CONFIRM : P1_NON_CONFIRM)).toString('ascii');
    }
}

/* ---------- providers ---------- */

function ledgerTransportFactory() {
    const hw = Config.hardwareWallet || {};
    return hw.ledgerTransportFactory || null;
}

export const providers = [
    {
        id: 'ledger',
        name: 'Ledger',
        description: 'Nano X, Stax and Flex over Bluetooth; Nano S Plus / X over USB on Android.',
        async status() {
            if (!ledgerTransportFactory()) {
                return {
                    available: false,
                    reason:
                        `This build has no Ledger Bluetooth/USB transport yet, and the ${Config.ticker} Ledger ` +
                        'app is not in Ledger Live (it must be side-loaded from the XTE Foundation build).',
                };
            }
            return { available: true };
        },
        /* Returns { address, privateViewKey } for a watch-only wallet */
        async connectWatchOnly() {
            const factory = ledgerTransportFactory();

            if (!factory) {
                throw new HardwareWalletError('no-transport', 'Ledger support is not included in this build.');
            }

            let transport;

            try {
                transport = await factory();
            } catch (err) {
                throw new HardwareWalletError('no-device', 'No Ledger found. Unlock it, turn on Bluetooth and try again.');
            }

            try {
                const client = new LedgerClient(transport);
                await client.version();
                const address = await client.address(true);
                const privateViewKey = await client.privateViewKey();
                return { address, privateViewKey };
            } finally {
                if (transport && transport.close) {
                    transport.close().catch(() => {});
                }
            }
        },
    },
    {
        id: 'qr-signer',
        name: 'Offline phone (QR)',
        description:
            'Keep the spend key on an offline phone. This phone shows the balance from a watch-only QR code.',
        async status() {
            return { available: true, watchOnlyOnly: true };
        },
    },
];

/* ---------- watch-only QR ---------- */

export const WATCH_ONLY_PREFIX = 'xtewatch:';

export function watchOnlyPayload(address, privateViewKey, scanHeight) {
    return WATCH_ONLY_PREFIX + JSON.stringify({
        coin: Config.coinName, address, viewKey: privateViewKey, scanHeight: scanHeight || 0,
    });
}

export function parseWatchOnlyPayload(text) {
    if (typeof text !== 'string' || !text.startsWith(WATCH_ONLY_PREFIX)) {
        throw new Error('This is not a watch-only wallet QR code.');
    }

    const data = JSON.parse(text.slice(WATCH_ONLY_PREFIX.length));

    if (data.coin !== Config.coinName) {
        throw new Error(`This QR code is for ${data.coin}, not ${Config.coinName}.`);
    }

    if (!/^[0-9a-f]{64}$/.test(data.viewKey) || typeof data.address !== 'string') {
        throw new Error('The QR code is damaged.');
    }

    return data;
}

export function importWatchOnly(daemon, { address, viewKey, scanHeight }) {
    return WalletBackend.importViewWallet(daemon, scanHeight || 0, viewKey, address, Config);
}
