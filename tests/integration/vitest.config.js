import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',
    
    // Test timeout (30 seconds for integration tests)
    testTimeout: 30000,
    
    // Global setup timeout
    hookTimeout: 15000,
    
    // Run tests sequentially (important for database state)
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true
      }
    },
    
    // Coverage configuration
    coverage: {
      reporter: ['text', 'html', 'json'],
      exclude: [
        'node_modules/',
        'vitest.config.js'
      ]
    },
    
    // Reporter configuration
    reporter: ['verbose'],
    
    // Globals
    globals: true,
    
    // Setup files
    setupFiles: [],
    
    // Test file patterns
    include: ['**/*.test.js'],
    exclude: ['node_modules/**']
  },
  
  // Environment variables for tests
  define: {
    // These can be overridden by actual env vars
    'process.env.PGHOST': JSON.stringify(process.env.PGHOST || 'localhost'),
    'process.env.PGPORT': JSON.stringify(process.env.PGPORT || '5432'),
    'process.env.PGDATABASE': JSON.stringify(process.env.PGDATABASE || 'app'),
    'process.env.PGUSER': JSON.stringify(process.env.PGUSER || 'gatekeeper_admin'),
    'process.env.PGPASSWORD': JSON.stringify(process.env.PGPASSWORD || 'gatekeeper_admin_password_change_in_production')
  }
});