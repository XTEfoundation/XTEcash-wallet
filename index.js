// Copyright (C) 2018-2019, Zpalmtree
//
// Please see the included LICENSE file for more information.

import './shim';

import { AppRegistry, Platform } from 'react-native';

import BackgroundFetch from 'react-native-background-fetch';

import { name as appName } from './app.json';

import App from './src/App';
import { initSentry } from './src/Sentry';
import { Globals } from './src/Globals';
import {
    backgroundSync, headlessWalletSync, restoreServiceTask, initBackgroundSync,
} from './src/BackgroundSync';

/* Stub out console.log in production */
if (!__DEV__) {
    console.log = () => {};
}

BackgroundFetch.registerHeadlessTask(async (event) => {
    const taskId = event && event.taskId;
    try {
        await backgroundSync('fetch');
    } catch (error) {
        Globals.logger.addLogMessage("[js] RNBackgroundFetch failed to start: " + error.toString());
    } finally {
        BackgroundFetch.finish(taskId);
    }
});

/* Android: WorkManager periodic sync and the long-restore foreground service */
AppRegistry.registerHeadlessTask('XTEWalletSync', () => headlessWalletSync);
AppRegistry.registerHeadlessTask('XTEWalletRestore', () => restoreServiceTask);

initSentry();

/* iOS relaunches the app in the background for BGAppRefresh/BGProcessing:
   register the handlers before any screen (and the PIN) is shown. */
if (Platform.OS === 'ios') {
    initBackgroundSync().catch(() => {});
}

AppRegistry.registerComponent(appName, () => App);
