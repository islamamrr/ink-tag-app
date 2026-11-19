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
  {
    // The UI shows pictures in the bright screen inks (Converted.display,
    // SCREEN_PALETTE). The measured panel colours look washed out on a phone
    // screen, so only the badge test screen may use them.
    files: ['src/ui/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/core', '**/core/**'],
              importNames: ['PALETTE'],
              message: 'Show pictures in SCREEN_PALETTE (Converted.display), not the measured panel colours.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='preview'][object.property.name='converted']",
          message: 'converted.preview is in the dull measured panel colours. Use converted.display.',
        },
      ],
    },
  },
]);
