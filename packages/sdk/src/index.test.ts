import { describe, it, expect } from 'vitest';
import { SDK_VERSION } from './index.js';

describe('sdk package', () => {
  it('should export version', () => {
    expect(SDK_VERSION).toBe('0.1.0');
  });
});