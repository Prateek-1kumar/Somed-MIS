import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'jsdom',
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }] },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  setupFilesAfterEnv: ['@testing-library/jest-dom/jest-globals'],
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
};

export default config;
