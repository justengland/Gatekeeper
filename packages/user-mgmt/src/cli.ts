#!/usr/bin/env node
/**
 * Gatekeeper User Management CLI
 * Command line interface for managing permanent database users
 *
 * Usage:
 *   gk-users create --username john_doe --email john@example.com --name "John Doe" --type developer --roles app_read,app_write
 *   gk-users list --type developer
 *   gk-users show john_doe
 *   gk-users update john_doe --roles app_read,app_admin
 *   gk-users reset-password john_doe
 *   gk-users delete john_doe --reason "Left company"
 */

import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import inquirer from 'inquirer'
import { table } from 'table'
import dotenv from 'dotenv'
import pino from 'pino'
import { UserManager, type UserManagerConfig } from './user-manager.js'
import {
  type CreateUserRequest,
  type UpdateUserRequest,
  type ListUsersQuery,
  type PasswordResetRequest,
  UserTypeSchema,
  UserStatusSchema
} from './types.js'

// Load environment variables
dotenv.config()

const program = new Command()

// CLI Configuration
interface CLIConfig {
  database: {
    host: string
    port: number
    database: string
    user: string
    password: string
    ssl: 'disable' | 'prefer' | 'require'
  }
  agent: {
    httpUrl: string
  }
  security: {
    passwordMinLength: number
    passwordComplexity: boolean
  }
}

const config: CLIConfig = {
  database: {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE || 'app',
    user: process.env.PGUSER || 'gatekeeper_admin',
    password: process.env.PGPASSWORD || 'gatekeeper_admin_password_change_in_production',
    ssl: (process.env.PGSSLMODE as 'disable' | 'prefer' | 'require') || 'disable'
  },
  agent: {
    httpUrl: process.env.AGENT_HTTP_URL || 'http://localhost:4001'
  },
  security: {
    passwordMinLength: parseInt(process.env.PASSWORD_MIN_LENGTH || '12'),
    passwordComplexity: process.env.PASSWORD_COMPLEXITY !== 'false'
  }
}

// Initialize logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  name: 'gatekeeper-user-mgmt',
  ...(process.env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true }
        }
      }
    : {})
})

// Initialize UserManager
const userManagerConfig: UserManagerConfig = {
  database: {
    host: config.database.host,
    port: config.database.port,
    database: config.database.database,
    user: config.database.user,
    password: config.database.password,
    ssl: config.database.ssl,
    maxConnections: 10
  },
  agent: {
    httpUrl: config.agent.httpUrl
  },
  security: {
    passwordMinLength: config.security.passwordMinLength,
    passwordComplexity: config.security.passwordComplexity
  },
  logger
}

const userManager = new UserManager(userManagerConfig)

// Utility functions
function log (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') {
  const colors = {
    info: chalk.blue,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow
  }
  console.log(colors[type](message))
}

function validateRoles (roles: string): string[] {
  const roleList = roles.split(',').map(r => r.trim()).filter(r => r.length > 0)
  if (roleList.length === 0) {
    throw new Error('At least one role is required')
  }
  return roleList
}

// Command: Initialize schema
program
  .command('init')
  .description('Initialize user management schema')
  .action(async () => {
    const spinner = ora('Initializing user management schema...').start()

    try {
      await userManager.initializeSchema()
      spinner.stop()
      log('✅ User management schema initialized successfully!', 'success')
    } catch (error: any) {
      spinner.stop()
      log(`❌ Error: ${error.message}`, 'error')
      process.exit(1)
    }
  })

// Command: Create user
program
  .command('create')
  .description('Create a new database user')
  .requiredOption('-u, --username <username>', 'Username (lowercase, alphanumeric with underscores)')
  .requiredOption('-e, --email <email>', 'User email address')
  .requiredOption('-n, --name <name>', 'Full name')
  .requiredOption('-t, --type <type>', 'User type (admin, developer, analyst, service)')
  .requiredOption('-r, --roles <roles>', 'Comma-separated list of roles')
  .option('-p, --password <password>', 'Password (will be generated if not provided)')
  .option('-c, --connection-limit <limit>', 'Connection limit (default: 3)', '3')
  .option('--valid-until <date>', 'Expiration date (ISO format)')
  .option('--reason <reason>', 'Reason for creating user')
  .action(async (options) => {
    const spinner = ora('Creating user...').start()

    try {
      // Validate inputs
      const userType = UserTypeSchema.parse(options.type)
      const roles = validateRoles(options.roles)
      const connectionLimit = parseInt(options.connectionLimit)

      if (isNaN(connectionLimit) || connectionLimit < 1 || connectionLimit > 10) {
        throw new Error('Connection limit must be between 1 and 10')
      }

      const request: CreateUserRequest = {
        username: options.username,
        email: options.email,
        fullName: options.name,
        userType,
        roles,
        password: options.password,
        connectionLimit,
        validUntil: options.validUntil,
        reason: options.reason
      }

      const user = await userManager.createUser(request, 'cli')
      spinner.stop()

      log('✅ User created successfully!', 'success')
      console.log()

      const userTable = [
        ['Property', 'Value'],
        ['ID', user.id],
        ['Username', user.username],
        ['Email', user.email],
        ['Full Name', user.fullName],
        ['Type', user.userType],
        ['Roles', user.roles.join(', ')],
        ['Status', user.status],
        ['Connection Limit', user.connectionLimit.toString()],
        ['Valid Until', user.validUntil || 'No expiration'],
        ['Created At', new Date(user.createdAt).toLocaleString()],
        ['Created By', user.createdBy]
      ]

      console.log(table(userTable))

      if (!options.password) {
        console.log()
        log(`💡 Generated password has been sent securely. Use 'gk-users reset-password ${user.username}' to generate a new one.`, 'info')
      }
    } catch (error: any) {
      spinner.stop()
      log(`❌ Error: ${error.message}`, 'error')
      process.exit(1)
    }
  })

// Command: List users
program
  .command('list')
  .description('List database users')
  .option('-t, --type <type>', 'Filter by user type')
  .option('-s, --status <status>', 'Filter by status')
  .option('-r, --role <role>', 'Filter by role')
  .option('--limit <limit>', 'Limit results (default: 50)', '50')
  .option('--offset <offset>', 'Offset for pagination (default: 0)', '0')
  .option('--search <search>', 'Search by username, email, or name')
  .action(async (options) => {
    const spinner = ora('Fetching users...').start()

    try {
      const query: ListUsersQuery = {
        userType: options.type ? UserTypeSchema.parse(options.type) : undefined,
        status: options.status ? UserStatusSchema.parse(options.status) : undefined,
        role: options.role,
        limit: parseInt(options.limit),
        offset: parseInt(options.offset),
        search: options.search
      }

      const result = await userManager.listUsers(query)
      spinner.stop()

      if (result.users.length === 0) {
        log('No users found', 'info')
        return
      }

      const usersTable = [
        ['Username', 'Full Name', 'Email', 'Type', 'Status', 'Roles', 'Last Login']
      ]

      result.users.forEach(user => {
        const status = user.status === 'active'
          ? chalk.green('Active')
          : user.status === 'suspended'
            ? chalk.yellow('Suspended')
            : user.status === 'inactive'
              ? chalk.gray('Inactive')
              : chalk.red('Deleted')

        const lastLogin = user.lastLoginAt
          ? new Date(user.lastLoginAt).toLocaleString()
          : chalk.gray('Never')

        usersTable.push([
          user.username,
          user.fullName,
          user.email,
          user.userType,
          status,
          user.roles.join(', '),
          lastLogin
        ])
      })

      console.log(table(usersTable))
      log(`\nShowing ${result.users.length} of ${result.total} users`, 'info')
    } catch (error: any) {
      spinner.stop()
      log(`❌ Error: ${error.message}`, 'error')
      process.exit(1)
    }
  })

// Command: Show user details
program
  .command('show <username>')
  .description('Show detailed user information')
  .action(async (username) => {
    const spinner = ora('Fetching user details...').start()

    try {
      const user = await userManager.getUser(username)
      spinner.stop()

      if (user == null) {
        log(`❌ User '${username}' not found`, 'error')
        process.exit(1)
      }

      console.log(chalk.bold(`User Details: ${user.username}`))
      console.log()

      const userTable = [
        ['Property', 'Value'],
        ['ID', user.id],
        ['Username', user.username],
        ['Email', user.email],
        ['Full Name', user.fullName],
        ['Type', user.userType],
        ['Status', user.status === 'active'
          ? chalk.green('Active')
          : user.status === 'suspended'
            ? chalk.yellow('Suspended')
            : user.status === 'inactive'
              ? chalk.gray('Inactive')
              : chalk.red('Deleted')],
        ['Roles', user.roles.join(', ')],
        ['Connection Limit', user.connectionLimit.toString()],
        ['Valid Until', user.validUntil || 'No expiration'],
        ['Created At', new Date(user.createdAt).toLocaleString()],
        ['Updated At', new Date(user.updatedAt).toLocaleString()],
        ['Created By', user.createdBy],
        ['Last Login', user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never']
      ]

      console.log(table(userTable))
    } catch (error: any) {
      spinner.stop()
      log(`❌ Error: ${error.message}`, 'error')
      process.exit(1)
    }
  })

// Command: Update user
program
  .command('update <username>')
  .description('Update user information')
  .option('-e, --email <email>', 'New email address')
  .option('-n, --name <name>', 'New full name')
  .option('-t, --type <type>', 'New user type')
  .option('-r, --roles <roles>', 'New comma-separated list of roles')
  .option('-s, --status <status>', 'New status (active, inactive, suspended)')
  .option('-c, --connection-limit <limit>', 'New connection limit')
  .option('--valid-until <date>', 'New expiration date (ISO format)')
  .option('--reason <reason>', 'Reason for update')
  .action(async (username, options) => {
    const spinner = ora('Updating user...').start()

    try {
      const request: UpdateUserRequest = {}

      if (options.email) request.email = options.email
      if (options.name) request.fullName = options.name
      if (options.type) request.userType = UserTypeSchema.parse(options.type)
      if (options.roles) request.roles = validateRoles(options.roles)
      if (options.status) request.status = UserStatusSchema.parse(options.status)
      if (options.connectionLimit) {
        const limit = parseInt(options.connectionLimit)
        if (isNaN(limit) || limit < 1 || limit > 10) {
          throw new Error('Connection limit must be between 1 and 10')
        }
        request.connectionLimit = limit
      }
      if (options.validUntil !== undefined) request.validUntil = options.validUntil
      if (options.reason) request.reason = options.reason

      if (Object.keys(request).length === 0) {
        spinner.stop()
        log('❌ No updates specified', 'error')
        process.exit(1)
      }

      const user = await userManager.updateUser(username, request, 'cli')
      spinner.stop()

      log('✅ User updated successfully!', 'success')
      console.log()

      const userTable = [
        ['Property', 'Value'],
        ['Username', user.username],
        ['Email', user.email],
        ['Full Name', user.fullName],
        ['Type', user.userType],
        ['Status', user.status],
        ['Roles', user.roles.join(', ')],
        ['Connection Limit', user.connectionLimit.toString()],
        ['Valid Until', user.validUntil || 'No expiration'],
        ['Updated At', new Date(user.updatedAt).toLocaleString()]
      ]

      console.log(table(userTable))
    } catch (error: any) {
      spinner.stop()
      log(`❌ Error: ${error.message}`, 'error')
      process.exit(1)
    }
  })

// Command: Reset password
program
  .command('reset-password <username>')
  .description('Reset user password')
  .option('-p, --password <password>', 'New password (will be generated if not provided)')
  .option('--force-change', 'Force user to change password on next login', true)
  .option('--reason <reason>', 'Reason for password reset')
  .action(async (username, options) => {
    const spinner = ora('Resetting password...').start()

    try {
      const request: PasswordResetRequest = {
        username,
        newPassword: options.password,
        forceChange: options.forceChange,
        reason: options.reason
      }

      const result = await userManager.resetPassword(request, 'cli')
      spinner.stop()

      log('✅ Password reset successfully!', 'success')
      console.log()

      if (!options.password) {
        console.log(chalk.bold('Generated Password:'))
        console.log(chalk.yellow(result.password))
        console.log()
        log('💡 Please save this password securely. It will not be shown again.', 'warning')
      }
    } catch (error: any) {
      spinner.stop()
      log(`❌ Error: ${error.message}`, 'error')
      process.exit(1)
    }
  })

// Command: Delete user
program
  .command('delete <username>')
  .description('Delete user (soft delete)')
  .option('--reason <reason>', 'Reason for deletion')
  .option('--confirm', 'Skip confirmation prompt')
  .action(async (username, options) => {
    try {
      // Get user details first
      const user = await userManager.getUser(username)
      if (user == null) {
        log(`❌ User '${username}' not found`, 'error')
        process.exit(1)
      }

      // Confirmation prompt unless --confirm is used
      if (!options.confirm) {
        const { confirmed } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmed',
            message: `Are you sure you want to delete user '${username}' (${user.fullName})?`,
            default: false
          }
        ])

        if (!confirmed) {
          log('Operation cancelled', 'info')
          process.exit(0)
        }
      }

      const spinner = ora('Deleting user...').start()

      await userManager.deleteUser(username, 'cli', options.reason)
      spinner.stop()

      log('✅ User deleted successfully!', 'success')
    } catch (error: any) {
      log(`❌ Error: ${error.message}`, 'error')
      process.exit(1)
    }
  })

// Command: Interactive mode
program
  .command('interactive')
  .description('Start interactive mode')
  .alias('i')
  .action(async () => {
    log('🚀 Welcome to Gatekeeper User Management Interactive Mode', 'info')

    while (true) {
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            { name: '👥 List Users', value: 'list' },
            { name: '➕ Create User', value: 'create' },
            { name: '👤 Show User Details', value: 'show' },
            { name: '✏️  Update User', value: 'update' },
            { name: '🔑 Reset Password', value: 'reset-password' },
            { name: '🗑️  Delete User', value: 'delete' },
            { name: '🚪 Exit', value: 'exit' }
          ]
        }
      ])

      if (action === 'exit') {
        log('👋 Goodbye!', 'info')
        break
      }

      try {
        switch (action) {
          case 'list':
            const { users } = await userManager.listUsers({ limit: 10, offset: 0 })
            if (users.length === 0) {
              log('No users found', 'info')
            } else {
              const usersTable = [['Username', 'Full Name', 'Type', 'Status']]
              users.forEach(user => {
                usersTable.push([
                  user.username,
                  user.fullName,
                  user.userType,
                  user.status
                ])
              })
              console.log(table(usersTable))
            }
            break

          case 'create':
            const createAnswers = await inquirer.prompt([
              { name: 'username', message: 'Username:', validate: (input) => input.length >= 3 || 'Username must be at least 3 characters' },
              { name: 'email', message: 'Email:' },
              { name: 'fullName', message: 'Full Name:' },
              {
                type: 'list',
                name: 'userType',
                message: 'User Type:',
                choices: ['admin', 'developer', 'analyst', 'service']
              },
              { name: 'roles', message: 'Roles (comma-separated):', default: 'app_read' }
            ])

            const createRequest: CreateUserRequest = {
              username: createAnswers.username,
              email: createAnswers.email,
              fullName: createAnswers.fullName,
              userType: createAnswers.userType,
              roles: validateRoles(createAnswers.roles),
              connectionLimit: 3
            }

            const newUser = await userManager.createUser(createRequest, 'cli-interactive')
            log(`✅ User '${newUser.username}' created successfully!`, 'success')
            break

          case 'show':
            const { showUsername } = await inquirer.prompt([
              { name: 'showUsername', message: 'Username to show:' }
            ])

            const user = await userManager.getUser(showUsername)
            if (user != null) {
              const userTable = [
                ['Property', 'Value'],
                ['Username', user.username],
                ['Email', user.email],
                ['Full Name', user.fullName],
                ['Type', user.userType],
                ['Status', user.status],
                ['Roles', user.roles.join(', ')],
                ['Connection Limit', user.connectionLimit.toString()],
                ['Created At', new Date(user.createdAt).toLocaleString()]
              ]
              console.log(table(userTable))
            } else {
              log(`User '${showUsername}' not found`, 'error')
            }
            break
        }
      } catch (error: any) {
        log(`Error: ${error.message}`, 'error')
      }

      console.log()
    }
  })

// Main program setup
program
  .name('gk-users')
  .description('Gatekeeper User Management CLI - Manage permanent database users')
  .version('0.1.0')
  .option('-v, --verbose', 'Enable verbose output')

// Error handling
process.on('uncaughtException', (error) => {
  log(`Uncaught exception: ${error.message}`, 'error')
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  log(`Unhandled rejection: ${reason}`, 'error')
  process.exit(1)
})

// Graceful shutdown
process.on('SIGINT', async () => {
  log('\nShutting down gracefully...', 'info')
  await userManager.shutdown()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  log('Shutting down gracefully...', 'info')
  await userManager.shutdown()
  process.exit(0)
})

// Parse and execute
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse()
}

export { program }
