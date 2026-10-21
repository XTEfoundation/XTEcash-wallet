// Copyright (C) 2019, Zpalmtree
//
// Please see the included LICENSE file for more information.

import * as Sentry from '@sentry/react-native';

import * as _ from 'lodash';

import Config from './Config';

/**
 * SENTRY_DSN is inlined at bundle time (see babel.config.js).
 * Leave it unset to keep reporting off. Do not commit a DSN.
 */
function readSentryDsn() {
    const value = process.env.SENTRY_DSN;
    return typeof value === 'string' ? value.trim() : '';
}

const sentryDsn = readSentryDsn();
const sentryIsEnabled = !__DEV__ && sentryDsn.startsWith('https://');

export function reportCaughtException(err) {
    /* Sentry doesn't properly report arbitary objects. Convert to string if
       it ain't a string or an error. */
    if (!_.isString(err) && !(err instanceof Error)) {
        err = JSON.stringify(err, null, 4);
    }

    if (sentryIsEnabled) {
        try {
            Sentry.captureException(err);
        } catch (e) {
        }
    }
}

export function initSentry() {
    if (sentryIsEnabled) {
        Sentry.init({
            dsn: sentryDsn,
        });

        Sentry.setRelease('io.traaitt.osx-' + Config.appVersion);
    }
}
