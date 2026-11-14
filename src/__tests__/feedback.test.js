import { NativeModules } from 'react-native';
import { haptic, withHaptic } from '../Feedback';

describe('feedback', () => {
    test('haptic calls the native module and never throws without it', () => {
        NativeModules.XTEPlatform = { haptic: jest.fn() };
        haptic('success');
        expect(NativeModules.XTEPlatform.haptic).toHaveBeenCalledWith('success');
        const fn = jest.fn(() => 7);
        expect(withHaptic(fn)('x')).toBe(7);
        expect(NativeModules.XTEPlatform.haptic).toHaveBeenLastCalledWith('selection');
        expect(fn).toHaveBeenCalledWith('x');
        NativeModules.XTEPlatform = undefined;
        expect(() => haptic()).not.toThrow();
    });
});
