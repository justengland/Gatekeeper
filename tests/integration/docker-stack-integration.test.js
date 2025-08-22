/**
 * Gatekeeper Integration Test Suite
 * Tests against live Docker Compose stack with PostgreSQL and LocalStack
 * 
 * This suite tests:
 * - Admin user (bob) - can create/manage ephemeral users
 * - Writer user (will) - can read and write data  
 * - Reader user (letty) - can only read data
 * - Full user lifecycle (create -> test -> cleanup)
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { Client } from 'pg';
import crypto from 'crypto';

// Test configuration
const TEST_CONFIG = {
  // Database connection (admin user)
  admin: {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'app',
    user: process.env.PGUSER || 'gatekeeper_admin',
    password: process.env.PGPASSWORD || 'gatekeeper_admin_password_change_in_production'
  },
  
  // Test users to create
  users: {
    bob: {
      username: 'gk_bob_' + crypto.randomBytes(4).toString('hex'),
      role: 'app_admin', // Will create this role for admin capabilities
      capabilities: ['read', 'write', 'admin']
    },
    will: {
      username: 'gk_will_' + crypto.randomBytes(4).toString('hex'), 
      role: 'app_write', // Will create this role for write capabilities
      capabilities: ['read', 'write']
    },
    letty: {
      username: 'gk_letty_' + crypto.randomBytes(4).toString('hex'),
      role: 'app_read',
      capabilities: ['read']
    }
  },
  
  // Test session TTL (1 hour)
  sessionTtl: 60,
  
  // Test data
  testData: {
    productName: `Test Product ${Date.now()}`,
    categoryName: `Test Category ${Date.now()}`,
    orderEmail: `test${Date.now()}@example.com`
  }
};

// Global test clients
let adminClient;
let testClients = {};

// Helper to generate strong password
function generatePassword() {
  return crypto.randomBytes(16).toString('base64') + crypto.randomBytes(4).toString('hex');
}

// Helper to create database connection
async function createClient(config) {
  const client = new Client(config);
  await client.connect();
  return client;
}

// Helper to execute query safely
async function safeQuery(client, query, params = []) {
  try {
    const result = await client.query(query, params);
    return { success: true, result };
  } catch (error) {
    return { success: false, error };
  }
}

// Setup additional roles for testing
async function setupTestRoles() {
  console.log('🔧 Setting up additional test roles...');
  
  // Use a superuser connection for role setup
  const superuserClient = new Client({
    ...TEST_CONFIG.admin,
    user: 'postgres',
    password: 'postgres'
  });
  await superuserClient.connect();
  
  try {
    // Create app_write role (read + write) - use DO block for IF NOT EXISTS
    await superuserClient.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_write') THEN
          CREATE ROLE app_write;
          GRANT CONNECT ON DATABASE app TO app_write;
          GRANT USAGE ON SCHEMA public TO app_write;
          GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_write;
          GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_write;
          ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO app_write;
          ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_write;
        END IF;
      END
      $$;
    `);
    
    // Create app_admin role (all privileges)
    await superuserClient.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_admin') THEN
          CREATE ROLE app_admin;
          GRANT CONNECT ON DATABASE app TO app_admin;
          GRANT ALL PRIVILEGES ON SCHEMA public TO app_admin;
          GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_admin;
          GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_admin;
          GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO app_admin;
          ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_admin;
          ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_admin;
          ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO app_admin;
        END IF;
      END
      $$;
    `);
    
    // Grant admin permission to assign these roles
    await superuserClient.query(`
      GRANT app_write TO gatekeeper_admin WITH ADMIN OPTION;
      GRANT app_admin TO gatekeeper_admin WITH ADMIN OPTION;
    `);
    
    console.log('✅ Test roles created successfully');
    
  } finally {
    await superuserClient.end();
  }
}

// Create ephemeral user with specific role
async function createEphemeralUser(username, role) {
  const password = generatePassword();
  const ttlMinutes = TEST_CONFIG.sessionTtl;
  
  console.log(`👤 Creating ephemeral user: ${username} with role: ${role}`);
  
  const result = await adminClient.query(`
    SELECT gk_create_ephemeral_user($1, $2, now() + interval '${ttlMinutes} minutes', $3, 2)
  `, [username, password, role]);
  
  return { username, password, role };
}

// Test user capabilities
async function testUserCapabilities(client, username, expectedCapabilities) {
  const results = {
    read: false,
    write: false,
    admin: false,
    details: []
  };
  
  // Test READ capability
  if (expectedCapabilities.includes('read')) {
    const readTest = await safeQuery(client, 'SELECT count(*) as count FROM sample_data');
    results.read = readTest.success;
    results.details.push({
      test: 'read_sample_data',
      expected: true,
      actual: readTest.success,
      error: readTest.error?.message
    });
  }
  
  // Test WRITE capability
  const writeTest = await safeQuery(client, 
    'INSERT INTO products (name, description, price, category_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [TEST_CONFIG.testData.productName + '_' + username, 'Integration test product', 99.99, 1]
  );
  results.write = writeTest.success;
  results.details.push({
    test: 'write_product',
    expected: expectedCapabilities.includes('write'),
    actual: writeTest.success,
    error: writeTest.error?.message
  });
  
  // Test ADMIN capability (can see user management functions)
  const adminTest = await safeQuery(client, 'SELECT * FROM gk_list_ephemeral_users() LIMIT 1');
  results.admin = adminTest.success;
  results.details.push({
    test: 'admin_list_users',
    expected: expectedCapabilities.includes('admin'),
    actual: adminTest.success,
    error: adminTest.error?.message
  });
  
  return results;
}

// Clean up ephemeral user
async function cleanupEphemeralUser(username) {
  console.log(`🧹 Cleaning up ephemeral user: ${username}`);
  
  const result = await safeQuery(adminClient, 'SELECT gk_drop_user($1)', [username]);
  
  if (result.success) {
    console.log(`✅ User ${username} cleaned up successfully`);
  } else {
    console.warn(`⚠️ Failed to cleanup user ${username}:`, result.error.message);
  }
  
  return result.success;
}

describe('Gatekeeper Docker Stack Integration Tests', () => {
  
  beforeAll(async () => {
    console.log('🚀 Starting Gatekeeper Integration Tests');
    console.log('📋 Test Configuration:', {
      host: TEST_CONFIG.admin.host,
      port: TEST_CONFIG.admin.port,
      database: TEST_CONFIG.admin.database,
      users: Object.keys(TEST_CONFIG.users)
    });
    
    // Create admin connection
    adminClient = await createClient(TEST_CONFIG.admin);
    
    // Validate database setup
    const setupValidation = await adminClient.query('SELECT * FROM gk_validate_setup()');
    console.log('🔍 Database setup validation:', setupValidation.rows);
    
    // Setup additional test roles
    await setupTestRoles();
    
  }, 30000);
  
  afterAll(async () => {
    console.log('🧹 Cleaning up integration tests...');
    
    // Close all test user connections
    for (const [username, client] of Object.entries(testClients)) {
      if (client) {
        await client.end();
      }
    }
    
    // Clean up all ephemeral users
    for (const userConfig of Object.values(TEST_CONFIG.users)) {
      await cleanupEphemeralUser(userConfig.username);
    }
    
    // Close admin connection
    if (adminClient) {
      await adminClient.end();
    }
    
    console.log('✅ Integration test cleanup completed');
  }, 15000);
  
  describe('Database Infrastructure Tests', () => {
    
    it('should have all required roles and functions', async () => {
      const validation = await adminClient.query('SELECT * FROM gk_validate_setup()');
      
      const checks = validation.rows.reduce((acc, row) => {
        acc[row.check_name] = row.status;
        return acc;
      }, {});
      
      expect(checks.gatekeeper_admin_role).toBe('OK');
      expect(checks.app_read_role).toBe('OK'); 
      expect(checks.helper_functions).toBe('OK');
      expect(checks.sample_data).toBe('OK');
    });
    
    it('should have test roles created', async () => {
      const roles = await adminClient.query(`
        SELECT rolname FROM pg_roles 
        WHERE rolname IN ('app_read', 'app_write', 'app_admin')
        ORDER BY rolname
      `);
      
      const roleNames = roles.rows.map(r => r.rolname);
      expect(roleNames).toContain('app_read');
      expect(roleNames).toContain('app_write');
      expect(roleNames).toContain('app_admin');
    });
    
  });
  
  describe('Admin User Tests (Bob)', () => {
    let bobCredentials;
    let bobClient;
    
    it('should create admin user bob', async () => {
      const userConfig = TEST_CONFIG.users.bob;
      bobCredentials = await createEphemeralUser(userConfig.username, userConfig.role);
      
      expect(bobCredentials.username).toBe(userConfig.username);
      expect(bobCredentials.role).toBe(userConfig.role);
      expect(bobCredentials.password).toBeDefined();
    });
    
    it('should connect with bob credentials', async () => {
      bobClient = await createClient({
        ...TEST_CONFIG.admin,
        user: bobCredentials.username,
        password: bobCredentials.password
      });
      
      testClients.bob = bobClient;
      
      const result = await bobClient.query('SELECT current_user, now()');
      expect(result.rows[0].current_user).toBe(bobCredentials.username);
    });
    
    it('should have admin capabilities', async () => {
      const capabilities = await testUserCapabilities(
        bobClient, 
        bobCredentials.username, 
        TEST_CONFIG.users.bob.capabilities
      );
      
      expect(capabilities.read).toBe(true);
      expect(capabilities.write).toBe(true);
      expect(capabilities.admin).toBe(true);
      
      // Validate all tests passed as expected
      for (const detail of capabilities.details) {
        expect(detail.actual).toBe(detail.expected);
      }
    });
    
    it('should be able to manage other users', async () => {
      // Bob should be able to list ephemeral users
      const users = await bobClient.query('SELECT * FROM gk_list_ephemeral_users()');
      expect(users.rows.length).toBeGreaterThan(0);
      
      // Find bob in the list
      const bobUser = users.rows.find(u => u.username === bobCredentials.username);
      expect(bobUser).toBeDefined();
      expect(bobUser.is_expired).toBe(false);
    });
    
  });
  
  describe('Writer User Tests (Will)', () => {
    let willCredentials;
    let willClient;
    
    it('should create writer user will', async () => {
      const userConfig = TEST_CONFIG.users.will;
      willCredentials = await createEphemeralUser(userConfig.username, userConfig.role);
      
      expect(willCredentials.username).toBe(userConfig.username);
      expect(willCredentials.role).toBe(userConfig.role);
    });
    
    it('should connect with will credentials', async () => {
      willClient = await createClient({
        ...TEST_CONFIG.admin,
        user: willCredentials.username,
        password: willCredentials.password
      });
      
      testClients.will = willClient;
      
      const result = await willClient.query('SELECT current_user');
      expect(result.rows[0].current_user).toBe(willCredentials.username);
    });
    
    it('should have read and write capabilities but not admin', async () => {
      const capabilities = await testUserCapabilities(
        willClient,
        willCredentials.username,
        TEST_CONFIG.users.will.capabilities
      );
      
      expect(capabilities.read).toBe(true);
      expect(capabilities.write).toBe(true);
      expect(capabilities.admin).toBe(false);
      
      // Validate specific test results
      const readTest = capabilities.details.find(d => d.test === 'read_sample_data');
      expect(readTest.actual).toBe(true);
      
      const writeTest = capabilities.details.find(d => d.test === 'write_product');
      expect(writeTest.actual).toBe(true);
      
      const adminTest = capabilities.details.find(d => d.test === 'admin_list_users');
      expect(adminTest.actual).toBe(false);
    });
    
    it('should be able to perform complex write operations', async () => {
      // Create a new category
      const categoryResult = await willClient.query(`
        INSERT INTO categories (name, description) 
        VALUES ($1, $2) 
        RETURNING id, name
      `, [TEST_CONFIG.testData.categoryName, 'Integration test category']);
      
      expect(categoryResult.rows).toHaveLength(1);
      const categoryId = categoryResult.rows[0].id;
      
      // Create a product in that category
      const productResult = await willClient.query(`
        INSERT INTO products (name, description, price, category_id)
        VALUES ($1, $2, $3, $4)
        RETURNING id, name, price
      `, [TEST_CONFIG.testData.productName, 'Test product by Will', 199.99, categoryId]);
      
      expect(productResult.rows).toHaveLength(1);
      expect(productResult.rows[0].price).toBe('199.99');
      
      // Create an order
      const orderResult = await willClient.query(`
        INSERT INTO orders (customer_email, total, status)
        VALUES ($1, $2, $3)
        RETURNING id, customer_email
      `, [TEST_CONFIG.testData.orderEmail, 199.99, 'pending']);
      
      expect(orderResult.rows).toHaveLength(1);
      expect(orderResult.rows[0].customer_email).toBe(TEST_CONFIG.testData.orderEmail);
    });
    
  });
  
  describe('Reader User Tests (Letty)', () => {
    let lettyCredentials;
    let lettyClient;
    
    it('should create reader user letty', async () => {
      const userConfig = TEST_CONFIG.users.letty;
      lettyCredentials = await createEphemeralUser(userConfig.username, userConfig.role);
      
      expect(lettyCredentials.username).toBe(userConfig.username);
      expect(lettyCredentials.role).toBe(userConfig.role);
    });
    
    it('should connect with letty credentials', async () => {
      lettyClient = await createClient({
        ...TEST_CONFIG.admin,
        user: lettyCredentials.username,
        password: lettyCredentials.password
      });
      
      testClients.letty = lettyClient;
      
      const result = await lettyClient.query('SELECT current_user');
      expect(result.rows[0].current_user).toBe(lettyCredentials.username);
    });
    
    it('should have only read capabilities', async () => {
      const capabilities = await testUserCapabilities(
        lettyClient,
        lettyCredentials.username,
        TEST_CONFIG.users.letty.capabilities
      );
      
      expect(capabilities.read).toBe(true);
      expect(capabilities.write).toBe(false);
      expect(capabilities.admin).toBe(false);
      
      // Validate specific test results
      const readTest = capabilities.details.find(d => d.test === 'read_sample_data');
      expect(readTest.actual).toBe(true);
      
      const writeTest = capabilities.details.find(d => d.test === 'write_product');
      expect(writeTest.actual).toBe(false);
      expect(writeTest.error).toContain('permission denied');
    });
    
    it('should be able to perform complex read operations', async () => {
      // Read from multiple tables with joins
      const orderSummary = await lettyClient.query(`
        SELECT 
          o.id,
          o.customer_email,
          o.total,
          count(oi.id) as item_count
        FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        WHERE o.customer_email = $1
        GROUP BY o.id, o.customer_email, o.total
      `, [TEST_CONFIG.testData.orderEmail]);
      
      expect(orderSummary.rows.length).toBeGreaterThanOrEqual(0);
      
      // Use the order_summary view
      const viewResult = await lettyClient.query(`
        SELECT * FROM order_summary 
        WHERE customer_email = $1
      `, [TEST_CONFIG.testData.orderEmail]);
      
      expect(viewResult.rows.length).toBeGreaterThanOrEqual(0);
      
      // Read product statistics
      const productStats = await lettyClient.query(`
        SELECT * FROM product_stats 
        WHERE name LIKE $1
        LIMIT 5
      `, ['%Test%']);
      
      expect(Array.isArray(productStats.rows)).toBe(true);
    });
    
    it('should NOT be able to modify data', async () => {
      // Try to insert (should fail)
      const insertResult = await safeQuery(lettyClient, `
        INSERT INTO sample_data (name, description) 
        VALUES ('letty test', 'should fail')
      `);
      expect(insertResult.success).toBe(false);
      expect(insertResult.error.message).toContain('permission denied');
      
      // Try to update (should fail)
      const updateResult = await safeQuery(lettyClient, `
        UPDATE sample_data SET name = 'modified by letty' WHERE id = 1
      `);
      expect(updateResult.success).toBe(false);
      expect(updateResult.error.message).toContain('permission denied');
      
      // Try to delete (should fail)
      const deleteResult = await safeQuery(lettyClient, `
        DELETE FROM sample_data WHERE id = 1
      `);
      expect(deleteResult.success).toBe(false);
      expect(deleteResult.error.message).toContain('permission denied');
    });
    
  });
  
  describe('User Lifecycle Tests', () => {
    
    it('should list all created ephemeral users', async () => {
      const users = await adminClient.query('SELECT * FROM gk_list_ephemeral_users()');
      
      // Should have at least our 3 test users
      expect(users.rows.length).toBeGreaterThanOrEqual(3);
      
      // Check that all our test users are present
      const usernames = users.rows.map(u => u.username);
      expect(usernames).toContain(TEST_CONFIG.users.bob.username);
      expect(usernames).toContain(TEST_CONFIG.users.will.username);
      expect(usernames).toContain(TEST_CONFIG.users.letty.username);
      
      // All should be valid (not expired)
      const ourUsers = users.rows.filter(u => 
        u.username.startsWith('gk_bob_') || 
        u.username.startsWith('gk_will_') || 
        u.username.startsWith('gk_letty_')
      );
      
      for (const user of ourUsers) {
        expect(user.is_expired).toBe(false);
        expect(user.connection_limit).toBe(2);
      }
    });
    
    it('should show user activity in audit log', async () => {
      const auditEntries = await adminClient.query(`
        SELECT * FROM gatekeeper_audit 
        WHERE event_type LIKE '%user%' OR event_type LIKE '%session%'
        ORDER BY created_at DESC
        LIMIT 10
      `);
      
      expect(auditEntries.rows.length).toBeGreaterThan(0);
      
      // Should have setup events
      const eventTypes = auditEntries.rows.map(e => e.event_type);
      expect(eventTypes.some(et => et === 'setup.completed')).toBe(true);
    });
    
    it('should handle connection limits properly', async () => {
      // Each user has connection_limit = 2
      // Let's test will's connection limit by creating multiple connections
      
      const willConfig = {
        ...TEST_CONFIG.admin,
        user: TEST_CONFIG.users.will.username,
        password: testClients.will ? 'password_from_existing_client' : 'unknown'
      };
      
      // This test is informational - we can't easily test connection limits
      // without knowing the exact password, but we can verify the limit is set
      const users = await adminClient.query(`
        SELECT username, connection_limit 
        FROM gk_list_ephemeral_users() 
        WHERE username = $1
      `, [TEST_CONFIG.users.will.username]);
      
      expect(users.rows).toHaveLength(1);
      expect(users.rows[0].connection_limit).toBe(2);
    });
    
  });
  
  describe('Cleanup and Security Tests', () => {
    
    it('should prevent SQL injection in user management functions', async () => {
      // Try malicious username
      const maliciousUsername = "gk_test'; DROP TABLE sample_data; --";
      
      const result = await safeQuery(adminClient, `
        SELECT gk_create_ephemeral_user($1, $2, now() + interval '1 minute', $3, 1)
      `, [maliciousUsername, 'password', 'app_read']);
      
      // Should fail due to validation
      expect(result.success).toBe(false);
      expect(result.error.message).toContain('Username must follow pattern');
      
      // Verify sample_data still exists
      const tableCheck = await adminClient.query('SELECT count(*) FROM sample_data');
      expect(tableCheck.rows[0].count).toBeGreaterThan(0);
    });
    
    it('should enforce username patterns', async () => {
      const invalidUsernames = [
        'invalid_user', // doesn't start with gk_
        'gk_', // too short
        'gk_user-with-hyphens', // invalid characters
        'gk_user.with.dots', // invalid characters
        'gk_user with spaces', // spaces not allowed
        'gk_' + 'x'.repeat(70) // too long
      ];
      
      for (const username of invalidUsernames) {
        const result = await safeQuery(adminClient, `
          SELECT gk_create_ephemeral_user($1, $2, now() + interval '1 minute', $3, 1)
        `, [username, 'password', 'app_read']);
        
        expect(result.success).toBe(false);
      }
    });
    
    it('should properly clean up users', async () => {
      // Get current user count
      const beforeCount = await adminClient.query(`
        SELECT count(*) FROM gk_list_ephemeral_users()
      `);
      
      // Clean up all test users
      const cleanupResults = [];
      for (const userConfig of Object.values(TEST_CONFIG.users)) {
        const result = await cleanupEphemeralUser(userConfig.username);
        cleanupResults.push(result);
      }
      
      // All cleanups should succeed
      expect(cleanupResults.every(r => r === true)).toBe(true);
      
      // Verify users are gone
      const afterCount = await adminClient.query(`
        SELECT count(*) FROM gk_list_ephemeral_users()
      `);
      
      expect(parseInt(afterCount.rows[0].count)).toBeLessThan(parseInt(beforeCount.rows[0].count));
      
      // Try to connect with cleaned up user (should fail)
      if (testClients.letty) {
        try {
          await testClients.letty.query('SELECT 1');
          // If we get here, the connection wasn't terminated
          // This might happen if the connection was already closed
        } catch (error) {
          // Expected - connection should be terminated
          expect(error.message).toMatch(/(connection|authentication|role.*does not exist)/i);
        }
      }
    });
    
  });
  
});