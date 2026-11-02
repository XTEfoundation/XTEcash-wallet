package io.traaitt.osx;

import android.os.Bundle;

import com.facebook.react.ReactActivity;

public class MainActivity extends ReactActivity {

    /**
     * Returns the name of the main component registered from JavaScript.
     * This is used to schedule rendering of the component.
     */
    @Override
    protected String getMainComponentName() {
        return "XTE";
    }

    /**
     * react-native-screens cannot restore its fragments. When Android recreates
     * the activity (fold/unfold, resize, multi-window, density or theme change,
     * or after process death) the saved fragment state crashes with
     * "Screen fragments should never be restored". Drop the saved state; React
     * Native re-renders the screens from JS anyway.
     * https://github.com/software-mansion/react-native-screens#android
     */
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(null);
    }
}
