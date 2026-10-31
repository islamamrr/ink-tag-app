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
    },
  ],
};
