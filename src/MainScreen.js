// Copyright (C) 2018-2019, Zpalmtree
//
// Please see the included LICENSE file for more information.

import React from 'react';
import { PressScale, haptic } from './Feedback';

import FontAwesome from 'react-native-vector-icons/FontAwesome5';

import * as Animatable from 'react-native-animatable';

import QRCode from 'react-native-qrcode-svg';

import PushNotification from 'react-native-push-notification';

import { NavigationActions, NavigationEvents } from 'react-navigation';

import {
    Text, View, Image, TouchableOpacity, Button,
    AppState, Platform, Linking, ScrollView, RefreshControl, Dimensions,
} from 'react-native';

import NetInfo from "@react-native-community/netinfo";

import PushNotificationIOS from '@react-native-community/push-notification-ios';

import { prettyPrintAmount, LogLevel } from 'traaittcash-wallet-backend';

import Config from './Config';

import { Styles } from './Styles';
import { handleURI, toastPopUp } from './Utilities';
import { ProgressBar } from './ProgressBar';
import { saveToDatabase } from './Database';
import { Globals, initGlobals } from './Globals';
import { reportCaughtException } from './Sentry';
import { processBlockOutputs, makePostRequest } from './NativeCode';
import {
    initBackgroundSync, rememberWalletForBackground, claimNotification, maybeStartRestoreService,
} from './BackgroundSync';
import {
    publishWidgetData, updateDynamicShortcuts, showPaymentNotification, trackOutgoing, updateOutgoing,
    isWideLayout, consumePendingRoute, advertiseReceive, shareAddress,
} from './Platform';
import { CopyButton, OneLineText } from './SharedComponents';
import { syncNow } from './SyncNow';
import { coinsToFiat, getCoinPriceFromAPI } from './Currency';

async function init(navigation) {
    Globals.wallet.scanCoinbaseTransactions(Globals.preferences.scanCoinbaseTransactions);
    Globals.wallet.enableAutoOptimization(Globals.preferences.autoOptimize);

    Globals.wallet.on('incomingtx', (transaction) => {
        sendNotification(transaction);
    });

    /* Widgets, Quick Settings tile, watch and outgoing-transaction notifications */
    Globals.wallet.on('heightchange', () => {
        publishWidgetData();
        updateOutgoing();
    });

    Globals.wallet.on('createdtx', (transaction) => {
        if (transaction) {
            trackOutgoing(transaction.hash, transaction.totalAmount());
        }
    });

    /* "Pay <contact>" launcher shortcuts follow the address book */
    updateDynamicShortcuts();
    Globals.updatePayeeFunctions.push(updateDynamicShortcuts);

    Globals.wallet.on('deadnode', () => {
        toastPopUp('Node may be offline, check the settings screen to swap nodes', false);
    });

    Globals.wallet.setLoggerCallback((prettyMessage, message) => {
        Globals.logger.addLogMessage(message);
    });

    Globals.wallet.setLogLevel(LogLevel.DEBUG);

    /* Don't launch if already started */
    if (Globals.backgroundSaveTimer === undefined) {
        Globals.backgroundSaveTimer = setInterval(backgroundSave, Config.walletSaveFrequency);
    }

    /* Use our native C++ func to process blocks (android + iOS XTE module) */
    Globals.wallet.setBlockOutputProcessFunc(processBlockOutputs);

    initGlobals();

    /* View key + height for the view-only background sync. */
    rememberWalletForBackground(Globals.wallet);

    PushNotification.configure({
        onNotification: handleNotification,

        permissions: {
            alert: true,
            badge: true,
            sound: true,
        },

        popInitialNotification: true,

        requestPermissions: true,
    });

    const url = await Linking.getInitialURL();

    if (url) {
        handleURI(url, navigation);
    }

    /* iOS: quick action / notification action / Handoff that cold-started the app */
    const pending = await consumePendingRoute();

    if (pending && pending !== url) {
        handleURI(pending, navigation);
    }

    advertiseReceive(Globals.wallet.getPrimaryAddress());
}

function handleNotification(notification) {
    notification.finish(PushNotificationIOS.FetchResult.NoData);
}

export async function sendNotification(transaction) {
    /* Don't show notifications if disabled */
    if (!Globals.preferences.notificationsEnabled) {
        return;
    }

    /* Don't show notifications in foreground */
    if (AppState.currentState !== 'background') {
        return;
    }

    /* The view-only background sync and the wallet may both see a payment. */
    if (!await claimNotification(transaction.hash)) {
        return;
    }

    /* Android: payments channel, "Show transactions" / "Show receive QR" actions */
    if (showPaymentNotification(transaction)) {
        return;
    }

    PushNotification.localNotification({
        title: 'Incoming transaction received!',
        message: `You were sent ${prettyPrintAmount(transaction.totalAmount(), Config)}`,
        data: JSON.stringify(transaction.hash),
        largeIcon: 'ic_notification_color',
        smallIcon: 'ic_notification_color',
    });
}

/**
 * Sync screen, balance
 */
export class MainScreen extends React.Component {
    static navigationOptions = ({ navigation, screenProps }) => ({
        title: 'Home',
        tabBarOptions: {
            activeBackgroundColor: screenProps.theme.backgroundColour,
            inactiveBackgroundColor: screenProps.theme.backgroundColour,
            activeTintColor: screenProps.theme.primaryColour,
            inactiveTintColor: screenProps.theme.slightlyMoreVisibleColour,
        }
    });

    constructor(props) {
        super(props);

        this.refresh = this.refresh.bind(this);
        this.handleURI = this.handleURI.bind(this);
        this.handleAppStateChange = this.handleAppStateChange.bind(this);
        this.handleNetInfoChange = this.handleNetInfoChange.bind(this);
        this.unsubscribe = () => {};
        this.handleDimensions = this.handleDimensions.bind(this);

        const [unlockedBalance, lockedBalance] = Globals.wallet.getBalance();

        this.state = {
            addressOnly: false,
            unlockedBalance,
            lockedBalance,
            window: Dimensions.get('window'),
        }

        this.updateBalance();

        init(this.props.navigation);

        Globals.wallet.on('transaction', () => {
            this.updateBalance();
        });

        Globals.wallet.on('createdtx', () => {
            this.updateBalance();
        });
    }

    async updateBalance() {
        const tmpPrice = await getCoinPriceFromAPI();

        if (tmpPrice !== undefined) {
            Globals.coinPrice = tmpPrice;
        }

        const [unlockedBalance, lockedBalance] = Globals.wallet.getBalance();

        const coinValue = await coinsToFiat(
            unlockedBalance + lockedBalance, Globals.preferences.currency
        );

        this.setState({
            unlockedBalance,
            lockedBalance,
            coinValue,
        });

        publishWidgetData(true);
    }

    /* Fold/unfold and multi-window resize the window without recreating the activity. */
    handleDimensions({ window }) {
        this.setState({ window });
    }

    handleURI(event) {
        /* Delivered live: drop the copy kept for a cold start. */
        consumePendingRoute();
        handleURI(event, this.props.navigation);
    }

    async resumeSyncing() {
        const netInfo = await NetInfo.fetch();

        if (Globals.preferences.limitData && netInfo.type === 'cellular') {
            return;
        }

        /* Note: start() is a no-op when already started */
        Globals.wallet.start();
    }

    /* Update coin price on coming to foreground */
    async handleAppStateChange(appState) {
        if (appState === 'active') {
            this.updateBalance();
            this.resumeSyncing();
            maybeStartRestoreService();
        }
    }

    async handleNetInfoChange({ type }) {
        if (Globals.preferences.limitData && type === 'cellular') {
            Globals.logger.addLogMessage("Network connection changed to cellular, and we are limiting data. Stopping sync.");
            Globals.wallet.stop();
        } else {
            /* Note: start() is a no-op when already started
             * That said.. it is possible for us to not want to restart here,
            * for example, if we are in the middle of a node swap. Need investigation */
            Globals.logger.addLogMessage("Network connection changed. Restarting sync process if needed.");
            Globals.wallet.start();
        }
    }

    componentDidMount() {
        this.unsubscribe = NetInfo.addEventListener(this.handleNetInfoChange);
        AppState.addEventListener('change', this.handleAppStateChange);
        Linking.addEventListener('url', this.handleURI);
        this.dimensionsSubscription = Dimensions.addEventListener('change', this.handleDimensions);
        initBackgroundSync();
        maybeStartRestoreService();
    }

    componentWillUnmount() {
        NetInfo.removeEventListener('connectionChange', this.handleNetInfoChange);
        AppState.removeEventListener('change', this.handleAppStateChange);
        Linking.removeEventListener('url', this.handleURI);
        if (this.dimensionsSubscription && this.dimensionsSubscription.remove) {
            this.dimensionsSubscription.remove();
        }
        this.unsubscribe();
    }

    /* Pull to refresh: a real sync (gateway, REST fallback); the spinner stays until it
       has finished. A pull while a sync runs joins it instead of cancelling it. */
    async refresh() {
        if (this.refreshPromise) {
            return this.refreshPromise;
        }
        this.setState({ refreshing: true });
        this.refreshPromise = (async () => {
            try {
                /* Paused by "limit data" or a node swap: syncNow syncs directly. */
                await syncNow();
            } finally {
                try {
                    await this.updateBalance();
                } catch (err) {
                    /* price API offline: balance is still updated below */
                }
                const [unlockedBalance, lockedBalance] = Globals.wallet.getBalance();
                publishWidgetData(true);
                this.refreshPromise = undefined;
                this.setState({
                    refreshing: false,
                    unlockedBalance,
                    lockedBalance,
                    txVersion: (this.state.txVersion || 0) + 1,
                });
            }
        })();
        return this.refreshPromise;
    }

    render() {
        /* If you touch the address component, it will hide the other stuff.
           This is nice if you want someone to scan the QR code, but don't
           want to display your balance. */
        return(
            <ScrollView
                refreshControl={
                    <RefreshControl
                        refreshing={!!this.state.refreshing}
                        onRefresh={this.refresh}
                        title='Syncing...'
                        titleColor={this.props.screenProps.theme.slightlyMoreVisibleColour}
                        tintColor={this.props.screenProps.theme.primaryColour}
                        colors={[this.props.screenProps.theme.primaryColour]}
                        progressBackgroundColor={this.props.screenProps.theme.backgroundColour}
                    />
                }
                style={{
                    backgroundColor: this.props.screenProps.theme.backgroundColour,
                }}
                /* Content is exactly one screen high: keep the pull gesture alive anyway. */
                alwaysBounceVertical={true}
                contentContainerStyle={{
                    flexGrow: 1,
                }}
            >
                <NavigationEvents
                    onWillFocus={(payload) => {
                        if (payload && payload.action && payload.action.params && payload.action.params.reloadBalance) {
                            this.updateBalance();
                        }
                        /* Receive widget, tile, shortcut or notification action */
                        if (payload && payload.action && payload.action.params && payload.action.params.showAddress) {
                            this.setState({ addressOnly: true });
                        }
                    }}
                />
                <View style={{ flexDirection: isWideLayout(this.state.window) ? 'row' : 'column' }}>
                <View style={{
                    justifyContent: 'space-around',
                    height: this.state.window.height - 73,
                    flex: isWideLayout(this.state.window) ? 1 : undefined,
                }}>
                    <View style={{ 
                        height: '20%', 
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        margin: 10,
                        borderRadius: 10,
                        opacity: this.state.addressOnly ? 0 : 100,
                    }}>
                        <BalanceComponent
                            unlockedBalance={this.state.unlockedBalance}
                            lockedBalance={this.state.lockedBalance}
                            coinValue={this.state.coinValue}
                            {...this.props}
                        />
                    </View>

                    <PressScale hapticKind='selection' onPress={() => this.setState({ addressOnly: !this.state.addressOnly })}>
                        <AddressComponent {...this.props}/>
                    </PressScale>

                    <View style={{ opacity: this.state.addressOnly ? 0 : 100, flex: 1 }}>
                        <SyncComponent {...this.props}/>
                    </View>
                </View>
                {/* Second pane on unfolded foldables / tablets */}
                {isWideLayout(this.state.window) && !this.state.addressOnly &&
                    <RecentTransactionsPane
                        version={this.state.txVersion}
                        height={this.state.window.height - 73}
                        unlockedBalance={this.state.unlockedBalance}
                        {...this.props}
                    />
                }
                </View>
            </ScrollView>
        );
    }
}

/* Display address, and QR code */
class AddressComponent extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            address: Globals.wallet.getPrimaryAddress(),
        };
    }

    render() {
        return(
            <View style={{ alignItems: 'center' }}>
                <Text style={[Styles.centeredText, {
                    color: this.props.screenProps.theme.primaryColour,
                    fontSize: 20,
                    marginBottom: 15,
                }]}>
                    Your Wallet Address:
                </Text>

                <View style={{ padding: 5, backgroundColor: this.props.screenProps.theme.qrCode.backgroundColour }}>
                    <QRCode
                        value={this.state.address}
                        size={200}
                        backgroundColor={this.props.screenProps.theme.qrCode.backgroundColour}
                        color={this.props.screenProps.theme.qrCode.foregroundColour}
                    />
                </View>

                <Text style={[Styles.centeredText, {
                    color: this.props.screenProps.theme.primaryColour,
                    fontSize: 15,
                    marginTop: 10,
                    marginRight: 20,
                    marginLeft: 20,
                }]}>
                    {this.state.address}
                </Text>

                <CopyButton
                    data={this.state.address}
                    name='Address'
                    {...this.props}
                />

                <View style={{ marginTop: 5 }}>
                    <Button
                        title='Share'
                        onPress={() => shareAddress(this.state.address)}
                        color={this.props.screenProps.theme.buttonThemeColour}
                    />
                </View>
            </View>
        );
    }
}

/**
 * Balance component at top of screen
 */
class BalanceComponent extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            expandedBalance: false,
        };

        this.balanceRef = (ref) => this.balance = ref;
        this.valueRef = (ref) => this.value = ref;
    }

    componentWillReceiveProps(nextProps) {
        if (nextProps.unlockedBalance !== this.props.unlockedBalance ||
            nextProps.lockedBalance !== this.props.lockedBalance) {
            this.balance.bounce(800);
        }

        if (nextProps.coinValue !== this.props.coinValue) {
            this.value.bounce(800);
        }
    }

    render() {
        const compactBalance = <OneLineText
                                     style={{ color: this.props.lockedBalance === 0 ? this.props.screenProps.theme.primaryColour : 'orange', fontSize: 35}}
                                     onPress={() => this.setState({
                                         expandedBalance: !this.state.expandedBalance
                                     })}
                                >
                                     {prettyPrintAmount(this.props.unlockedBalance + this.props.lockedBalance, Config)}
                               </OneLineText>;

        const lockedBalance = <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                                    <FontAwesome name={'lock'} size={22} color={'orange'} style={{marginRight: 7}}/>
                                    <OneLineText style={{ color: 'orange', fontSize: 25}}
                                          onPress={() => this.setState({
                                             expandedBalance: !this.state.expandedBalance
                                          })}>
                                        {prettyPrintAmount(this.props.lockedBalance, Config)}
                                    </OneLineText>
                              </View>;

        const unlockedBalance = <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                                    <FontAwesome name={'unlock'} size={22} color={this.props.screenProps.theme.primaryColour} style={{marginRight: 7}}/>
                                    <OneLineText style={{ color: this.props.screenProps.theme.primaryColour, fontSize: 25}}
                                          onPress={() => this.setState({
                                             expandedBalance: !this.props.expandedBalance
                                          })}>
                                        {prettyPrintAmount(this.props.unlockedBalance, Config)}
                                    </OneLineText>
                                </View>;

        const expandedBalance = <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                                    {unlockedBalance}
                                    {lockedBalance}
                                </View>;

        return(
            <View style={{flex: 1, padding: 20, justifyContent: 'center', alignItems: 'center'}}>
                    <Text style={{ color: this.props.screenProps.theme.notVeryVisibleColour, fontSize: 15 }}>
                        TOTAL BALANCE
                    </Text>

                    <Animatable.View ref={this.balanceRef}>
                        {this.state.expandedBalance ? expandedBalance : compactBalance}
                    </Animatable.View>

                    <Animatable.Text
                        ref={this.valueRef}
                        style={{ color: this.props.screenProps.theme.slightlyMoreVisibleColour, fontSize: 20 }}
                    >
                        {this.props.coinValue}
                    </Animatable.Text>
            </View>
        );
    }
}

/**
 * Right-hand pane of the two-pane layout (width >= 600 dp): the latest transactions.
 */
class RecentTransactionsPane extends React.Component {
    render() {
        let txs = [];
        try {
            txs = Globals.wallet.getTransactions(0, 12, false);
        } catch (err) {
            txs = [];
        }
        const theme = this.props.screenProps.theme;
        return(
            <View style={{ flex: 1, height: this.props.height, paddingTop: 40, paddingHorizontal: 16 }}>
                <Text style={{ color: theme.primaryColour, fontSize: 20, fontWeight: 'bold', marginBottom: 10 }}>
                    Recent transactions
                </Text>
                {txs.length === 0 &&
                    <Text style={{ color: theme.slightlyMoreVisibleColour }}>No transactions yet</Text>
                }
                {txs.map((tx) => {
                    const amount = tx.totalAmount();
                    return(
                        <PressScale
                            key={tx.hash}
                            hapticKind='selection'
                            onPress={() => this.props.navigation.navigate('Transactions')}
                            style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}
                        >
                            <Text style={{ color: theme.slightlyMoreVisibleColour }}>
                                {tx.timestamp ? new Date(tx.timestamp * 1000).toLocaleString() : 'Unconfirmed'}
                            </Text>
                            <Text style={{ color: amount >= 0 ? theme.secondaryColour : theme.primaryColour, fontWeight: 'bold' }}>
                                {amount >= 0 ? '+' : ''}{prettyPrintAmount(amount, Config)}
                            </Text>
                        </PressScale>
                    );
                })}
            </View>
        );
    }
}

/**
 * Sync status at bottom of screen
 */
class SyncComponent extends React.Component {
    constructor(props) {
        super(props);

        const [walletHeight, localHeight, networkHeight] = Globals.wallet.getSyncStatus();

        this.state = {
            walletHeight,
            localHeight,
            networkHeight,
            progress: 0,
            percent: '0.00',
            /* 'syncing' | 'synced' | 'error' - derived from heights and node events. */
            status: 'syncing',
            lastSynced: undefined,
            connected: true,
        };

        this.updateSyncStatus = this.updateSyncStatus.bind(this);
        this.poll = this.poll.bind(this);
        this.onDisconnect = () => this.setState({ connected: false, status: 'error' });
        this.onConnect = () => this.setState({ connected: true }, this.poll);
        this.onSync = () => this.poll();

        this.syncRef = (ref) => this.sync = ref;
    }

    updateSyncStatus(walletHeight, localHeight, networkHeight) {
        /* Since we update the network height in intervals, and we update wallet
           height by syncing, occasionaly wallet height is > network height.
           Fix that here. */
        if (walletHeight > networkHeight && networkHeight !== 0 && networkHeight + 10 > walletHeight) {
            networkHeight = walletHeight;
        }

        /* Don't divide by zero */
        let progress = networkHeight === 0 ? 100 : walletHeight / networkHeight;

        if (progress > 1) {
            progress = 1;
        }

        let percent = 100 * progress;

        /* Prevent bar looking full when it's not */
        if (progress > 0.97 && progress < 1) {
            progress = 0.97;
        }

        /* Prevent 100% when just under */
        if (percent > 99.99 && percent < 100) {
            percent = 99.99;
        } else if (percent > 100) {
            percent = 100;
        }

        const justSynced = progress === 1 && this.state.progress !== 1;

        /* Synced = wallet caught up with the node (one block of slack for the
           height poll interval). Error = the node is unreachable ('disconnect'). */
        const caughtUp = networkHeight > 0 && walletHeight + 1 >= networkHeight;
        let status = caughtUp ? 'synced' : 'syncing';
        if (!this.state.connected) {
            status = 'error';
        }

        this.setState({
            walletHeight,
            localHeight,
            networkHeight,
            progress,
            percent: percent.toFixed(2),
            status,
            lastSynced: caughtUp ? new Date() : this.state.lastSynced,
        }, () => { if (justSynced && this.sync) { this.sync.bounce(800) } });
    }

    /* 'heightchange' only fires when blocks arrive: also poll, so the state is
       right after pull-to-refresh, background sync, gateway/REST fallback and
       when the wallet is already synced on open. */
    poll() {
        if (Globals.wallet) {
            const [walletHeight, localHeight, networkHeight] = Globals.wallet.getSyncStatus();
            this.updateSyncStatus(walletHeight, localHeight, networkHeight);
        }
    }

    componentDidMount() {
        Globals.wallet.on('heightchange', this.updateSyncStatus);
        Globals.wallet.on('disconnect', this.onDisconnect);
        Globals.wallet.on('connect', this.onConnect);
        Globals.wallet.on('sync', this.onSync);
        Globals.wallet.on('desync', this.onSync);
        this.poll();
        this.pollTimer = setInterval(this.poll, 3000);
    }

    componentWillUnmount() {
        clearInterval(this.pollTimer);
        if (Globals.wallet) {
            Globals.wallet.removeListener('heightchange', this.updateSyncStatus);
            Globals.wallet.removeListener('disconnect', this.onDisconnect);
            Globals.wallet.removeListener('connect', this.onConnect);
            Globals.wallet.removeListener('sync', this.onSync);
            Globals.wallet.removeListener('desync', this.onSync);
        }
    }

    statusText() {
        const last = this.state.lastSynced
            ? ` · ${this.state.lastSynced.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : '';
        if (this.state.status === 'synced') {
            return `Synced${last}`;
        }
        if (this.state.status === 'error') {
            return `Node not reachable - retrying${last}`;
        }
        return 'Syncing…';
    }

    render() {
        return(
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', bottom: 20, position: 'absolute', left: 0, right: 0 }}>
                <Animatable.Text ref={this.syncRef} style={{
                    color: this.props.screenProps.theme.slightlyMoreVisibleColour,
                }}>
                    {this.state.walletHeight} / {this.state.networkHeight} - {this.state.percent}%
                </Animatable.Text>
                <Text style={{
                    color: this.state.status === 'error' ? '#e05252' : this.props.screenProps.theme.slightlyMoreVisibleColour,
                    fontSize: 12,
                    marginTop: 4,
                }}>
                    {this.statusText()}
                </Text>
                <ProgressBar
                    progress={this.state.progress}
                    style={{justifyContent: 'flex-end', alignItems: 'center', width: 300, marginTop: 10}}
                    {...this.props}
                />
            </View>
        );
    }
}

/**
 * Save wallet in background
 */
async function backgroundSave() {
    Globals.logger.addLogMessage('Saving wallet...');

    try {
        await saveToDatabase(Globals.wallet);
        Globals.logger.addLogMessage('Save complete.');
        rememberWalletForBackground(Globals.wallet);
    } catch (err) {
        reportCaughtException(err);
        Globals.logger.addLogMessage('Failed to background save: ' + err);
    }
}
