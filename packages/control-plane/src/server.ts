#!/usr/bin/env node
// Gatekeeper Control Plane server
// Placeholder implementation

import express, { Express } from 'express';

const app: Express = express();
const port = process.env.CONTROL_PLANE_PORT || 4000;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

// TODO: Implement session endpoints
app.post('/v1/sessions', (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet' });
});

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(port, () => {
    console.log(`Control Plane listening on port ${port}`);
  });
}

export { app };