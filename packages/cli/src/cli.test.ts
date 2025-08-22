import { describe, it, expect } from 'vitest';
import { program } from './cli.js';

describe('cli', () => {
  it('should have correct name', () => {
    expect(program.name()).toBe('gk');
  });

  it('should have correct version', () => {
    expect(program.version()).toBe('0.1.0');
  });
});