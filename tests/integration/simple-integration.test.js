/**
 * Simplified Gatekeeper Integration Test Suite
 * Tests admin (bob), writer (will), and reader (letty) users
 * Works with existing SECURITY DEFINER functions and standard usernames
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { Client } from 'pg';
import crypto from 'crypto';

// Test configuration
const TEST_CONFIG = {
  admin: {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'app',
    user: process.env.PGUSER || 'gatekeeper_admin',
    password: process.env.PGPASSWORD || 'gatekeeper_admin_password_change_in_production'
  },
  
  // Use simple usernames that match existing validation
  users: {
    bob: {
      username: 'gk_bob' + crypto.randomBytes(3).toString('hex'), // gk_bob123abc
      role: 'app_read', // Start with existing role, we'll enhance it
      capabilities: ['read', 'write', 'admin']
    },
    will: {
      username: 'gk_will' + crypto.randomBytes(3).toString('hex'), // gk_will123abc
      role: 'app_read', // Will enhance with write permissions  
      capabilities: ['read', 'write']
    },
    letty: {
      username: 'gk_letty' + crypto.randomBytes(3).toString('hex'), // gk_letty123abc
      role: 'app_read',
      capabilities: ['read']
    }
  },
  
  sessionTtl: 60
};

let adminClient;
let testClients = {};

// Helper functions
function generatePassword() {
  return crypto.randomBytes(12).toString('base64');
}

async function createClient(config) {
  const client = new Client(config);
  await client.connect();
  return client;
}

async function safeQuery(client, query, params = []) {
  try {
    const result = await client.query(query, params);
    return { success: true, result };
  } catch (error) {
    return { success: false, error };
  }
}

// Enhanced role setup using existing functions
async function enhanceUserPermissions(username, capabilities) {
  if (!capabilities.includes('write')) return;
  
  // Grant additional write permissions to specific users
  // This simulates the role pack system
  try {
    await adminClient.query(`
      GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ${username};
      GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${username};
    `);
    console.log(`✅ Enhanced ${username} with write permissions`);
  } catch (error) {
    console.warn(`⚠️ Could not enhance ${username} permissions:`, error.message);
  }
  
  if (!capabilities.includes('admin')) return;
  
  // Grant admin permissions 
  try {
    await adminClient.query(`
      GRANT gatekeeper_admin TO ${username};
    `);
    console.log(`✅ Enhanced ${username} with admin permissions`);
  } catch (error) {
    console.warn(`⚠️ Could not grant admin permissions to ${username}:`, error.message);
  }
}

async function createTestUser(userConfig) {
  const { username, role, capabilities } = userConfig;
  const password = generatePassword();
  const ttlMinutes = TEST_CONFIG.sessionTtl;
  
  console.log(`👤 Creating test user: ${username} with role: ${role}`);
  
  try {
    await adminClient.query(`
      SELECT gk_create_ephemeral_user($1, $2, now() + interval '${ttlMinutes} minutes', $3, 2)
    `, [username, password, role]);
    
    // Enhance permissions based on capabilities
    await enhanceUserPermissions(username, capabilities);
    
    return { username, password, role, capabilities };
  } catch (error) {
    console.error(`❌ Failed to create user ${username}:`, error.message);
    throw error;
  }
}

async function testUserCapabilities(client, username, expectedCapabilities) {
  const results = {
    read: false,
    write: false,
    admin: false,
    details: []
  };
  
  // Test READ
  const readTest = await safeQuery(client, 'SELECT count(*) as count FROM sample_data');
  results.read = readTest.success;
  results.details.push({
    test: 'read_data',
    expected: expectedCapabilities.includes('read'),
    actual: readTest.success,
    error: readTest.error?.message
  });
  
  // Test WRITE
  const writeTest = await safeQuery(client, 
    'INSERT INTO sample_data (name, description) VALUES ($1, $2) RETURNING id',
    [`test_${username}_${Date.now()}`, 'Integration test data']
  );
  results.write = writeTest.success;
  results.details.push({
    test: 'write_data',
    expected: expectedCapabilities.includes('write'),
    actual: writeTest.success,
    error: writeTest.error?.message
  });
  
  // Test ADMIN (try to list users)
  const adminTest = await safeQuery(client, 'SELECT * FROM gk_list_ephemeral_users() LIMIT 1');
  results.admin = adminTest.success;
  results.details.push({
    test: 'admin_functions',
    expected: expectedCapabilities.includes('admin'),
    actual: adminTest.success,
    error: adminTest.error?.message
  });
  
  return results;
}

async function cleanupTestUser(username) {
  console.log(`🧹 Cleaning up test user: ${username}`);
  
  const result = await safeQuery(adminClient, 'SELECT gk_drop_user($1)', [username]);
  
  if (result.success) {
    console.log(`✅ User ${username} cleaned up successfully`);
  } else {
    console.warn(`⚠️ Failed to cleanup user ${username}:`, result.error.message);
  }
  
  return result.success;
}

describe('Gatekeeper Simple Integration Tests', () => {
  
  beforeAll(async () => {
    console.log('🚀 Starting Gatekeeper Simple Integration Tests');
    console.log('👥 Testing admin (bob), writer (will), and reader (letty)');
    
    adminClient = await createClient(TEST_CONFIG.admin);
    
    // Validate database setup
    const setupValidation = await adminClient.query('SELECT * FROM gk_validate_setup()');
    console.log('🔍 Database setup validation:', setupValidation.rows);
  }, 30000);
  
  afterAll(async () => {
    console.log('🧹 Cleaning up test users...');
    
    // Close all test user connections
    for (const [, client] of Object.entries(testClients)) {
      if (client) {
        await client.end().catch(() => {});
      }
    }
    
    // Clean up all test users
    for (const userConfig of Object.values(TEST_CONFIG.users)) {
      await cleanupTestUser(userConfig.username);
    }
    
    if (adminClient) {
      await adminClient.end();
    }
    
    console.log('✅ Cleanup completed');
  }, 15000);
  
  describe('Database Infrastructure', () => {
    it('should have required roles and functions', async () => {
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
  });
  
  describe('Bob - Admin User Tests', () => {
    let bobCredentials;
    let bobClient;
    
    it('should create admin user bob', async () => {
      bobCredentials = await createTestUser(TEST_CONFIG.users.bob);
      
      expect(bobCredentials.username).toBe(TEST_CONFIG.users.bob.username);
      expect(bobCredentials.password).toBeDefined();
    });
    
    it('should connect as bob', async () => {
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
      
      // Check detailed test results
      const readTest = capabilities.details.find(d => d.test === 'read_data');
      expect(readTest.actual).toBe(readTest.expected);
      
      const writeTest = capabilities.details.find(d => d.test === 'write_data');
      expect(writeTest.actual).toBe(writeTest.expected);
    });
    
    it('should manage ephemeral users', async () => {
      const users = await bobClient.query('SELECT * FROM gk_list_ephemeral_users()');
      expect(users.rows.length).toBeGreaterThan(0);
      
      // Find bob in the list
      const bobUser = users.rows.find(u => u.username === bobCredentials.username);
      expect(bobUser).toBeDefined();
      expect(bobUser.is_expired).toBe(false);
    });
  });
  
  describe('Will - Writer User Tests', () => {
    let willCredentials;
    let willClient;
    
    it('should create writer user will', async () => {
      willCredentials = await createTestUser(TEST_CONFIG.users.will);
      
      expect(willCredentials.username).toBe(TEST_CONFIG.users.will.username);
    });
    
    it('should connect as will', async () => {
      willClient = await createClient({
        ...TEST_CONFIG.admin,
        user: willCredentials.username,
        password: willCredentials.password
      });
      
      testClients.will = willClient;
      
      const result = await willClient.query('SELECT current_user');
      expect(result.rows[0].current_user).toBe(willCredentials.username);
    });
    
    it('should have read and write capabilities', async () => {
      const capabilities = await testUserCapabilities(
        willClient,
        willCredentials.username,
        TEST_CONFIG.users.will.capabilities
      );
      
      expect(capabilities.read).toBe(true);
      expect(capabilities.write).toBe(true);
      
      // Should not have admin capabilities
      expect(capabilities.admin).toBe(false);
    });
    
    it('should perform write operations', async () => {
      // Insert test data
      const insertResult = await willClient.query(`
        INSERT INTO sample_data (name, description) 
        VALUES ($1, $2) 
        RETURNING id, name
      `, [`will_test_${Date.now()}`, 'Test data created by Will']);
      
      expect(insertResult.rows).toHaveLength(1);
      expect(insertResult.rows[0].name).toContain('will_test_');
      
      // Update the data
      const updateResult = await safeQuery(willClient, `
        UPDATE sample_data 
        SET description = $1 
        WHERE id = $2
      `, ['Updated by Will', insertResult.rows[0].id]);
      
      expect(updateResult.success).toBe(true);
    });
  });
  
  describe('Letty - Reader User Tests', () => {
    let lettyCredentials;
    let lettyClient;
    
    it('should create reader user letty', async () => {
      lettyCredentials = await createTestUser(TEST_CONFIG.users.letty);
      
      expect(lettyCredentials.username).toBe(TEST_CONFIG.users.letty.username);
    });
    
    it('should connect as letty', async () => {
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
    });
    
    it('should read complex data', async () => {
      // Test reading from sample_data
      const sampleData = await lettyClient.query('SELECT count(*) as count FROM sample_data');
      expect(sampleData.rows[0].count).toBeGreaterThan(0);
      
      // Test reading from products table
      const products = await lettyClient.query('SELECT count(*) as count FROM products');
      expect(products.rows[0].count).toBeGreaterThan(0);
      
      // Test using views
      const orderSummary = await lettyClient.query('SELECT count(*) as count FROM order_summary');
      expect(orderSummary.rows[0].count).toBeGreaterThanOrEqual(0);
    });
    
    it('should NOT be able to write data', async () => {
      // Try to insert (should fail)
      const insertResult = await safeQuery(lettyClient, `
        INSERT INTO sample_data (name, description) 
        VALUES ('letty_test', 'Should fail')
      `);
      expect(insertResult.success).toBe(false);
      expect(insertResult.error.message).toContain('permission denied');
      
      // Try to update (should fail)
      const updateResult = await safeQuery(lettyClient, `
        UPDATE sample_data SET name = 'modified' WHERE id = 1
      `);
      expect(updateResult.success).toBe(false);
      expect(updateResult.error.message).toContain('permission denied');
    });
  });
  
  describe('User Lifecycle Management', () => {
    it('should list all test users', async () => {
      const users = await adminClient.query('SELECT * FROM gk_list_ephemeral_users()');
      
      // Should have at least our 3 test users
      expect(users.rows.length).toBeGreaterThanOrEqual(3);
      
      const usernames = users.rows.map(u => u.username);
      expect(usernames).toContain(TEST_CONFIG.users.bob.username);
      expect(usernames).toContain(TEST_CONFIG.users.will.username);
      expect(usernames).toContain(TEST_CONFIG.users.letty.username);
    });
    
    it('should show audit events', async () => {
      const auditEvents = await adminClient.query(`
        SELECT * FROM gatekeeper_audit 
        ORDER BY created_at DESC 
        LIMIT 5
      `);
      
      expect(auditEvents.rows.length).toBeGreaterThan(0);
    });
    
    it('should cleanup expired users', async () => {
      // Get current count
      const beforeCount = await adminClient.query('SELECT count(*) as count FROM gk_list_ephemeral_users()');
      
      // Manual cleanup test using gk_drop_user
      const testUsername = 'gk_cleanup' + crypto.randomBytes(3).toString('hex');
      const testPassword = generatePassword();
      
      // Create a user to test cleanup
      await adminClient.query(`
        SELECT gk_create_ephemeral_user($1, $2, now() + interval '1 minute', 'app_read', 1)
      `, [testUsername, testPassword]);
      
      // Verify it was created
      const afterCreate = await adminClient.query('SELECT count(*) as count FROM gk_list_ephemeral_users()');
      expect(parseInt(afterCreate.rows[0].count)).toBe(parseInt(beforeCount.rows[0].count) + 1);
      
      // Drop the user
      const dropResult = await adminClient.query('SELECT gk_drop_user($1)', [testUsername]);
      expect(dropResult.rows[0].gk_drop_user).toBe(true);
      
      // Verify it was removed
      const afterDrop = await adminClient.query('SELECT count(*) as count FROM gk_list_ephemeral_users()');
      expect(parseInt(afterDrop.rows[0].count)).toBe(parseInt(beforeCount.rows[0].count));
    });
  });
  
});