/**
 * Database Provider Factory
 * Registers and creates database providers based on configuration
 */

import type { Logger } from 'pino'
import {
  DatabaseType,
  DatabaseProvider,
  databaseProviderRegistry,
  ProviderNotFoundError
} from '@gatekeeper/shared'
import { 
  PostgresProvider, 
  OracleProvider, 
  SqlServerProvider, 
  MySqlProvider 
} from './index.js'

/**
 * Register all available database providers
 * This should be called once at application startup
 */
export function registerDatabaseProviders(logger: Logger): void {
  // Register production-ready providers
  databaseProviderRegistry.register('postgres', () => new PostgresProvider(logger))
  
  // Register stub providers (will throw NOT_IMPLEMENTED errors when used)
  databaseProviderRegistry.register('oracle', () => new OracleProvider(logger))
  databaseProviderRegistry.register('sqlserver', () => new SqlServerProvider(logger))
  databaseProviderRegistry.register('mysql', () => new MySqlProvider(logger))

  const supportedTypes = databaseProviderRegistry.getSupportedTypes()
  logger.info({ supportedTypes }, 'Database providers registered')
}

/**
 * Create a database provider instance
 */
export function createDatabaseProvider(type: DatabaseType, _logger: Logger): DatabaseProvider {
  if (!databaseProviderRegistry.isSupported(type)) {
    throw new ProviderNotFoundError(type)
  }
  
  return databaseProviderRegistry.create(type)
}

/**
 * Get all supported database types
 */
export function getSupportedDatabaseTypes(): DatabaseType[] {
  return databaseProviderRegistry.getSupportedTypes()
}

/**
 * Check if a database type is supported (including stub implementations)
 */
export function isDatabaseTypeSupported(type: DatabaseType): boolean {
  return databaseProviderRegistry.isSupported(type)
}

/**
 * Get production-ready database types (excludes stubs)
 */
export function getProductionReadyDatabaseTypes(): DatabaseType[] {
  // For Milestone 0, only Postgres is production-ready
  return ['postgres']
}

/**
 * Check if a database type is production-ready
 */
export function isDatabaseTypeProductionReady(type: DatabaseType): boolean {
  return getProductionReadyDatabaseTypes().includes(type)
}