// Copyright (c) 2026, XTE Foundation
//
// Please see the included LICENSE file for more information.
//
// Full-screen lock shown over the whole app when auto-lock fires
// (Settings > Security & Backup > Auto-lock). Covers every tab, so it cannot
// be skipped by switching screens.

import React from 'react';

import { AppState, Platform, Text, TouchableOpacity, View } from 'react-native';

import PINCode from '@haskkor/react-native-pincode';
import FingerprintScanner from 'react-native-fingerprint-scanner';

import Config from './Config';
import { Globals } from './Globals';
import { noteAppState, newCompromisedIndicators, acknowledgeCompromised } from './Security';

export class LockOverlay extends React.Component {
    constructor(props) {
        super(props);

        this.state = { locked: false, usePin: false, warning: null };
        this.onAppState = this.onAppState.bind(this);
    }

    async componentDidMount() {
        this.subscription = AppState.addEventListener('change', this.onAppState);

        const reasons = await newCompromisedIndicators();

        if (reasons.length > 0) {
            this.setState({ warning: reasons });
        }
    }

    componentWillUnmount() {
        if (this.subscription && this.subscription.remove) {
            this.subscription.remove();
        } else {
            AppState.removeEventListener('change', this.onAppState);
        }
    }

    onAppState(state) {
        const due = noteAppState(state);

        if (due && Globals.wallet && Globals.preferences.authenticationMethod !== 'none') {
            this.setState({ locked: true, usePin: Globals.preferences.authenticationMethod !== 'hardware-auth' }, () => {
                if (!this.state.usePin) {
                    this.biometric();
                }
            });
        }
    }

    async biometric() {
        try {
            await FingerprintScanner.authenticate({
                description: `Unlock your ${Config.appName} wallet`,
                fallbackEnabled: true,
            });
            this.setState({ locked: false });
        } catch (err) {
            this.setState({ usePin: true });
        } finally {
            FingerprintScanner.release();
        }
    }

    render() {
        const theme = this.props.theme;

        if (this.state.warning) {
            return (
                <View style={[overlay, { backgroundColor: theme.backgroundColour, padding: 30, justifyContent: 'center' }]}>
                    <Text style={{ color: '#c0392b', fontSize: 22, fontWeight: 'bold' }}>
                        {Platform.OS === 'ios' ? 'Jailbreak detected' : 'Root detected'}
                    </Text>
                    <Text style={{ color: theme.primaryColour, fontSize: 15, marginTop: 12 }}>
                        On a {Platform.OS === 'ios' ? 'jailbroken' : 'rooted'} device other apps can read the wallet
                        keys. Use another device for larger amounts.
                    </Text>
                    <Text style={{ color: theme.slightlyMoreVisibleColour, fontSize: 12, marginTop: 12 }}>
                        {this.state.warning.join('\n')}
                    </Text>
                    <TouchableOpacity
                        onPress={() => { acknowledgeCompromised(this.state.warning); this.setState({ warning: null }); }}
                        style={{ marginTop: 24, borderWidth: 1, borderColor: theme.primaryColour, borderRadius: 8, padding: 12 }}
                    >
                        <Text style={{ color: theme.primaryColour, textAlign: 'center' }}>I understand the risk</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        if (!this.state.locked) {
            return null;
        }

        return (
            <View style={[overlay, { backgroundColor: theme.backgroundColour }]}>
                {this.state.usePin ? (
                    <PINCode
                        status={'enter'}
                        finishProcess={() => this.setState({ locked: false })}
                        subtitleEnter={'to unlock your wallet'}
                        passwordLength={6}
                        touchIDDisabled={true}
                        colorPassword={theme.primaryColour}
                        stylePinCodeColorSubtitle={theme.primaryColour}
                        stylePinCodeColorTitle={theme.primaryColour}
                        stylePinCodeButtonNumber={theme.pinCodeForegroundColour}
                        numbersButtonOverlayColor={theme.secondaryColour}
                        stylePinCodeDeleteButtonColorShowUnderlay={theme.primaryColour}
                        stylePinCodeDeleteButtonColorHideUnderlay={theme.primaryColour}
                        colorCircleButtons={theme.pinCodeBackgroundColour}
                    />
                ) : (
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: theme.primaryColour, fontSize: 22 }}>{Config.appName} is locked</Text>
                        <TouchableOpacity onPress={() => this.biometric()} style={{ marginTop: 24 }}>
                            <Text style={{ color: theme.primaryColour, textDecorationLine: 'underline' }}>Unlock</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => this.setState({ usePin: true })} style={{ marginTop: 16 }}>
                            <Text style={{ color: theme.slightlyMoreVisibleColour, textDecorationLine: 'underline' }}>Use PIN</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        );
    }
}

const overlay = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    elevation: 1000,
};
