// Copyright (c) 2026, XTE Foundation
//
// Please see the included LICENSE file for more information.
//
// Restore a wallet from an encrypted backup (iCloud Keychain on iOS, or the
// text of a backup that was shared to Gmail / Google Drive / Files).

import React from 'react';

import { ActivityIndicator, Alert, Platform, ScrollView, Text, TextInput, View } from 'react-native';

import { WalletBackend } from 'traaittcash-wallet-backend';

import Config from './Config';
import { Globals } from './Globals';
import { saveToDatabase } from './Database';
import { decryptBackup, extractBackupText, loadFromCloud, cloudBackupAvailable } from './Backup';
import { ActionButton, inputStyle } from './SecurityScreen';

export class RestoreBackupScreen extends React.Component {
    static navigationOptions = {
        title: '',
    };

    constructor(props) {
        super(props);

        this.state = {
            backupText: '',
            password: '',
            busy: false,
            cloudAvailable: false,
        };
    }

    async componentDidMount() {
        this.setState({ cloudAvailable: await cloudBackupAvailable().catch(() => false) });
    }

    async loadCloud() {
        try {
            const text = await loadFromCloud();

            if (!text) {
                Alert.alert('No iCloud backup', `No ${Config.coinName} backup was found in your iCloud Keychain.`);
                return;
            }

            this.setState({ backupText: text });
        } catch (err) {
            Alert.alert('iCloud Keychain', String(err.message || err));
        }
    }

    async restore() {
        this.setState({ busy: true });

        try {
            const secrets = await decryptBackup(extractBackupText(this.state.backupText), this.state.password);

            const [wallet, error] = WalletBackend.importWalletFromKeys(
                Globals.getDaemon(), secrets.scanHeight || 0, secrets.viewKey, secrets.spendKey, Config,
            );

            if (error) {
                throw new Error(error.toString());
            }

            if (wallet.getPrimaryAddress() !== secrets.address) {
                throw new Error('The restored keys do not match the address in the backup.');
            }

            Globals.wallet = wallet;
            await saveToDatabase(Globals.wallet);

            this.props.navigation.navigate('SecuritySetup', { setup: true });
        } catch (err) {
            Alert.alert('Could not restore', String(err.message || err));
        } finally {
            this.setState({ busy: false, password: '' });
        }
    }

    render() {
        const theme = this.props.screenProps.theme;

        return (
            <View style={{ flex: 1, backgroundColor: theme.backgroundColour }}>
                <ScrollView contentContainerStyle={{ paddingTop: 60, paddingHorizontal: 20, paddingBottom: 40 }}>
                    <Text style={{ color: theme.primaryColour, fontSize: 25 }}>Restore encrypted backup</Text>
                    <Text style={{ color: theme.slightlyMoreVisibleColour, fontSize: 14, marginTop: 6 }}>
                        {Platform.OS === 'ios'
                            ? 'Load it from iCloud Keychain, or paste the backup you shared to Gmail, Drive or Files.'
                            : 'Paste the backup you saved to Google Drive or mailed to yourself with Gmail.'}
                    </Text>

                    {this.state.cloudAvailable && (
                        <ActionButton theme={theme} title='Load from iCloud Keychain' onPress={() => this.loadCloud()} />
                    )}

                    <TextInput
                        style={[inputStyle(theme), { minHeight: 120, textAlignVertical: 'top' }]}
                        multiline
                        placeholder='Paste the encrypted backup here'
                        placeholderTextColor={theme.slightlyMoreVisibleColour}
                        autoCapitalize='none'
                        autoCorrect={false}
                        value={this.state.backupText}
                        onChangeText={(backupText) => this.setState({ backupText })}
                    />
                    <TextInput
                        style={inputStyle(theme)}
                        placeholder='Backup password'
                        placeholderTextColor={theme.slightlyMoreVisibleColour}
                        secureTextEntry
                        autoCapitalize='none'
                        autoCorrect={false}
                        value={this.state.password}
                        onChangeText={(password) => this.setState({ password })}
                    />
                    {this.state.busy && <ActivityIndicator color={theme.primaryColour} />}
                    <ActionButton
                        theme={theme}
                        title='Restore wallet'
                        disabled={this.state.busy || !this.state.backupText || !this.state.password}
                        onPress={() => this.restore()}
                    />
                </ScrollView>
            </View>
        );
    }
}
