/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  // server.ts and publisher.ts need a live broker; they are covered by the compose smoke test.
  collectCoverageFrom: ['src/**/*.ts', '!src/server.ts', '!src/publisher.ts'],
  coverageThreshold: { global: { branches: 80, functions: 80, lines: 85 } },
};
