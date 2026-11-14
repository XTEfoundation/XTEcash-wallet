// Copyright (C) 2018, Zpalmtree
//
// Please see the included LICENSE file for more information.

import React from 'react';

import moment from 'moment';

import { Text, Platform, ToastAndroid, Alert } from 'react-native';

import { StackActions, NavigationActions } from 'react-navigation';

import {
    validateAddresses, WalletErrorCode, validatePaymentID, prettyPrintAmount,
} from 'traaittcash-wallet-backend';

import * as Qs from 'query-string';

import Config from './Config';

import { Globals } from './Globals';

import { addFee, toAtomic } from './Fee';

export function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toastPopUp(message, short = true) {
    /* IOS doesn't have toast support */
    /* TODO */
    if (Platform.OS === 'ios') {
        return;
    }

    ToastAndroid.show(message, short ? ToastAndroid.SHORT : ToastAndroid.LONG);
}

/* Navigate to a route, resetting the stack, so the user cannot go back.
   We want to do this so when we go from the splash screen to the menu screen,
   the user can't return, and get stuck there. */
export function navigateWithDisabledBack(route, routeParams) {
    return StackActions.reset({
        index: 0,
        actions: [
            NavigationActions.navigate({ 
                routeName: route,
                params: routeParams,
            }),
        ]
    });
}

export function prettyPrintUnixTimestamp(timestamp) {
    return prettyPrintDate(moment(timestamp * 1000));
}

export function prettyPrintDate(date) {
    if (date === undefined) {
        date = moment();
    }

    if (moment().year() === date.year()) {
        return date.format('D MMM, HH:mm');
    }

    return date.format('D MMM, YYYY HH:mm');
}

/**
 * Gets the approximate height of the blockchain at a date.
 *
 * Interpolates between real (height, timestamp) checkpoints from
 * Config.scanHeightCheckpoints. Past the last checkpoint it extrapolates at
 * three times the target block time, so the guess stays at or below the
 * real height: scanning a few extra blocks is cheap, starting past the
 * wallet's first transaction loses it.
 */
export function getApproximateBlockHeight(date) {
    const time = date.getTime() / 1000;
    const checkpoints = Config.scanHeightCheckpoints || [];

    if (checkpoints.length === 0) {
        const difference = (date - Config.chainLaunchTimestamp) / 1000;
        return Math.max(0, Math.floor(difference / (Config.blockTargetTime * 3)));
    }

    if (time <= checkpoints[0][1]) {
        return 0;
    }

    for (let i = 0; i + 1 < checkpoints.length; i++) {
        const [h1, t1] = checkpoints[i];
        const [h2, t2] = checkpoints[i + 1];

        if (time < t2) {
            return Math.max(0, Math.floor(h1 + (h2 - h1) * (time - t1) / (t2 - t1)));
        }
    }

    const [lastHeight, lastTime] = checkpoints[checkpoints.length - 1];

    return Math.floor(lastHeight + (time - lastTime) / (Config.blockTargetTime * 3));
}

/**
 * Safety margin (in blocks, about one day) subtracted from date based scan
 * heights, so a wallet created early on the picked day is still found.
 */
export function scanHeightMargin() {
    return Math.ceil((24 * 60 * 60) / Config.blockTargetTime);
}

/**
 * Converts a date to a scan height. Note, takes a moment date.
 */
export function dateToScanHeight(date) {
    let jsDate = date.toDate();
    const now = new Date();

    if (jsDate > now) {
        jsDate = now;
    }

    return Math.max(0, getApproximateBlockHeight(jsDate) - scanHeightMargin());
}

export function getArrivalTime() {
    const minutes = Config.blockTargetTime >= 60;

    if (minutes) {
        return Math.ceil(Config.blockTargetTime / 60) + ' minutes!';
    } else {
        return Config.blockTargetTime + ' seconds!';
    }
}

export function handleURI(data, navigation) {
    const result = parseURI(data);

    if (!result.valid) {
        Alert.alert(
            'Cannot send transaction',
            result.error,
            [
                {text: 'OK'},
            ]
        );
    } else {
        /* Hop into the transfer stack */
        navigation.navigate('ChoosePayee');
        /* Then navigate to the nested route, if needed */
        navigation.navigate(result.suggestedAction, {...result});
    }
}

export function parseURI(qrData) {
    /* It's a URI, try and get the data from it */
    if (qrData.startsWith(Config.uriPrefix)) {
        /* Remove the xte:// prefix */
        let data = qrData.replace(Config.uriPrefix, '');
        let index = data.indexOf('?');

        /* Doesn't have any params */
        if (index === -1) {
            index = data.length;
        }

        const address = data.substr(0, index);
        const params = Qs.parse(data.substr(index));

        const amount = params.amount;
        const name = params.name;
        let paymentID = params.paymentid;

        if (paymentID) {
            const pidError = validatePaymentID(paymentID);

            /* Payment ID isn't valid. */
            if (pidError.errorCode !== WalletErrorCode.SUCCESS) {
                return {
                    valid: false,
                    error: 'QR Code is invalid',
                };
            }

            /* Both integrated address and payment ID given */
            if (address.length === Config.integratedAddressLength && paymentID.length !== 0) {
                return {
                    valid: false,
                    error: 'QR Code is invalid',
                };
            }
        }

        const addressError = validateAddresses([address], true);

        /* Address isn't valid */
        if (addressError.errorCode !== WalletErrorCode.SUCCESS) {
            return {
                valid: false,
                error: 'QR Code is invalid',
            };
        }

        const amountAtomic = Number(amount);
        let feeInfo = undefined;
        let amountNonAtomic = undefined;

        if (!isNaN(amountAtomic)) {
            amountNonAtomic = amountAtomic / (10 ** Config.decimalPlaces);

            /* Got an amount, can go straight to confirmation, if we have enough balance */
            const [unlockedBalance, lockedBalance] = Globals.wallet.getBalance();

            feeInfo = addFee(amountNonAtomic);

            let [valid, error] = validAmount(feeInfo.original, unlockedBalance);

            if (feeInfo.originalAtomic > unlockedBalance) {
                error = 'Not enough funds available! Needed (including fees): ' +
                        `${prettyPrintAmount(feeInfo.originalAtomic)}, Available: ` +
                        prettyPrintAmount(unlockedBalance);
            }

            if (!valid) {
                return {
                    valid: false,
                    error,
                };
            }
        }
        
        /* No name, need to pick one.. */
        if (!name) {
            return {
                paymentID: paymentID || '',
                address,
                amount: amountNonAtomic ? amountNonAtomic.toString() : undefined,
                suggestedAction: 'NewPayee',
                valid: true,
            }
        }

        const newPayee = {
            nickname: name,
            address: address,
            paymentID: paymentID || '',
        }

        const existingPayee = Globals.payees.find((p) => p.nickname === name);
        
        /* Payee exists already */
        if (existingPayee) {
            /* New payee doesn't match existing payee, get them to enter a new name */
            if (existingPayee.address !== newPayee.address ||
                existingPayee.paymentID !== newPayee.paymentID) { 
                return {
                    paymentID: paymentID || '',
                    address,
                    amount: amountNonAtomic.toString(),
                    suggestedAction: 'NewPayee',
                    valid: true,
                };
            }
        /* Save payee to database for later use */
        } else {
            Globals.addPayee(newPayee);
        }

        if (!amount) {
            return {
                payee: newPayee,
                suggestedAction: 'Transfer',
                valid: true,
            };
        } else {
            return {
                payee: newPayee,
                amount: feeInfo,
                suggestedAction: 'Confirm',
                valid: true,
            };
        }
    /* It's a standard address, try and parse it (or something else) */
    } else {
        const addressError = validateAddresses([qrData], true);

        if (addressError.errorCode !== WalletErrorCode.SUCCESS) {
            return {
                valid: false,
                error: 'QR code is invalid',
            };
        }

        return {
            valid: true,
            address: qrData,
            suggestedAction: 'NewPayee',
        }
    }
}

export function validAmount(amount, unlockedBalance) {
    if (amount === '' || amount === undefined || amount === null) {
        return [false, ''];
    }

    /* Remove commas in input */
    amount = amount.replace(/,/g, '');

    let numAmount = Number(amount);

    if (isNaN(numAmount)) {
        return [false, 'Amount is not a number!'];
    }

    /* Remove fractional component and convert to atomic */
    numAmount = Math.floor(toAtomic(numAmount));

    /* Must be above min send */
    if (numAmount < 1) {
        return [false, 'Amount is below minimum send!'];
    }

    if (numAmount > unlockedBalance) {
        return [false, 'Not enough funds available!'];
    }

    return [true, ''];
}
