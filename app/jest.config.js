/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      // src/core is plain TypeScript: tested on Node, no phone or badge needed.
      displayName: 'core',
      preset: 'jest-expo',
      testEnvironment: 'node',
      // Slower laptops (and Windows timers) need more than Jest's 5 s default.
      testTimeout: 30_000,
      testMatch: ['<rootDir>/test/**/*.test.ts'],
      testPathIgnorePatterns: ['\\.skia\\.test\\.ts$'],
    },
    {
      // The Skia scene renderer, on CanvasKit (Skia's WebAssembly build).
      displayName: 'skia',
      preset: 'jest-expo',
      testEnvironment: '<rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js',
      setupFiles: ['<rootDir>/node_modules/@shopify/react-native-skia/jestSetup.js'],
      testTimeout: 60_000,
      testMatch: ['<rootDir>/test/**/*.skia.test.ts'],
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@shopify/react-native-skia))',
      ],
    },
  ],
};
