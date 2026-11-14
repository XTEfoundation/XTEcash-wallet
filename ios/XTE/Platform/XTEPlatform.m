// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
// React Native bindings for XTEPlatform.swift.

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(XTEPlatform, NSObject)

RCT_EXTERN_METHOD(updateWidgetData:(NSString *)json resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(notePendingIncoming:(NSString *)text)
RCT_EXTERN_METHOD(clearWidgetData)
RCT_EXTERN_METHOD(setDynamicShortcuts:(NSString *)json resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(reportShortcutUsed:(NSString *)shortcutId)
RCT_EXTERN_METHOD(consumePendingRoute:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(setHandoff:(NSString *)kind uri:(NSString *)uri)
RCT_EXTERN_METHOD(showPaymentNotification:(NSString *)title body:(NSString *)body hash:(NSString *)hash)
RCT_EXTERN_METHOD(showSendProgress:(NSString *)hash amountText:(NSString *)amountText status:(NSString *)status progress:(double)progress done:(BOOL)done)
RCT_EXTERN_METHOD(cancelSendProgress:(NSString *)hash)
RCT_EXTERN_METHOD(updateSyncActivity:(double)walletHeight networkHeight:(double)networkHeight)
RCT_EXTERN_METHOD(authenticate:(NSString *)title subtitle:(NSString *)subtitle resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

@end
