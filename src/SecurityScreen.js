// Copyright (c) 2026, XTE Foundation
//
// Please see the included LICENSE file for more information.
//
// "Secure your wallet" (shown once after creating or restoring a wallet) and
// Settings > Security & Backup. Everything here is optional.

import React from 'react';
import { HapticSwitch } from './Feedback';

import {
    ActivityIndicator, Alert, Platform, ScrollView, Switch, Text, TextInput,
    TouchableOpacity, View,
} from 'react-native';

import PushNotification from 'react-native-push-notification';

import Config from './Config';
import { Globals } from './Globals';
import { saveToDatabase, savePreferencesToDatabase } from './Database';
import {
    AUTO_LOCK_CHOICES, getSecurityPrefs, updateSecurityPrefs, vaultInfo,
    compromisedIndicators, securityAvailable,
} from './Security';
import {
    encryptBackup, walletSecrets, passwordProblem, cloudBackupAvailable,
    saveToCloud, shareBackup, googleDriveConfigured,
} from './Backup';
import { getApproximateBlockHeight, scanHeightMargin, toastPopUp } from './Utilities';

export function Section({ title, theme, children }) {
    return (
        <View style={{ marginTop: 24, marginHorizontal: 20 }}>
            <Text style={{ color: theme.primaryColour, fontSize: 18, fontWeight: 'bold', marginBottom: 8 }}>
                {title}
            </Text>
            {children}
        </View>
    );
}

export function Row({ title, description, theme, right }) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={{ color: theme.primaryColour, fontSize: 16 }}>{title}</Text>
                {description ? (
                    <Text style={{ color: theme.slightlyMoreVisibleColour, fontSize: 13, marginTop: 2 }}>
                        {description}
                    </Text>
                ) : null}
            </View>
            {right}
        </View>
    );
}

export function ActionButton({ title, onPress, theme, disabled }) {
    return (
        <TouchableOpacity
            onPress={onPress}
            disabled={disabled}
            style={{
                borderWidth: 1,
                borderColor: theme.primaryColour,
                borderRadius: 8,
                paddingVertical: 12,
                paddingHorizontal: 14,
                marginVertical: 6,
                opacity: disabled ? 0.4 : 1,
            }}
        >
            <Text style={{ color: theme.primaryColour, fontSize: 15, textAlign: 'center' }}>{title}</Text>
        </TouchableOpacity>
    );
}

export function inputStyle(theme) {
    return {
        borderWidth: 1,
        borderColor: theme.slightlyMoreVisibleColour,
        borderRadius: 8,
        color: theme.primaryColour,
        paddingHorizontal: 12,
        paddingVertical: Platform.OS === 'ios' ? 12 : 8,
        marginVertical: 6,
    };
}

function authMethodName() {
    switch (Globals.preferences.authenticationMethod) {
        case 'hardware-auth': return Platform.OS === 'ios' ? 'Face ID / Touch ID, PIN fallback' : 'Fingerprint, PIN fallback';
        case 'pincode': return 'PIN';
        default: return 'None';
    }
}

export class SecurityScreen extends React.Component {
    static navigationOptions = {
        title: '',
    };

    constructor(props) {
        super(props);

        const prefs = getSecurityPrefs();

        this.state = {
            ...prefs,
            vaultLevel: '…',
            indicators: [],
            authConfirmation: Globals.preferences.authConfirmation,
            notificationsEnabled: Globals.preferences.notificationsEnabled,
            password: '',
            confirm: '',
            busy: false,
            cloudAvailable: false,
        };
    }

    get setupMode() {
        const params = this.props.navigation.state.params || {};
        return !!params.setup;
    }

    async componentDidMount() {
        const [info, indicators, cloudAvailable] = await Promise.all([
            vaultInfo(), compromisedIndicators(), cloudBackupAvailable().catch(() => false),
        ]);

        this.setState({ vaultLevel: info.level, indicators, cloudAvailable });

        if (this.setupMode) {
            updateSecurityPrefs({ setupOffered: true });
        }
    }

    async setPref(changes) {
        const prefs = await updateSecurityPrefs(changes);
        this.setState(prefs);
        return prefs;
    }

    async toggleVault(enabled) {
        if (!securityAvailable()) {
            Alert.alert('Not available', 'This build has no hardware key support.');
            return;
        }

        try {
            this.setState({ busy: true });
            await this.setPref({ hardwareVault: enabled });

            /* Re-write the stored wallet now, sealed or plain */
            if (Globals.wallet) {
                await saveToDatabase(Globals.wallet);
            }

            toastPopUp(enabled ? `Wallet file encrypted (${this.state.vaultLevel})` : 'Hardware encryption turned off');
        } catch (err) {
            await this.setPref({ hardwareVault: false });
            Alert.alert('Could not enable hardware encryption', String(err.message || err));
        } finally {
            this.setState({ busy: false });
        }
    }

    toggleAuthConfirmation(enabled) {
        Globals.preferences.authConfirmation = enabled;
        savePreferencesToDatabase(Globals.preferences);
        this.setState({ authConfirmation: enabled });
    }

    async toggleNotifications(enabled) {
        Globals.preferences.notificationsEnabled = enabled;
        savePreferencesToDatabase(Globals.preferences);
        this.setState({ notificationsEnabled: enabled });

        if (enabled && Platform.OS === 'ios') {
            try {
                await PushNotification.requestPermissions();
            } catch (err) {
                /* The user can still allow it in iOS Settings */
            }
        }
    }

    async makeBackup() {
        const problem = passwordProblem(this.state.password, this.state.confirm);

        if (problem) {
            Alert.alert('Backup password', problem);
            return undefined;
        }

        if (!Globals.wallet) {
            Alert.alert('No wallet', 'Open a wallet first.');
            return undefined;
        }

        this.setState({ busy: true });

        try {
            const secrets = walletSecrets(Globals.wallet, (date) => Math.max(0, getApproximateBlockHeight(date) - scanHeightMargin()));

            return await encryptBackup({
                coin: Config.coinName,
                address: Globals.wallet.getPrimaryAddress(),
                secrets,
            }, this.state.password);
        } finally {
            this.setState({ busy: false });
        }
    }

    async backupToCloud() {
        try {
            const encrypted = await this.makeBackup();

            if (!encrypted) {
                return;
            }

            await saveToCloud(encrypted);
            await this.setPref({ lastCloudBackup: new Date().toISOString() });
            Alert.alert(
                'Saved to iCloud Keychain',
                'Your encrypted backup syncs to your other Apple devices when iCloud Keychain is on ' +
                '(iOS Settings > your name > iCloud > Passwords and Keychain). Keep the backup password safe: ' +
                'it is needed to restore and cannot be recovered.',
            );
        } catch (err) {
            Alert.alert('iCloud backup failed', String(err.message || err));
        }
    }

    async backupToShare() {
        try {
            const encrypted = await this.makeBackup();

            if (!encrypted) {
                return;
            }

            const result = await shareBackup(encrypted);

            if (result && result.action !== 'dismissedAction') {
                await this.setPref({ lastFileBackup: new Date().toISOString() });
            }
        } catch (err) {
            Alert.alert('Backup failed', String(err.message || err));
        }
    }

    finish() {
        this.props.navigation.navigate('Home');
    }

    render() {
        const theme = this.props.screenProps.theme;
        const s = this.state;

        return (
            <View style={{ flex: 1, backgroundColor: theme.backgroundColour }}>
                <ScrollView contentContainerStyle={{ paddingTop: 60, paddingBottom: 40 }}>
                    <Text style={{ color: theme.primaryColour, fontSize: 25, marginHorizontal: 20 }}>
                        {this.setupMode ? 'Secure your wallet' : 'Security & Backup'}
                    </Text>
                    {this.setupMode && (
                        <Text style={{ color: theme.slightlyMoreVisibleColour, fontSize: 15, marginHorizontal: 20, marginTop: 6 }}>
                            All optional. You can change these later in Settings &gt; Security &amp; Backup.
                        </Text>
                    )}

                    {s.indicators.length > 0 && (
                        <View style={{ margin: 20, padding: 12, borderRadius: 8, backgroundColor: '#8b1a1a' }}>
                            <Text style={{ color: 'white', fontWeight: 'bold' }}>
                                {Platform.OS === 'ios' ? 'This device looks jailbroken' : 'This device looks rooted'}
                            </Text>
                            <Text style={{ color: 'white', marginTop: 4 }}>
                                Other apps may be able to read your keys. Do not keep large amounts in this wallet.
                                {'\n'}{s.indicators.join('\n')}
                            </Text>
                        </View>
                    )}

                    <Section title='Device security' theme={theme}>
                        <Row
                            theme={theme}
                            title='Hardware key encryption'
                            description={`Encrypt the wallet file with a key that never leaves the ${Platform.OS === 'ios' ? 'Secure Enclave' : 'Android Keystore (StrongBox when available)'}. Key storage: ${s.vaultLevel}`}
                            right={<HapticSwitch value={!!s.hardwareVault} disabled={s.busy} onValueChange={(v) => this.toggleVault(v)} />}
                        />
                        <Row
                            theme={theme}
                            title='Unlock method'
                            description={authMethodName()}
                            right={
                                <TouchableOpacity onPress={() => this.props.navigation.navigate('ChooseAuthMethod', { nextRoute: this.setupMode ? 'SecuritySetup' : 'Security' })}>
                                    <Text style={{ color: theme.primaryColour, textDecorationLine: 'underline' }}>Change</Text>
                                </TouchableOpacity>
                            }
                        />
                        <Row
                            theme={theme}
                            title='Confirm sends'
                            description='Ask for Face ID / fingerprint / PIN before every transfer and before showing keys'
                            right={<HapticSwitch value={!!s.authConfirmation} onValueChange={(v) => this.toggleAuthConfirmation(v)} />}
                        />
                        <Text style={{ color: theme.primaryColour, fontSize: 16, marginTop: 10 }}>Auto-lock</Text>
                        <Text style={{ color: theme.slightlyMoreVisibleColour, fontSize: 13 }}>
                            Ask for your unlock method again after the app was in the background
                        </Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
                            {AUTO_LOCK_CHOICES.map((c) => (
                                <TouchableOpacity
                                    key={c.seconds}
                                    onPress={() => this.setPref({ autoLockSeconds: c.seconds })}
                                    style={{
                                        borderWidth: 1,
                                        borderColor: theme.primaryColour,
                                        backgroundColor: s.autoLockSeconds === c.seconds ? theme.primaryColour : 'transparent',
                                        borderRadius: 14,
                                        paddingHorizontal: 10,
                                        paddingVertical: 5,
                                        margin: 3,
                                    }}
                                >
                                    <Text style={{ color: s.autoLockSeconds === c.seconds ? theme.backgroundColour : theme.primaryColour, fontSize: 13 }}>
                                        {c.label}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                        {Globals.preferences.authenticationMethod === 'none' && s.autoLockSeconds >= 0 && (
                            <Text style={{ color: theme.slightlyMoreVisibleColour, fontSize: 13, marginTop: 4 }}>
                                Auto-lock needs an unlock method (PIN or biometrics).
                            </Text>
                        )}
                        <Row
                            theme={theme}
                            title={Platform.OS === 'ios' ? 'Hide in app switcher' : 'Block screenshots'}
                            description={Platform.OS === 'ios'
                                ? 'Blur the wallet in the app switcher'
                                : 'Block screenshots and screen recording, and hide the wallet in recent apps'}
                            right={<HapticSwitch value={!!s.screenProtection} onValueChange={(v) => this.setPref({ screenProtection: v })} />}
                        />
                    </Section>

                    <Section title='Notifications' theme={theme}>
                        <Row
                            theme={theme}
                            title='Incoming transfers'
                            description='Local notification when background sync finds a payment to you. Nothing is sent to a server.'
                            right={<HapticSwitch value={!!s.notificationsEnabled} onValueChange={(v) => this.toggleNotifications(v)} />}
                        />
                    </Section>

                    <Section title='Encrypted backup' theme={theme}>
                        <Text style={{ color: theme.slightlyMoreVisibleColour, fontSize: 13 }}>
                            Your keys are encrypted on this device with AES-256-GCM and a key derived from this
                            password (PBKDF2-SHA256, 310,000 rounds) before they go anywhere. Without the password
                            the backup is useless, so write it down. Your mnemonic seed remains the master backup.
                        </Text>
                        <TextInput
                            style={inputStyle(theme)}
                            placeholder='Backup password (10+ characters)'
                            placeholderTextColor={theme.slightlyMoreVisibleColour}
                            secureTextEntry
                            autoCapitalize='none'
                            autoCorrect={false}
                            value={s.password}
                            onChangeText={(password) => this.setState({ password })}
                        />
                        <TextInput
                            style={inputStyle(theme)}
                            placeholder='Repeat password'
                            placeholderTextColor={theme.slightlyMoreVisibleColour}
                            secureTextEntry
                            autoCapitalize='none'
                            autoCorrect={false}
                            value={s.confirm}
                            onChangeText={(confirm) => this.setState({ confirm })}
                        />
                        {s.busy && <ActivityIndicator color={theme.primaryColour} />}
                        {s.cloudAvailable && (
                            <ActionButton theme={theme} disabled={s.busy} title='Save to iCloud Keychain' onPress={() => this.backupToCloud()} />
                        )}
                        <ActionButton
                            theme={theme}
                            disabled={s.busy}
                            title={Platform.OS === 'ios' ? 'Share encrypted backup (Gmail, Files, …)' : 'Save to Google Drive / Gmail (share)'}
                            onPress={() => this.backupToShare()}
                        />
                        {googleDriveConfigured() ? null : (
                            <Text style={{ color: theme.slightlyMoreVisibleColour, fontSize: 12 }}>
                                Tip: pick Gmail in the share sheet to mail the encrypted backup to yourself, or Drive to store it there.
                            </Text>
                        )}
                        {(s.lastCloudBackup || s.lastFileBackup) ? (
                            <Text style={{ color: theme.slightlyMoreVisibleColour, fontSize: 12, marginTop: 4 }}>
                                {s.lastCloudBackup ? `Last iCloud backup: ${s.lastCloudBackup.slice(0, 10)}  ` : ''}
                                {s.lastFileBackup ? `Last shared backup: ${s.lastFileBackup.slice(0, 10)}` : ''}
                            </Text>
                        ) : null}
                    </Section>

                    <Section title='More' theme={theme}>
                        <ActionButton theme={theme} title='Hardware wallet' onPress={() => this.props.navigation.navigate('HardwareWallet')} />
                        <ActionButton theme={theme} title={`Swap XMR to ${Config.ticker}`} onPress={() => this.props.navigation.navigate('Swap')} />
                    </Section>

                    {this.setupMode && (
                        <View style={{ marginHorizontal: 20, marginTop: 24 }}>
                            <ActionButton theme={theme} title='Done' onPress={() => this.finish()} />
                        </View>
                    )}
                </ScrollView>
            </View>
        );
    }
}
