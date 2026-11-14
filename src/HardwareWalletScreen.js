// Copyright (c) 2026, XTE Foundation
//
// Please see the included LICENSE file for more information.

import React from 'react';

import { Alert, ScrollView, Text, View } from 'react-native';

import QRCode from 'react-native-qrcode-svg';

import Config from './Config';
import { Globals } from './Globals';
import { saveToDatabase } from './Database';
import { Authenticate } from './Authenticate';
import {
    providers, watchOnlyPayload, parseWatchOnlyPayload, importWatchOnly,
} from './HardwareWallet';
import { ActionButton, Section } from './SecurityScreen';
import { getApproximateBlockHeight, scanHeightMargin } from './Utilities';

export class HardwareWalletScreen extends React.Component {
    static navigationOptions = {
        title: '',
    };

    constructor(props) {
        super(props);

        this.state = { statuses: {}, qr: null };
    }

    async componentDidMount() {
        const statuses = {};

        for (const p of providers) {
            try {
                statuses[p.id] = await p.status();
            } catch (err) {
                statuses[p.id] = { available: false, reason: String(err.message || err) };
            }
        }

        this.setState({ statuses });
    }

    /* Wallet setup (no wallet open yet) */
    get setupMode() {
        return !Globals.wallet;
    }

    finishImport(wallet) {
        Globals.wallet = wallet;
        saveToDatabase(Globals.wallet);
        this.props.navigation.navigate('SecuritySetup', { setup: true });
    }

    async connectLedger() {
        const ledger = providers.find((p) => p.id === 'ledger');

        try {
            const { address, privateViewKey } = await ledger.connectWatchOnly();
            const [wallet, error] = importWatchOnly(Globals.getDaemon(), { address, viewKey: privateViewKey, scanHeight: 0 });

            if (error) {
                throw new Error(error.toString());
            }

            this.finishImport(wallet);
        } catch (err) {
            Alert.alert('Ledger', String(err.message || err));
        }
    }

    scanWatchOnly() {
        this.props.navigation.navigate('QrScanner', {
            setAddress: (data) => {
                try {
                    const payload = parseWatchOnlyPayload(data);
                    const [wallet, error] = importWatchOnly(Globals.getDaemon(), payload);

                    if (error) {
                        throw new Error(error.toString());
                    }

                    this.finishImport(wallet);
                } catch (err) {
                    Alert.alert('Watch-only wallet', String(err.message || err));
                }
            },
        });
    }

    showWatchOnlyQr() {
        const show = () => {
            const [, privateViewKey] = Globals.wallet.getPrimaryAddressPrivateKeys();
            let scanHeight = 0;

            try {
                const sub = JSON.parse(Globals.wallet.toJSONString()).subWallets.subWallet[0];
                scanHeight = sub.syncStartHeight
                    || (sub.syncStartTimestamp
                        ? Math.max(0, getApproximateBlockHeight(new Date(sub.syncStartTimestamp * 1000)) - scanHeightMargin())
                        : 0);
            } catch (err) {
                scanHeight = 0;
            }

            this.setState({ qr: watchOnlyPayload(Globals.wallet.getPrimaryAddress(), privateViewKey, scanHeight) });
        };

        if (Globals.preferences.authConfirmation) {
            Authenticate(this.props.navigation, 'to show the watch-only QR code', () => {
                this.props.navigation.navigate('HardwareWallet');
                show();
            });
        } else {
            show();
        }
    }

    render() {
        const theme = this.props.screenProps.theme;
        const ledger = this.state.statuses.ledger;

        return (
            <View style={{ flex: 1, backgroundColor: theme.backgroundColour }}>
                <ScrollView contentContainerStyle={{ paddingTop: 60, paddingBottom: 40 }}>
                    <Text style={{ color: theme.primaryColour, fontSize: 25, marginHorizontal: 20 }}>Hardware wallet</Text>

                    <Section title='Ledger' theme={theme}>
                        <Text style={{ color: theme.slightlyMoreVisibleColour, fontSize: 14 }}>
                            {providers[0].description}
                        </Text>
                        {ledger && !ledger.available && (
                            <Text style={{ color: theme.slightlyMoreVisibleColour, fontSize: 13, marginTop: 6 }}>
                                Not available yet: {ledger.reason}
                            </Text>
                        )}
                        <ActionButton
                            theme={theme}
                            title='Connect Ledger (watch-only)'
                            disabled={!this.setupMode}
                            onPress={() => this.connectLedger()}
                        />
                    </Section>

                    <Section title='Offline phone (QR)' theme={theme}>
                        <Text style={{ color: theme.slightlyMoreVisibleColour, fontSize: 14 }}>
                            {providers[1].description} The QR code holds your address and private view key: it lets
                            the other phone see your payments, but it cannot spend.
                        </Text>
                        {this.setupMode ? (
                            <ActionButton theme={theme} title='Scan watch-only QR code' onPress={() => this.scanWatchOnly()} />
                        ) : (
                            <ActionButton theme={theme} title='Show watch-only QR code' onPress={() => this.showWatchOnlyQr()} />
                        )}
                        {this.state.qr && (
                            <View style={{ alignItems: 'center', marginTop: 10, padding: 10, backgroundColor: 'white' }}>
                                <QRCode value={this.state.qr} size={260} />
                                <Text style={{ color: 'black', marginTop: 6, fontSize: 12 }}>
                                    Scan in {Config.appName} on the online phone: Recover Wallet &gt; Hardware wallet / watch-only
                                </Text>
                            </View>
                        )}
                    </Section>
                </ScrollView>
            </View>
        );
    }
}
