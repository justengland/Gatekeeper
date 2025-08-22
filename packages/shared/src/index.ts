// Shared types, errors, and utilities for Gatekeeper
// Comprehensive Zod schemas and TypeScript types for the entire system

export const GATEKEEPER_VERSION = '0.1.0'

// =============================================================================
// Core Types and Schemas
// =============================================================================
export * from './types.js'

// =============================================================================
// Job Contract Schemas (Control Plane ↔ Agent)
// =============================================================================
export * from './jobs.js'

// =============================================================================
// API Request/Response Schemas (Control Plane Public API)
// =============================================================================
export * from './api.js'

// =============================================================================
// Error Classes and Utilities
// =============================================================================
export * from './errors.js'

// =============================================================================
// Validation Helper Functions
// =============================================================================
export * from './validation.js'

// =============================================================================
// Database Provider Abstraction
// =============================================================================
export * from './database-provider.js'
export * from './provider-registry.js'
