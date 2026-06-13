import type { Config } from 'jest'

const config: Config = {
  // Run tests in Node environment (no browser needed for main-process logic)
  testEnvironment: 'node',

  // Use ts-jest to transpile TypeScript
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          // Jest tests target the main/shared code, use a permissive config
          strict: true,
          module: 'CommonJS',
          moduleResolution: 'node',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          skipLibCheck: true,
          baseUrl: '.',
          paths: {
            '@shared/*': ['./src/shared/*']
          }
        }
      }
    ]
  },

  // Match test files co-located with source files or in __tests__ dirs
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
    'src/**/*.test.ts',
    'src/**/*.test.tsx'
  ],

  // Exclude renderer tests from the default Jest run
  // (renderer tests would need a DOM environment and are handled separately)
  testPathIgnorePatterns: [
    '/node_modules/',
    '/out/',
    '/dist/'
  ],

  // Module name mapper to support path aliases
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/src/shared/$1'
  },

  // Collect coverage from main process and shared sources
  collectCoverageFrom: [
    'src/main/**/*.ts',
    'src/shared/**/*.ts',
    '!src/**/*.d.ts'
  ],

  // Minimum 100 fast-check iterations is set per-test via fc.configureGlobal
  // in individual test files; no global override needed here
  globals: {}
}

export default config
