// Copyright (c) 2026, XTE Foundation
//
// Please see the included LICENSE file for more information.

import React from 'react';

import { ActivityIndicator, Alert, Linking, ScrollView, Text, TextInput, View } from 'react-native';

import Config from './Config';
import { Globals } from './Globals';
import { activeSwapProvider, CANDIDATES, FINAL_STATES } from './Swap';
import { ActionButton, Section, inputStyle } from './SecurityScreen';
import { CopyButton } from './SharedComponents';

export class SwapScreen extends React.Component {
    static navigationOptions = {
        title: '',
    };

    constructor(props) {
        super(props);

        this.provider = activeSwapProvider();
        this.state = {
            amount: '',
            refundAddress: '',
            quote: null,
            swap: null,
            status: null,
            busy: false,
            accepted: false,
        };
    }

    componentWillUnmount() {
        clearInterval(this.timer);
    }

    get receiveAddress() {
        return Globals.wallet ? Globals.wallet.getPrimaryAddress() : '';
    }

    async getQuote() {
        this.setState({ busy: true, quote: null });

        try {
            const quote = await this.provider.impl.quote(this.provider.cfg, this.state.amount);
            this.setState({ quote });
        } catch (err) {
            Alert.alert('Quote', String(err.message || err));
        } finally {
            this.setState({ busy: false });
        }
    }

    async startSwap() {
        this.setState({ busy: true });

        try {
            const swap = await this.provider.impl.create(
                this.provider.cfg, this.state.amount, this.receiveAddress, this.state.refundAddress,
            );
            this.setState({ swap });
            this.poll();
            this.timer = setInterval(() => this.poll(), 30 * 1000);
        } catch (err) {
            Alert.alert('Swap', String(err.message || err));
        } finally {
            this.setState({ busy: false });
        }
    }

    async poll() {
        if (!this.state.swap) {
            return;
        }

        try {
            const status = await this.provider.impl.status(this.provider.cfg, this.state.swap.id);
            this.setState({ status });

            if (FINAL_STATES.includes(status.status)) {
                clearInterval(this.timer);
            }
        } catch (err) {
            /* keep polling */
        }
    }

    renderUnavailable(theme) {
        return (
            <Section title='Not available yet' theme={theme}>
                <Text style={{ color: theme.slightlyMoreVisibleColour, fontSize: 14 }}>
                    No instant-swap service lists {Config.ticker} right now, so XMR cannot be swapped to{' '}
                    {Config.ticker} inside the wallet yet. This screen turns on as soon as a service lists it.
                    Services that could:
                </Text>
                {CANDIDATES.map((c) => (
                    <Text
                        key={c.name}
                        onPress={() => Linking.openURL(c.url)}
                        style={{ color: theme.primaryColour, fontSize: 14, marginTop: 6 }}
                    >
                        • {c.name}: {c.needs}
                    </Text>
                ))}
            </Section>
        );
    }

    render() {
        const theme = this.props.screenProps.theme;
        const s = this.state;

        return (
            <View style={{ flex: 1, backgroundColor: theme.backgroundColour }}>
                <ScrollView contentContainerStyle={{ paddingTop: 60, paddingBottom: 40 }}>
                    <Text style={{ color: theme.primaryColour, fontSize: 25, marginHorizontal: 20 }}>
                        Swap XMR to {Config.ticker}
                    </Text>

                    {!this.provider ? this.renderUnavailable(theme) : (
                        <Section title={`Via ${this.provider.impl.name}`} theme={theme}>
                            <Text style={{ color: '#c0392b', fontSize: 13 }}>
                                {this.provider.impl.name} is a third-party service. It holds your XMR from the deposit until
                                it pays out {Config.ticker}, sets the rate, and may ask for identification. The XTE
                                Foundation does not run it and cannot refund failed swaps.
                            </Text>
                            <ActionButton
                                theme={theme}
                                title={s.accepted ? 'Understood ✓' : 'I understand'}
                                onPress={() => this.setState({ accepted: true })}
                            />
                            <TextInput
                                style={inputStyle(theme)}
                                placeholder='XMR amount'
                                placeholderTextColor={theme.slightlyMoreVisibleColour}
                                keyboardType='decimal-pad'
                                value={s.amount}
                                onChangeText={(amount) => this.setState({ amount, quote: null })}
                            />
                            <Text style={{ color: theme.slightlyMoreVisibleColour, fontSize: 13 }}>
                                {Config.ticker} goes to this wallet: {this.receiveAddress.slice(0, 16)}…
                            </Text>
                            <TextInput
                                style={inputStyle(theme)}
                                placeholder='XMR refund address (optional)'
                                placeholderTextColor={theme.slightlyMoreVisibleColour}
                                autoCapitalize='none'
                                autoCorrect={false}
                                value={s.refundAddress}
                                onChangeText={(refundAddress) => this.setState({ refundAddress })}
                            />
                            {s.busy && <ActivityIndicator color={theme.primaryColour} />}
                            <ActionButton theme={theme} title='Get quote' disabled={!s.accepted || !s.amount || s.busy} onPress={() => this.getQuote()} />
                            {s.quote && (
                                <View>
                                    <Text style={{ color: theme.primaryColour, fontSize: 16 }}>
                                        You get about {s.quote.toAmount} {Config.ticker}
                                    </Text>
                                    <ActionButton theme={theme} title='Start swap' disabled={s.busy || !!s.swap} onPress={() => this.startSwap()} />
                                </View>
                            )}
                            {s.swap && (
                                <View style={{ marginTop: 10 }}>
                                    <Text style={{ color: theme.primaryColour, fontSize: 15 }}>
                                        Send exactly {s.amount} XMR to:
                                    </Text>
                                    <Text selectable style={{ color: theme.primaryColour, fontSize: 13, marginVertical: 6 }}>
                                        {s.swap.depositAddress}
                                    </Text>
                                    <CopyButton data={s.swap.depositAddress} name='Deposit address' {...this.props} />
                                    <Text style={{ color: theme.slightlyMoreVisibleColour, marginTop: 6 }}>
                                        Swap {s.swap.id}: {s.status ? s.status.status : 'waiting for deposit'}
                                    </Text>
                                </View>
                            )}
                        </Section>
                    )}
                </ScrollView>
            </View>
        );
    }
}
