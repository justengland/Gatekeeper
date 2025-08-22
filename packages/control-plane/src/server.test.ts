import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './server.js';

describe('control-plane server', () => {
  it('should respond to health check', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', version: '0.1.0' });
  });
});