module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  collectCoverageFrom: [
    'src/engine/**/*.ts',
    'src/resolver/**/*.ts',
    '!src/**/*.d.ts'
  ],
  moduleNameMapper: {
    '^obsidian$': '<rootDir>/__mocks__/obsidian.ts'
  }
};
