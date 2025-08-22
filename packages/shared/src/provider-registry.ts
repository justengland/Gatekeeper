import {
  DatabaseType,
  DatabaseProvider,
  DatabaseProviderFactory,
  DatabaseProviderRegistry,
  ProviderNotFoundError
} from './database-provider.js'

/**
 * Default implementation of DatabaseProviderRegistry
 * Manages registration and creation of database providers
 */
export class DefaultDatabaseProviderRegistry implements DatabaseProviderRegistry {
  private factories = new Map<DatabaseType, DatabaseProviderFactory>()

  /**
   * Register a provider factory for a specific database type
   */
  register(type: DatabaseType, factory: DatabaseProviderFactory): void {
    this.factories.set(type, factory)
  }

  /**
   * Get a factory for a specific database type
   */
  get(type: DatabaseType): DatabaseProviderFactory | undefined {
    return this.factories.get(type)
  }

  /**
   * Create a new provider instance for a specific database type
   * @throws {ProviderNotFoundError} If no provider is registered for the type
   */
  create(type: DatabaseType): DatabaseProvider {
    const factory = this.factories.get(type)
    if (!factory) {
      throw new ProviderNotFoundError(type)
    }
    return factory()
  }

  /**
   * Get all supported database types
   */
  getSupportedTypes(): DatabaseType[] {
    return Array.from(this.factories.keys())
  }

  /**
   * Check if a database type is supported
   */
  isSupported(type: DatabaseType): boolean {
    return this.factories.has(type)
  }

  /**
   * Clear all registered providers (useful for testing)
   */
  clear(): void {
    this.factories.clear()
  }

  /**
   * Get the count of registered providers
   */
  size(): number {
    return this.factories.size
  }
}

/**
 * Global registry instance
 * Can be used throughout the application for provider management
 */
export const databaseProviderRegistry = new DefaultDatabaseProviderRegistry()