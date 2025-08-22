import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './server.js';

describe('agent server', () => {
  it('should respond to health check with provider details', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    
    // Verify the response structure includes provider information
    expect(response.body).toMatchObject({
      status: expect.stringMatching(/^(ok|degraded|down)$/),
      timestamp: expect.any(String),
      correlationId: expect.any(String),
      details: expect.objectContaining({
        provider: expect.objectContaining({
          type: 'postgres',
          version: expect.any(String)
        })
      })
    });
    
    // For a healthy system, we expect 'ok' status
    if (response.body.status === 'ok') {
      expect(response.body.details).toHaveProperty('setupValidation');
      expect(response.body.details).toHaveProperty('poolStats');
    }
  });
});