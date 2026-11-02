// Copyright (C) 2018-2019, Zpalmtree
// Copyright (c) 2026, XTE Foundation
//
// Please see the included LICENSE file for more information.

#import "AppDelegate.h"

#import <React/RCTBridge.h>
#import <React/RCTBundleURLProvider.h>
#import <React/RCTLinkingManager.h>
#import <React/RCTRootView.h>

#import <React/RCTAppSetupUtils.h>

#import <RNCPushNotificationIOS.h>
#import <TSBackgroundFetch/TSBackgroundFetch.h>
#import <UserNotifications/UserNotifications.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  RCTAppSetupPrepareApp(application);

  RCTBridge *bridge = [[RCTBridge alloc] initWithDelegate:self launchOptions:launchOptions];

  /* Must match the name in app.json / AppRegistry.registerComponent */
  UIView *rootView = RCTAppSetupDefaultRootView(bridge, @"XTE", nil);

  if (@available(iOS 13.0, *)) {
    rootView.backgroundColor = [UIColor systemBackgroundColor];
  } else {
    rootView.backgroundColor = [UIColor whiteColor];
  }

  self.window = [[UIWindow alloc] initWithFrame:[UIScreen mainScreen].bounds];
  UIViewController *rootViewController = [UIViewController new];
  rootViewController.view = rootView;
  self.window.rootViewController = rootViewController;
  [self.window makeKeyAndVisible];

  /* Background sync: react-native-background-fetch 3.x registers the
     BGTaskScheduler ids listed under BGTaskSchedulerPermittedIdentifiers
     in Info.plist (com.transistorsoft.fetch). */
  [[TSBackgroundFetch sharedInstance] didFinishLaunching];

  /* Local "you received XTE" notifications (react-native-push-notification
     uses @react-native-community/push-notification-ios on iOS). */
  [UNUserNotificationCenter currentNotificationCenter].delegate = self;

  return YES;
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

/* xte:// payment links -> React Native Linking (see src/MainScreen.js) */
- (BOOL)application:(UIApplication *)application
            openURL:(NSURL *)url
            options:(NSDictionary<UIApplicationOpenURLOptionsKey, id> *)options
{
  return [RCTLinkingManager application:application openURL:url options:options];
}

/* Show notifications while the app is in the foreground too */
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler
{
  completionHandler(UNNotificationPresentationOptionSound | UNNotificationPresentationOptionAlert | UNNotificationPresentationOptionBadge);
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))completionHandler
{
  [RNCPushNotificationIOS didReceiveNotificationResponse:response];
  completionHandler();
}

@end
