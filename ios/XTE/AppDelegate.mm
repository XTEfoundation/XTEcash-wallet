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

/* Swift side: widgets, Live Activities, quick actions, Handoff, watch (ios/XTE/Platform) */
/* The generated header skips @import in Objective-C++, so import its frameworks first. */
#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <WatchConnectivity/WatchConnectivity.h>
#import "XTE-Swift.h"

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
  [XTEPaymentNotifications installCategory];

  /* Apple Watch companion: the watch app reads the public snapshot over WatchConnectivity. */
  [XTEPaymentNotifications activateWatch];

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

/* Home Screen quick actions (static ones in Info.plist, "Pay <contact>" set from JS).
   Also called after a cold start, before JS listens; the route is kept for
   NativeModules.XTEPlatform.consumePendingRoute(). */
- (void)application:(UIApplication *)application
    performActionForShortcutItem:(UIApplicationShortcutItem *)shortcutItem
               completionHandler:(void (^)(BOOL succeeded))completionHandler
{
  NSURL *url = [XTEPaymentNotifications routeURLForShortcut:shortcutItem];
  if (url) {
    [XTERouteDispatcher open:url];
  }
  completionHandler(url != nil);
}

/* Handoff (receive / send continued from another device) and universal links */
- (BOOL)application:(UIApplication *)application
    continueUserActivity:(NSUserActivity *)userActivity
      restorationHandler:(void (^)(NSArray<id<UIUserActivityRestoring>> *restorableObjects))restorationHandler
{
  NSURL *url = [XTEPaymentNotifications routeURLForActivity:userActivity];
  if (url) {
    [XTERouteDispatcher open:url];
    return YES;
  }
  return [RCTLinkingManager application:application
                   continueUserActivity:userActivity
                     restorationHandler:restorationHandler];
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
  /* Payment notifications: "Show transactions" / "Show receive QR" actions */
  NSURL *route = [XTEPaymentNotifications routeURLForResponse:response];
  if (route) {
    [XTERouteDispatcher open:route];
    completionHandler();
    return;
  }
  [RNCPushNotificationIOS didReceiveNotificationResponse:response];
  completionHandler();
}

/* Privacy cover for the app switcher snapshot (Settings > Security >
   "Hide screen in app switcher"). The flag is set by NativeModules.XTESecurity. */
static const NSInteger XTEPrivacyCoverTag = 0x7e7e;

- (void)applicationWillResignActive:(UIApplication *)application
{
  if (![[NSUserDefaults standardUserDefaults] boolForKey:@"XTEScreenProtection"] || !self.window) {
    return;
  }
  if ([self.window viewWithTag:XTEPrivacyCoverTag]) {
    return;
  }
  UIVisualEffectView *cover = [[UIVisualEffectView alloc]
      initWithEffect:[UIBlurEffect effectWithStyle:UIBlurEffectStyleDark]];
  cover.frame = self.window.bounds;
  cover.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  cover.tag = XTEPrivacyCoverTag;
  [self.window addSubview:cover];
}

- (void)applicationDidBecomeActive:(UIApplication *)application
{
  [[self.window viewWithTag:XTEPrivacyCoverTag] removeFromSuperview];
}

@end
