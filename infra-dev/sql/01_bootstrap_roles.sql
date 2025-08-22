-- Bootstrap SQL for Gatekeeper PostgreSQL Setup
-- This file is executed automatically when PostgreSQL starts
-- Creates necessary roles and SECURITY DEFINER functions

-- =============================================================================
-- Admin Role Setup
-- =============================================================================

-- Create dedicated admin role for Gatekeeper Agent operations
-- This role has the minimum privileges needed to manage ephemeral users
CREATE ROLE gatekeeper_admin WITH
  LOGIN
  NOSUPERUSER
  CREATEDB
  CREATEROLE
  REPLICATION
  BYPASSRLS
  PASSWORD 'gatekeeper_admin_password_change_in_production';

-- Grant necessary privileges to the admin role
GRANT CONNECT ON DATABASE app TO gatekeeper_admin;
GRANT USAGE ON SCHEMA public TO gatekeeper_admin;
GRANT CREATE ON SCHEMA public TO gatekeeper_admin;

-- Allow admin to manage roles (needed for ephemeral users)
-- Note: In production, this should be more restricted
ALTER ROLE gatekeeper_admin WITH CREATEROLE;

-- =============================================================================
-- Application Roles (Role Packs)
-- =============================================================================

-- Read-only application role
CREATE ROLE app_read;
GRANT CONNECT ON DATABASE app TO app_read;
GRANT USAGE ON SCHEMA public TO app_read;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_read;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_read;

-- Grant the admin role permission to manage app_read role
GRANT app_read TO gatekeeper_admin WITH ADMIN OPTION;

-- Write role for application users  
CREATE ROLE app_write;
GRANT CONNECT ON DATABASE app TO app_write;
GRANT USAGE ON SCHEMA public TO app_write;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_write;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO app_write;
GRANT app_write TO gatekeeper_admin WITH ADMIN OPTION;

-- Admin role for application administration
CREATE ROLE app_admin;
GRANT CONNECT ON DATABASE app TO app_admin;
GRANT USAGE ON SCHEMA public TO app_admin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_admin;
GRANT app_admin TO gatekeeper_admin WITH ADMIN OPTION;

-- Analyst role for data analysis (read + some functions)
CREATE ROLE app_analyst;
GRANT CONNECT ON DATABASE app TO app_analyst;
GRANT USAGE ON SCHEMA public TO app_analyst;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_analyst;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_analyst;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_analyst;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO app_analyst;
GRANT app_analyst TO gatekeeper_admin WITH ADMIN OPTION;

-- =============================================================================
-- SECURITY DEFINER Helper Functions
-- =============================================================================

-- Switch to admin role for creating SECURITY DEFINER functions
SET ROLE gatekeeper_admin;

-- Function to create ephemeral users with proper role assignment
CREATE OR REPLACE FUNCTION gk_create_ephemeral_user(
  username TEXT,
  password TEXT,
  valid_until TIMESTAMPTZ,
  role_name TEXT,
  connection_limit INTEGER DEFAULT 1
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role_exists BOOLEAN;
BEGIN
  -- Validate inputs
  IF username IS NULL OR username = '' THEN
    RAISE EXCEPTION 'Username cannot be empty';
  END IF;
  
  IF password IS NULL OR password = '' THEN
    RAISE EXCEPTION 'Password cannot be empty';
  END IF;
  
  IF NOT username ~ '^gk_[a-zA-Z0-9_]+$' THEN
    RAISE EXCEPTION 'Username must follow pattern: gk_[alphanumeric_underscore]';
  END IF;
  
  IF valid_until <= now() THEN
    RAISE EXCEPTION 'Valid until timestamp must be in the future';
  END IF;

  -- Check if the role to grant exists
  SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = role_name) INTO role_exists;
  IF NOT role_exists THEN
    RAISE EXCEPTION 'Role % does not exist', role_name;
  END IF;

  -- Create the ephemeral user
  EXECUTE format(
    'CREATE ROLE %I WITH LOGIN PASSWORD %L VALID UNTIL %L CONNECTION LIMIT %s',
    username, password, valid_until, connection_limit
  );

  -- Grant the specified application role
  EXECUTE format('GRANT %I TO %I', role_name, username);
  
  -- Set default search path
  EXECUTE format('ALTER ROLE %I SET search_path TO public', username);

  RAISE NOTICE 'Created ephemeral user % with role % valid until %', 
    username, role_name, valid_until;
END;
$$;

-- Function to safely drop ephemeral users
CREATE OR REPLACE FUNCTION gk_drop_user(username TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_exists BOOLEAN;
  active_connections INTEGER;
BEGIN
  -- Validate input
  IF username IS NULL OR username = '' THEN
    RAISE EXCEPTION 'Username cannot be empty';
  END IF;
  
  -- Only allow dropping gatekeeper-managed users (safety check)
  IF NOT username ~ '^gk_[a-zA-Z0-9_]+$' THEN
    RAISE EXCEPTION 'Can only drop gatekeeper users (must start with gk_)';
  END IF;

  -- Check if user exists
  SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = username) INTO user_exists;
  IF NOT user_exists THEN
    RAISE NOTICE 'User % does not exist, nothing to drop', username;
    RETURN FALSE;
  END IF;

  -- Check for active connections
  SELECT count(*) 
  FROM pg_stat_activity 
  WHERE usename = username 
    AND state = 'active' 
    AND pid != pg_backend_pid()
  INTO active_connections;
  
  IF active_connections > 0 THEN
    RAISE WARNING 'User % has % active connections, terminating them', 
      username, active_connections;
    
    -- Terminate active connections
    PERFORM pg_terminate_backend(pid)
    FROM pg_stat_activity 
    WHERE usename = username 
      AND pid != pg_backend_pid();
  END IF;

  -- Revoke all privileges first (cleanup)
  BEGIN
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', username);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', username);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I', username);
    EXECUTE format('REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I', username);
    EXECUTE format('REVOKE ALL PRIVILEGES ON DATABASE app FROM %I', username);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error revoking privileges for user %: %', username, SQLERRM;
  END;

  -- Drop the user
  EXECUTE format('DROP ROLE %I', username);
  
  RAISE NOTICE 'Dropped ephemeral user %', username;
  RETURN TRUE;
END;
$$;

-- Function to list all ephemeral users with their expiry info
CREATE OR REPLACE FUNCTION gk_list_ephemeral_users()
RETURNS TABLE(
  username TEXT,
  valid_until TIMESTAMPTZ,
  is_expired BOOLEAN,
  connection_limit INTEGER,
  active_connections BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.rolname::TEXT as username,
    r.rolvaliduntil as valid_until,
    (r.rolvaliduntil IS NOT NULL AND r.rolvaliduntil <= now()) as is_expired,
    r.rolconnlimit as connection_limit,
    COALESCE(s.active_count, 0) as active_connections
  FROM pg_roles r
  LEFT JOIN (
    SELECT 
      usename,
      count(*) as active_count
    FROM pg_stat_activity
    WHERE state = 'active'
    GROUP BY usename
  ) s ON r.rolname = s.usename
  WHERE r.rolname ~ '^gk_[a-zA-Z0-9]+$'
  ORDER BY r.rolvaliduntil NULLS LAST;
END;
$$;

-- Function to cleanup expired users (batch operation)
CREATE OR REPLACE FUNCTION gk_cleanup_expired_users(
  older_than_minutes INTEGER DEFAULT 5
)
RETURNS TABLE(
  username TEXT,
  was_expired BOOLEAN,
  dropped BOOLEAN,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_record RECORD;
  drop_success BOOLEAN;
  error_msg TEXT;
BEGIN
  -- Find expired users (including grace period)
  FOR user_record IN
    SELECT rolname
    FROM pg_roles
    WHERE rolname ~ '^gk_[a-zA-Z0-9]+$'
      AND (
        (rolvaliduntil IS NOT NULL AND rolvaliduntil <= (now() - (older_than_minutes || ' minutes')::INTERVAL))
        OR rolvaliduntil IS NULL  -- Handle users without expiry (shouldn't happen but be safe)
      )
  LOOP
    drop_success := FALSE;
    error_msg := NULL;
    
    BEGIN
      SELECT gk_drop_user(user_record.rolname) INTO drop_success;
    EXCEPTION WHEN OTHERS THEN
      error_msg := SQLERRM;
      drop_success := FALSE;
    END;
    
    RETURN QUERY SELECT 
      user_record.rolname::TEXT,
      TRUE as was_expired,
      drop_success,
      error_msg;
  END LOOP;
END;
$$;

-- =============================================================================
-- Permanent User Management Functions
-- =============================================================================

-- Function to create permanent database users
CREATE OR REPLACE FUNCTION gk_create_permanent_user(
  username TEXT,
  password TEXT,
  valid_until TIMESTAMPTZ,
  roles_json TEXT,
  connection_limit INTEGER DEFAULT 3
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role_name TEXT;
  roles_array TEXT[];
BEGIN
  -- Validate inputs
  IF username IS NULL OR username = '' THEN
    RAISE EXCEPTION 'Username cannot be empty';
  END IF;
  
  IF password IS NULL OR password = '' THEN
    RAISE EXCEPTION 'Password cannot be empty';
  END IF;
  
  -- Allow more flexible username patterns for permanent users (no gk_ prefix requirement)
  IF NOT username ~ '^[a-z][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'Username must start with lowercase letter and contain only lowercase letters, numbers, and underscores';
  END IF;

  -- Parse roles array
  IF roles_json IS NOT NULL THEN
    SELECT array_agg(value::text)
    INTO roles_array
    FROM json_array_elements_text(roles_json::json);
  ELSE
    roles_array := ARRAY['app_read'];
  END IF;

  -- Create the permanent user
  EXECUTE format(
    'CREATE ROLE %I WITH LOGIN PASSWORD %L CONNECTION LIMIT %s',
    username, password, connection_limit
  );
  
  -- Set expiration if provided
  IF valid_until IS NOT NULL THEN
    EXECUTE format('ALTER ROLE %I VALID UNTIL %L', username, valid_until);
  END IF;

  -- Grant specified application roles
  FOREACH role_name IN ARRAY roles_array
  LOOP
    -- Verify the role exists before granting
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT %I TO %I', role_name, username);
      RAISE NOTICE 'Granted role % to user %', role_name, username;
    ELSE
      RAISE WARNING 'Role % does not exist, skipping grant for user %', role_name, username;
    END IF;
  END LOOP;
  
  -- Set default search path
  EXECUTE format('ALTER ROLE %I SET search_path TO public', username);

  RAISE NOTICE 'Created permanent user % with roles % and connection limit %', 
    username, array_to_string(roles_array, ', '), connection_limit;
END;
$$;

-- Function to update permanent user settings
CREATE OR REPLACE FUNCTION gk_update_permanent_user(
  username TEXT,
  roles_json TEXT DEFAULT NULL,
  connection_limit INTEGER DEFAULT NULL,
  enable_login BOOLEAN DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role_name TEXT;
  roles_array TEXT[];
  current_roles TEXT[];
  role_to_revoke TEXT;
BEGIN
  -- Validate input
  IF username IS NULL OR username = '' THEN
    RAISE EXCEPTION 'Username cannot be empty';
  END IF;
  
  -- Check if user exists
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = username) THEN
    RAISE EXCEPTION 'User % does not exist', username;
  END IF;

  -- Update connection limit if provided
  IF connection_limit IS NOT NULL THEN
    EXECUTE format('ALTER ROLE %I CONNECTION LIMIT %s', username, connection_limit);
    RAISE NOTICE 'Updated connection limit for user % to %', username, connection_limit;
  END IF;

  -- Update login capability if provided
  IF enable_login IS NOT NULL THEN
    IF enable_login THEN
      EXECUTE format('ALTER ROLE %I WITH LOGIN', username);
      RAISE NOTICE 'Enabled login for user %', username;
    ELSE
      EXECUTE format('ALTER ROLE %I WITH NOLOGIN', username);
      RAISE NOTICE 'Disabled login for user %', username;
    END IF;
  END IF;

  -- Update roles if provided
  IF roles_json IS NOT NULL THEN
    -- Parse new roles array
    SELECT array_agg(value::text)
    INTO roles_array
    FROM json_array_elements_text(roles_json::json);
    
    -- Get current application roles (exclude system roles)
    SELECT array_agg(rolname)
    INTO current_roles
    FROM pg_auth_members m
    JOIN pg_roles r ON m.roleid = r.oid
    JOIN pg_roles u ON m.member = u.oid
    WHERE u.rolname = username 
      AND r.rolname IN ('app_read', 'app_write', 'app_admin', 'app_analyst');
    
    current_roles := COALESCE(current_roles, ARRAY[]::TEXT[]);
    
    -- Revoke roles that are no longer needed
    FOREACH role_to_revoke IN ARRAY current_roles
    LOOP
      IF NOT (role_to_revoke = ANY(roles_array)) THEN
        EXECUTE format('REVOKE %I FROM %I', role_to_revoke, username);
        RAISE NOTICE 'Revoked role % from user %', role_to_revoke, username;
      END IF;
    END LOOP;
    
    -- Grant new roles
    FOREACH role_name IN ARRAY roles_array
    LOOP
      -- Verify the role exists and grant if user doesn't already have it
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        IF NOT (role_name = ANY(current_roles)) THEN
          EXECUTE format('GRANT %I TO %I', role_name, username);
          RAISE NOTICE 'Granted role % to user %', role_name, username;
        END IF;
      ELSE
        RAISE WARNING 'Role % does not exist, skipping grant for user %', role_name, username;
      END IF;
    END LOOP;
    
    RAISE NOTICE 'Updated roles for user % to %', username, array_to_string(roles_array, ', ');
  END IF;
END;
$$;

-- Function to reset user password
CREATE OR REPLACE FUNCTION gk_reset_user_password(
  username TEXT,
  new_password TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate inputs
  IF username IS NULL OR username = '' THEN
    RAISE EXCEPTION 'Username cannot be empty';
  END IF;
  
  IF new_password IS NULL OR new_password = '' THEN
    RAISE EXCEPTION 'Password cannot be empty';
  END IF;
  
  -- Check if user exists
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = username) THEN
    RAISE EXCEPTION 'User % does not exist', username;
  END IF;

  -- Update password
  EXECUTE format('ALTER ROLE %I WITH PASSWORD %L', username, new_password);
  
  RAISE NOTICE 'Reset password for user %', username;
END;
$$;

-- Reset to default role
RESET ROLE;

-- =============================================================================
-- Grant Execute Permissions
-- =============================================================================

-- Grant execute permissions on helper functions to gatekeeper_admin
GRANT EXECUTE ON FUNCTION gk_create_ephemeral_user(TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER) TO gatekeeper_admin;
GRANT EXECUTE ON FUNCTION gk_drop_user(TEXT) TO gatekeeper_admin;
GRANT EXECUTE ON FUNCTION gk_list_ephemeral_users() TO gatekeeper_admin;
GRANT EXECUTE ON FUNCTION gk_cleanup_expired_users(INTEGER) TO gatekeeper_admin;
GRANT EXECUTE ON FUNCTION gk_create_permanent_user(TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER) TO gatekeeper_admin;
GRANT EXECUTE ON FUNCTION gk_update_permanent_user(TEXT, TEXT, INTEGER, BOOLEAN) TO gatekeeper_admin;
GRANT EXECUTE ON FUNCTION gk_reset_user_password(TEXT, TEXT) TO gatekeeper_admin;

-- =============================================================================
-- Audit and Logging Setup
-- =============================================================================

-- Create audit log table for session events
CREATE TABLE IF NOT EXISTS gatekeeper_audit (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  session_id VARCHAR(100),
  username VARCHAR(100),
  correlation_id UUID,
  event_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  prev_hash VARCHAR(64), -- For hash chain integrity
  event_hash VARCHAR(64) -- SHA-256 of event content
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_gatekeeper_audit_session_id ON gatekeeper_audit(session_id);
CREATE INDEX IF NOT EXISTS idx_gatekeeper_audit_correlation_id ON gatekeeper_audit(correlation_id);
CREATE INDEX IF NOT EXISTS idx_gatekeeper_audit_created_at ON gatekeeper_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_gatekeeper_audit_event_type ON gatekeeper_audit(event_type);

-- Grant permissions on audit table
GRANT INSERT, SELECT ON gatekeeper_audit TO gatekeeper_admin;
GRANT USAGE, SELECT ON SEQUENCE gatekeeper_audit_id_seq TO gatekeeper_admin;

-- =============================================================================
-- Sample Data and Test Setup
-- =============================================================================

-- Create some sample tables for testing read access
CREATE TABLE IF NOT EXISTS sample_data (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Insert some test data
INSERT INTO sample_data (name, description) VALUES
  ('Test Record 1', 'This is a test record for validating read access'),
  ('Test Record 2', 'Another test record with different data'),
  ('Test Record 3', 'Final test record for comprehensive testing')
ON CONFLICT DO NOTHING;

-- Grant read access to the sample table
GRANT SELECT ON sample_data TO app_read;

-- =============================================================================
-- Validation and Health Check Functions
-- =============================================================================

-- Function to validate the setup
CREATE OR REPLACE FUNCTION gk_validate_setup()
RETURNS TABLE(
  check_name TEXT,
  status TEXT,
  details TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  admin_exists BOOLEAN;
  app_read_exists BOOLEAN;
  functions_exist INTEGER;
  sample_count BIGINT;
BEGIN
  -- Check if admin role exists
  SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'gatekeeper_admin') INTO admin_exists;
  RETURN QUERY SELECT 'gatekeeper_admin_role'::TEXT, 
    CASE WHEN admin_exists THEN 'OK' ELSE 'FAILED' END,
    CASE WHEN admin_exists THEN 'Admin role exists' ELSE 'Admin role missing' END;

  -- Check if app_read role exists  
  SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'app_read') INTO app_read_exists;
  RETURN QUERY SELECT 'app_read_role'::TEXT,
    CASE WHEN app_read_exists THEN 'OK' ELSE 'FAILED' END,
    CASE WHEN app_read_exists THEN 'App read role exists' ELSE 'App read role missing' END;

  -- Check if helper functions exist
  SELECT count(*) FROM pg_proc 
  WHERE proname IN ('gk_create_ephemeral_user', 'gk_drop_user', 'gk_list_ephemeral_users', 'gk_cleanup_expired_users')
  INTO functions_exist;
  RETURN QUERY SELECT 'helper_functions'::TEXT,
    CASE WHEN functions_exist = 4 THEN 'OK' ELSE 'FAILED' END,
    format('%s/4 helper functions exist', functions_exist);

  -- Check sample data
  SELECT count(*) FROM sample_data INTO sample_count;
  RETURN QUERY SELECT 'sample_data'::TEXT,
    CASE WHEN sample_count > 0 THEN 'OK' ELSE 'FAILED' END,
    format('%s sample records available', sample_count);
END;
$$;

-- Make validation function available to all roles
GRANT EXECUTE ON FUNCTION gk_validate_setup() TO PUBLIC;

-- Log successful setup
INSERT INTO gatekeeper_audit (
  event_type, 
  event_data, 
  correlation_id,
  event_hash
) VALUES (
  'setup.completed',
  ('{"version": "1.0.0", "timestamp": "' || now()::TEXT || '"}')::jsonb,
  gen_random_uuid(),
  encode(sha256('setup.completed'::bytea), 'hex')
);

-- Display setup validation
SELECT * FROM gk_validate_setup();