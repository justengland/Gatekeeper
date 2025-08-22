-- Test fixtures and sample data for Gatekeeper development
-- This file provides test data and scenarios for development and testing

-- =============================================================================
-- Additional Sample Tables for Testing
-- =============================================================================

-- Create a more complex table structure for testing
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  category_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY, 
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  customer_email VARCHAR(255) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(10,2) NOT NULL
);

-- =============================================================================
-- Sample Data
-- =============================================================================

-- Insert categories
INSERT INTO categories (id, name, description) VALUES
  (1, 'Electronics', 'Electronic devices and gadgets'),
  (2, 'Books', 'Books and educational materials'),
  (3, 'Clothing', 'Apparel and accessories'),
  (4, 'Home', 'Home and garden products')
ON CONFLICT (name) DO NOTHING;

-- Update sequence to avoid conflicts
SELECT setval('categories_id_seq', COALESCE((SELECT MAX(id) FROM categories), 1));

-- Insert products
INSERT INTO products (name, description, price, category_id) VALUES
  ('Laptop Computer', 'High-performance laptop for development', 1299.99, 1),
  ('Wireless Mouse', 'Ergonomic wireless mouse', 29.99, 1),
  ('Programming Book', 'Learn advanced programming concepts', 49.99, 2),
  ('T-Shirt', 'Comfortable cotton t-shirt', 19.99, 3),
  ('Coffee Mug', 'Large ceramic coffee mug', 12.99, 4),
  ('Smartphone', 'Latest model smartphone', 699.99, 1),
  ('Cookbook', 'Delicious recipes for home cooking', 24.99, 2),
  ('Jeans', 'Classic blue jeans', 79.99, 3),
  ('Desk Lamp', 'Adjustable LED desk lamp', 89.99, 4),
  ('Tablet', '10-inch tablet with stylus', 399.99, 1)
ON CONFLICT DO NOTHING;

-- Insert sample orders
INSERT INTO orders (customer_email, total, status) VALUES
  ('alice@example.com', 1349.98, 'completed'),
  ('bob@example.com', 74.98, 'pending'),
  ('charlie@example.com', 32.99, 'shipped'),
  ('diana@example.com', 429.98, 'completed')
ON CONFLICT DO NOTHING;

-- Insert order items (assuming order IDs 1-4)
INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
  (1, 1, 1, 1299.99),  -- Alice bought laptop
  (1, 2, 1, 29.99),    -- Alice bought mouse
  (1, 5, 1, 12.99),    -- Alice bought mug  
  (2, 3, 1, 49.99),    -- Bob bought book
  (2, 4, 1, 19.99),    -- Bob bought t-shirt
  (3, 2, 1, 29.99),    -- Charlie bought mouse
  (4, 6, 1, 399.99),   -- Diana bought tablet
  (4, 7, 1, 24.99)     -- Diana bought cookbook
ON CONFLICT DO NOTHING;

-- =============================================================================
-- Views for Testing Complex Queries
-- =============================================================================

-- Create a view joining multiple tables
CREATE OR REPLACE VIEW order_summary AS
SELECT 
  o.id as order_id,
  o.customer_email,
  o.total,
  o.status,
  o.created_at as order_date,
  count(oi.id) as item_count,
  array_agg(p.name ORDER BY p.name) as product_names
FROM orders o
LEFT JOIN order_items oi ON o.id = oi.order_id
LEFT JOIN products p ON oi.product_id = p.id
GROUP BY o.id, o.customer_email, o.total, o.status, o.created_at
ORDER BY o.created_at DESC;

-- Create a view for product statistics
CREATE OR REPLACE VIEW product_stats AS
SELECT 
  p.id,
  p.name,
  c.name as category_name,
  p.price,
  COALESCE(sum(oi.quantity), 0) as total_sold,
  COALESCE(sum(oi.quantity * oi.unit_price), 0) as total_revenue,
  count(DISTINCT oi.order_id) as order_count
FROM products p
LEFT JOIN categories c ON p.category_id = c.id
LEFT JOIN order_items oi ON p.id = oi.product_id
LEFT JOIN orders o ON oi.order_id = o.id AND o.status = 'completed'
GROUP BY p.id, p.name, c.name, p.price
ORDER BY total_revenue DESC;

-- =============================================================================
-- Grant Permissions to App Roles
-- =============================================================================

-- Grant read access to all test tables for app_read role
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_read;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO app_read;

-- Ensure future tables are also accessible
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_read;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO app_read;

-- =============================================================================
-- Test Functions for Validation
-- =============================================================================

-- Function to test basic database connectivity and permissions
CREATE OR REPLACE FUNCTION gk_test_basic_access()
RETURNS TABLE(
  test_name TEXT,
  result TEXT,
  details TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  sample_count BIGINT;
  product_count BIGINT;
  order_count BIGINT;
BEGIN
  -- Test sample_data access
  BEGIN
    SELECT count(*) FROM sample_data INTO sample_count;
    RETURN QUERY SELECT 'sample_data_access'::TEXT, 'OK'::TEXT, 
      format('Found %s sample records', sample_count);
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'sample_data_access'::TEXT, 'FAILED'::TEXT, SQLERRM;
  END;

  -- Test products access
  BEGIN
    SELECT count(*) FROM products INTO product_count;
    RETURN QUERY SELECT 'products_access'::TEXT, 'OK'::TEXT,
      format('Found %s products', product_count);
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'products_access'::TEXT, 'FAILED'::TEXT, SQLERRM;
  END;

  -- Test orders access
  BEGIN
    SELECT count(*) FROM orders INTO order_count;
    RETURN QUERY SELECT 'orders_access'::TEXT, 'OK'::TEXT,
      format('Found %s orders', order_count);
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'orders_access'::TEXT, 'FAILED'::TEXT, SQLERRM;
  END;

  -- Test view access
  BEGIN
    PERFORM count(*) FROM order_summary;
    RETURN QUERY SELECT 'view_access'::TEXT, 'OK'::TEXT, 'Can access order_summary view';
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'view_access'::TEXT, 'FAILED'::TEXT, SQLERRM;
  END;
END;
$$;

-- Function to generate test queries for ephemeral users
CREATE OR REPLACE FUNCTION gk_get_test_queries()
RETURNS TABLE(
  query_name TEXT,
  sql_query TEXT,
  expected_min_rows INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY VALUES
    ('basic_select', 'SELECT count(*) FROM sample_data;', 1),
    ('products_list', 'SELECT id, name, price FROM products ORDER BY price DESC LIMIT 5;', 5),
    ('categories_list', 'SELECT * FROM categories ORDER BY name;', 4),
    ('order_summary', 'SELECT * FROM order_summary WHERE total > 50;', 2),
    ('product_stats', 'SELECT * FROM product_stats WHERE total_sold > 0;', 1),
    ('join_query', 'SELECT p.name, c.name as category FROM products p JOIN categories c ON p.category_id = c.id WHERE p.price > 100;', 3),
    ('aggregate_query', 'SELECT c.name, count(p.id) as product_count, avg(p.price) as avg_price FROM categories c LEFT JOIN products p ON c.id = p.category_id GROUP BY c.name ORDER BY product_count DESC;', 4),
    ('date_filter', 'SELECT * FROM orders WHERE created_at >= CURRENT_DATE - INTERVAL ''30 days'';', 4),
    ('complex_view', 'SELECT customer_email, sum(total) as total_spent FROM order_summary WHERE status = ''completed'' GROUP BY customer_email ORDER BY total_spent DESC;', 2);
END;
$$;

-- Make test functions available
GRANT EXECUTE ON FUNCTION gk_test_basic_access() TO PUBLIC;
GRANT EXECUTE ON FUNCTION gk_get_test_queries() TO PUBLIC;

-- =============================================================================
-- Performance Test Data (for load testing)
-- =============================================================================

-- Function to generate large dataset for performance testing
CREATE OR REPLACE FUNCTION gk_generate_perf_data(num_products INTEGER DEFAULT 1000)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  i INTEGER;
BEGIN
  -- Generate many products for performance testing
  FOR i IN 1..num_products LOOP
    INSERT INTO products (name, description, price, category_id)
    VALUES (
      format('Test Product %s', i),
      format('Generated test product #%s for performance testing', i),
      (random() * 1000 + 10)::DECIMAL(10,2),
      (random() * 4 + 1)::INTEGER
    );
  END LOOP;

  RETURN format('Generated %s test products successfully', num_products);
END;
$$;

-- Only allow admin to generate perf data
GRANT EXECUTE ON FUNCTION gk_generate_perf_data(INTEGER) TO gatekeeper_admin;

-- =============================================================================
-- Logging Test Setup
-- =============================================================================

-- Insert test audit events
INSERT INTO gatekeeper_audit (
  event_type,
  event_data,
  correlation_id,
  event_hash
) VALUES 
  (
    'test.data_loaded',
    '{"tables": ["products", "categories", "orders", "order_items"], "timestamp": "' || now()::TEXT || '"}',
    gen_random_uuid(),
    encode(sha256('test.data_loaded'::bytea), 'hex')
  ),
  (
    'test.fixtures_ready', 
    '{"views": ["order_summary", "product_stats"], "functions": ["gk_test_basic_access", "gk_get_test_queries"]}',
    gen_random_uuid(),
    encode(sha256('test.fixtures_ready'::bytea), 'hex')
  );

-- Display completion message
SELECT 'Test fixtures loaded successfully' as status;