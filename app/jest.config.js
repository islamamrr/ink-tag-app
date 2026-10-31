/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      // src/core is plain TypeScript: tested on Node, no phone or badge needed.
      displayName: 'core',
      preset: 'jest-expo',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/**/*.test.ts'],
    },
  ],
};
