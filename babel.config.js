module.exports = {
  presets: ['module:metro-react-native-babel-preset'],
  plugins: [
    ['transform-inline-environment-variables', {
      include: ['SENTRY_DSN'],
    }],
    // Must stay last. react-navigation-tabs' bottom bar imports Reanimated.
    'react-native-reanimated/plugin',
  ],
};
