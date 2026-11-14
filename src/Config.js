// Copyright (C) 2018, Zpalmtree
//
// Please see the included LICENSE file for more information.


import { MixinLimit, MixinLimits, Daemon } from 'traaittcash-wallet-backend';

import {
    derivePublicKey, generateKeyDerivation, generateRingSignatures,
    deriveSecretKey, generateKeyImage, checkRingSignature,
} from './NativeCode';

const Config = new function() {
    /**
     * If you can't figure this one out, I don't have high hopes
     */
    this.coinName = 'XTE';

    /**
     * Prefix for URI encoded addresses
     */
    this.uriPrefix = 'xte://';

    /**
     * How often to save the wallet, in milliseconds
     */
    this.walletSaveFrequency = 60 * 1000;

    /**
     * The amount of decimal places your coin has, XTE has two decimals
     */
    this.decimalPlaces = 2;

    /**
     * The address prefix your coin uses - you can find this in CryptoNoteConfig.h.
     * In XTE, this converts to XTE
     */
    this.addressPrefix = 1334;

    /**
     * Request timeout for daemon operations in milliseconds
     */
    this.requestTimeout = 30 * 1000;

    /**
     * The block time of your coin, in seconds
     */
    this.blockTargetTime = 45;

    /**
     * How often to process blocks, in millseconds
     */
    this.syncThreadInterval = 4;

    /**
     * How often to update the daemon info, in milliseconds
     */
    this.daemonUpdateInterval = 10 * 1000;

    /**
     * How often to check on locked transactions
     */
    this.lockedTransactionsCheckInterval = 10 * 3000;

    /**
     * The amount of blocks to process per 'tick' of the mainloop. Note: too
     * high a value will cause the event loop to be blocked, and your interaction
     * to be laggy.
     */
    this.blocksPerTick = 100;

    /**
     * Your coins 'ticker', generally used to refer to the coin, i.e. 123 XTE
     */
    this.ticker = 'XTE';

    /**
     * Most people haven't mined any blocks, so lets not waste time scanning
     * them
     */
    this.scanCoinbaseTransactions = false;

    /**
     * The minimum fee allowed for transactions, in ATOMIC units. XTE minimum is 100
     */
    this.minimumFee = 100;

    /**
     * Mapping of height to mixin maximum and mixin minimum
     */
    this.mixinLimits = new MixinLimits([
        /* Height: 440,000, minMixin: 0, maxMixin: 4, defaultMixin: 3 */
        new MixinLimit(440000, 0, 4, 3),

        /* At height of 800000, minMixin: 0, maxMixin: 5 */
        new MixinLimit(800000, 0, 5, 5),

        /* At height of 1000000, minMixin: 0, maxMixin: 8 */
        new MixinLimit(1000000, 0, 8, 8),
    ], 3 /* Default mixin of 3 before block 440,000 */);

    /**
     * The length of a standard address for your coin
     */
    this.standardAddressLength = 98;

    /**
     * The length of an integrated address for your coin - It's the same as
     * a normal address, but there is a paymentID included in there - since
     * payment ID's are 64 chars, and base58 encoding is done by encoding
     * chunks of 8 chars at once into blocks of 11 chars, we can calculate
     * this automatically
     */
    this.integratedAddressLength = 98 + ((64 * 11) / 8);

    /**
     * Use our native func instead of JS slowness
     */
    this.derivePublicKey = derivePublicKey;

    /**
     * Use our native func instead of JS slowness
     */
    this.generateKeyDerivation = generateKeyDerivation;

    /**
     * Use our native func instead of JS slowness
     */
    this.generateRingSignatures = generateRingSignatures;

    /**
     * Use our native func instead of JS slowness
     */
    this.deriveSecretKey = deriveSecretKey;

    /**
     * Use our native func instead of JS slowness
     */
    this.generateKeyImage = generateKeyImage;

    /**
     * Use our native func instead of JS slowness
     */
    this.checkRingSignatures = checkRingSignature;

    /**
     * Memory to use for storing downloaded blocks - 3MB
     */
    this.blockStoreMemoryLimit = 1024 * 1024 * 3;

    /**
     * Amount of blocks to request from the daemon at once
     */
    this.blocksPerDaemonRequest = 100;

    /**
     * JSON-RPC namespace of the xte-rpc-gateway on the node
     * (https://<host>/rpc/<namespace>, <namespace>_syncBlocks)
     */
    this.gatewayNamespace = 'xte';

    /**
     * Blocks per <namespace>_syncBlocks call (the gateway allows up to 1000)
     */
    this.gatewayBlocksPerRequest = 1000;

    /**
     * Unix timestamp of the time your chain was launched.
     * XTE Genesis block timestamp: 1686748487
     */
    this.chainLaunchTimestamp = new Date(1686748487 * 1000);

    /**
     * Real (height, unix timestamp) pairs read from the XTE chain on
     * 2026-11-14. Blocks average ~58 s, not the 45 s target, and block 1 is
     * two months after chainLaunchTimestamp, so a date to height guess from
     * blockTargetTime alone lands past the real height (often past the tip)
     * and a restored wallet skips its own transactions.
     * Utilities.getApproximateBlockHeight interpolates these.
     */
    this.scanHeightCheckpoints = [[1, 1692889600], [50001, 1695675330], [100001, 1697961762], [150001, 1700245043], [200001, 1702565718], [250001, 1704888081], [300001, 1707160594], [350001, 1709523703], [400001, 1711886161], [450001, 1714245221], [500001, 1716514630], [550001, 1718783128], [600001, 1721056247], [650001, 1723326852], [700001, 1725635429], [750001, 1727912650], [800001, 1730184444], [850001, 1732473677], [900001, 1734741847], [950001, 1737022307], [1000001, 1739319502], [1050001, 1741649822], [1100001, 1743956816], [1150001, 1746271037], [1200001, 1748600868], [1250001, 1750907528], [1300001, 1755467604], [1350001, 1759589997], [1400001, 1762069310], [1450001, 1764369661], [1500001, 1766682159], [1550001, 1768957124], [1600001, 1776585472], [1650001, 1779056282], [1700001, 1781328444], [1750001, 1786195533], [1800001, 1790783238], [1843571, 1794656605]];

    /**
     * Fee to take on all transactions, in percentage. XTE uses 0% dev fee
     */
    this.devFeePercentage = 0;

    /**
     * Address to send dev fee to. Not used for XTE (devFeePercentage = 0)
     */
    this.devFeeAddress = '';

    /**
     * Base url for price API
     *
     * The program *should* fail gracefully if your coin is not supported, or
     * you just set this to an empty string. If you have another API you want
     * it to support, you're going to have to modify the code in Currency.js.
     */
    this.priceApiLink = 'https://api.coingecko.com/api/v3/simple/price';

    /**
     * Default daemon. Daemon's constructor is (host, port, isCacheApi, ssl).
     * The third argument must stay false: true would mark this as a cache API.
     * The public node list is fetched from nodeListURL; do not hardcode nodes here.
     */
    this.defaultDaemon = new Daemon('main.trrxitte.com', 443, false, true);

    /**
     * Persisted form of defaultDaemon. See NodeAddress.js.
     */
    this.defaultNode = 'main.trrxitte.com:443:ssl';

    /**
     * A link to where a bug can be reported for your wallet. Please update
     * this if you are forking, so we don't get reported bugs for your wallet...
     *
     */
    this.repoLink = 'https://github.com/XTEfoundation/XTEcash-wallet';

    /**
     * This only controls the name in the settings screen.
     */
    this.appName = 'XTE';

    /**
     * Slogan phrase during wallet CreateScreen
     */
    this.sloganCreateScreen = 'Fast. Safe. Easy.';

    /**
     * Displayed in the settings screen
     */
    this.appVersion = 'v1.020.3';

    /**
     * Base URL for us to chuck a hash on the end, and find a transaction
     */
    this.explorerBaseURL = 'https://explorer.xtecash.com/?hash=';

    /**
     * A link to your app on the Apple app store. Currently blank because we
     * haven't released for iOS yet...
     */
    this.appStoreLink = '';

    /**
     * A link to your app on the google play store
     */
    this.googlePlayLink = 'https://play.google.com/store/apps/details?id=io.traaitt.osx';

    /**
     * Optional Google Drive backup (appDataFolder). Needs an OAuth client id
     * from a Google Cloud project with the Drive API enabled; the share-sheet
     * backup (Gmail / Drive app) works without it.
     */
    this.googleDriveBackup = { clientId: '' };

    /**
     * Hardware wallets. ledgerTransportFactory: () => Promise<transport>,
     * set when a Ledger BLE/USB transport is bundled (see HardwareWallet.js).
     */
    this.hardwareWallet = { ledgerTransportFactory: null };

    /**
     * XMR swap providers (see Swap.js). Disabled: no service lists the coin
     * yet. Example once listed: { id: 'changenow', enabled: true,
     * apiKey: '<partner key>', toCurrency: 'xte' }.
     */
    this.swap = { providers: [] };

    /**
     * A url to fetch node info from. Should follow the turtlepay format
     * detailed here: https://docs.turtlepay.io/blockapi/
     */
    this.nodeListURL = 'https://raw.githubusercontent.com/TRRXITTE/XTEnetworkserver/refs/heads/main/traaitt.json';
};

module.exports = Config;
