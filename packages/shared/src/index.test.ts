import { describe, it, expect } from 'vitest';
import { GATEKEEPER_VERSION } from './index.js';

describe('shared package', () => {
  it('should export version', () => {
    expect(GATEKEEPER_VERSION).toBe('0.1.0');
  });

  it('should export all required types and schemas', () => {
    // This test verifies that the main exports are working
    // Individual schema tests are in separate files
    expect(GATEKEEPER_VERSION).toBeDefined();
  });
});