/** @type {import('jest').Config} */
const swc = [
  '@swc/jest',
  {
    jsc: {
      parser: { syntax: 'typescript', tsx: true },
      transform: { react: { runtime: 'automatic' } },
      target: 'es2022',
    },
    module: { type: 'commonjs' },
  },
];

const shared = {
  transform: { '^.+\\.(t|j)sx?$': swc },
  moduleNameMapper: { '^@orderflow/contracts$': '<rootDir>/packages/contracts/src' },
  rootDir: __dirname,
  // ESM-only dependencies (Node loads them via require(esm); Jest needs them transpiled).
  transformIgnorePatterns: ['/node_modules/(?!(content-disposition)/)'],
};

module.exports = {
  projects: [
    {
      ...shared,
      displayName: 'contracts',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/packages/contracts/test/**/*.test.ts'],
    },
    {
      ...shared,
      displayName: 'api',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/packages/api/test/**/*.test.ts'],
      testPathIgnorePatterns: ['\\.int\\.test\\.ts$'],
    },
    {
      ...shared,
      displayName: 'integration',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/packages/api/test/**/*.int.test.ts'],
    },
    {
      ...shared,
      displayName: 'web',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/packages/web/test/**/*.test.ts?(x)'],
      setupFilesAfterEnv: ['<rootDir>/packages/web/test/setup.ts'],
    },
  ],
  collectCoverageFrom: [
    'packages/*/src/**/*.{ts,tsx}',
    '!packages/*/src/**/*.d.ts',
    '!packages/api/src/main.ts',
    '!packages/api/src/simulator/run.ts',
    '!packages/web/src/main.tsx',
  ],
};
