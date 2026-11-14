// Copyright (c) 2026, TRRXITTE Int., incorporate. Licensed under AGPL-3.0.
//
// Subtle interaction feedback: haptics (UIFeedbackGenerator on iOS,
// performHapticFeedback on Android, via NativeModules.XTEPlatform) and small
// spring animations that are skipped when the system "reduce motion" setting is on.

import * as React from 'react';
import { AccessibilityInfo, Animated, NativeModules, Pressable } from 'react-native';

let reduceMotion = false;
try {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduceMotion = !!v; }).catch(() => {});
    AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => { reduceMotion = !!v; });
} catch (e) { /* tests / old platforms */ }

export function isReduceMotion() {
    return reduceMotion;
}

/** kind: 'light' | 'selection' | 'success' | 'warning' */
export function haptic(kind = 'light') {
    try {
        const m = NativeModules.XTEPlatform;
        if (m && m.haptic) {
            m.haptic(kind);
        }
    } catch (e) { /* no haptics available */ }
}

/** Wraps a handler so it ticks before running. */
export function withHaptic(fn, kind = 'selection') {
    return (...args) => {
        haptic(kind);
        return fn ? fn(...args) : undefined;
    };
}

/** Press-in/out spring scale for any touchable (spread the handlers on it). */
export function usePressScale(to = 0.97) {
    const scale = React.useRef(new Animated.Value(1)).current;
    const spring = (v) => {
        if (reduceMotion) {
            scale.setValue(1);
            return;
        }
        Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: v === 1 ? 6 : 0 }).start();
    };
    return {
        style: { transform: [{ scale }] },
        onPressIn: () => spring(to),
        onPressOut: () => spring(1),
    };
}

/** Pressable with a subtle press-scale and a haptic tick. */
export function PressScale({ onPress, onLongPress, style, children, hapticKind = 'light', disabled, ...rest }) {
    const p = usePressScale();
    return (
        <Pressable
            onPress={onPress && ((...a) => { haptic(hapticKind); onPress(...a); })}
            onLongPress={onLongPress}
            onPressIn={p.onPressIn}
            onPressOut={p.onPressOut}
            disabled={disabled}
            {...rest}
        >
            <Animated.View style={[style, p.style]}>{children}</Animated.View>
        </Pressable>
    );
}

/** Pops (spring) whenever `active` changes, e.g. a checkmark or toggled icon. */
export function PopOnChange({ active, children, style }) {
    const scale = React.useRef(new Animated.Value(1)).current;
    const first = React.useRef(true);
    React.useEffect(() => {
        if (first.current) {
            first.current = false;
            return;
        }
        if (reduceMotion) {
            return;
        }
        scale.setValue(0.6);
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 12 }).start();
    }, [active]);
    return <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>;
}

/** Switch that ticks on change (the native thumb animation stays as is). */
export function HapticSwitch({ onValueChange, ...rest }) {
    const { Switch } = require('react-native');
    return <Switch {...rest} onValueChange={onValueChange && ((v) => { haptic('selection'); onValueChange(v); })} />;
}
