// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'android/*', 'ios/*'] },
  {
    // src/core stays plain TypeScript so it runs in Jest on a laptop and could
    // become its own package. Native and React code belongs in src/services.
    files: ['src/core/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-native', 'react-native-*', '@shopify/*', 'expo', 'expo-*', '../../services/*', '../../screens/*'],
              message: 'src/core must not import React Native, Expo or app code.',
            },
          ],
        },
      ],
    },
  },
]);
