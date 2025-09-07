import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test.db';
process.env.SHOPIFY_API_KEY = 'test-api-key';
process.env.SHOPIFY_API_SECRET = 'test-api-secret';

beforeAll(() => {
  console.log('Setting up tests...');
});

afterAll(() => {
  console.log('Cleaning up tests...');
});

beforeEach(() => {
  // Reset any global state before each test
});

afterEach(() => {
  // Clean up after each test
});

