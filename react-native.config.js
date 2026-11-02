module.exports = {
    dependencies: {
        'react-native-background-fetch': {
            platforms: {
                // Android links it manually (android/settings.gradle) because of
                // the patched Gradle setup; iOS uses normal CocoaPods autolinking.
                android: null
            }
        }
    }
};
