"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.initializeDatabaseConnection = initializeDatabaseConnection;
exports.waitForPostgres = waitForPostgres;
exports.ensureDatabase = ensureDatabase;
exports.runMigrations = runMigrations;
exports.runSeeds = runSeeds;
exports.initializeDatabase = initializeDatabase;
exports.checkDatabaseHealth = checkDatabaseHealth;
exports.closeDatabase = closeDatabase;
const knex_1 = require("knex");
const path_1 = __importDefault(require("path"));
const pg_1 = require("pg");
// Database credentials for FuzeFront dedicated user
const FUZEFRONT_USER = 'fuzefront_user';
const FUZEFRONT_PASSWORD = 'FuzeFront_2024_SecureDB_Pass!';
// Database configuration based on environment and phase (migration vs runtime)
const getDatabaseConfig = (useMigrationCredentials = false) => {
    const isProduction = process.env.NODE_ENV === 'production';
    const usePostgres = process.env.USE_POSTGRES === 'true' || !isProduction;
    if (usePostgres) {
        // PostgreSQL configuration (shared infrastructure)
        // Use postgres user for migrations, fuzefront_user for runtime
        const dbUser = useMigrationCredentials
            ? 'postgres'
            : (process.env.DB_USER || FUZEFRONT_USER);
        const dbPassword = useMigrationCredentials
            ? null // postgres user has no password in FuzeInfra
            : (process.env.DB_PASSWORD || FUZEFRONT_PASSWORD);
        return {
            client: 'pg',
            connection: {
                host: process.env.DB_HOST || 'localhost',
                port: parseInt(process.env.DB_PORT || '5432'),
                database: process.env.DB_NAME || 'fuzefront_platform',
                user: dbUser,
                ...(dbPassword && { password: dbPassword }),
            },
            pool: {
                min: 2,
                max: 10,
            },
            migrations: {
                tableName: 'knex_migrations',
                directory: path_1.default.join(__dirname, isProduction ? '../migrations' : '../migrations'),
                extension: isProduction ? 'js' : 'ts',
            },
            seeds: {
                directory: path_1.default.join(__dirname, isProduction ? '../seeds' : '../seeds'),
            },
        };
    }
    else {
        // SQLite configuration (fallback)
        return {
            client: 'sqlite3',
            connection: {
                filename: path_1.default.join(__dirname, '../database.sqlite'),
            },
            useNullAsDefault: true,
            migrations: {
                tableName: 'knex_migrations',
                directory: path_1.default.join(__dirname, isProduction ? '../migrations' : '../migrations'),
                extension: isProduction ? 'js' : 'ts',
            },
            seeds: {
                directory: path_1.default.join(__dirname, isProduction ? '../seeds' : '../seeds'),
            },
        };
    }
};
// Initialize database connection with runtime credentials
function initializeDatabaseConnection() {
    exports.db = (0, knex_1.knex)(getDatabaseConfig(false)); // Use fuzefront_user credentials
}
// Database initialization functions
async function waitForPostgres(maxRetries = 30, retryDelay = 2000, useMigrationCredentials = false) {
    console.log('🔍 Checking PostgreSQL availability...');
    const dbUser = useMigrationCredentials ? 'postgres' : (process.env.DB_USER || FUZEFRONT_USER);
    const dbPassword = useMigrationCredentials ? null : (process.env.DB_PASSWORD || FUZEFRONT_PASSWORD);
    for (let i = 0; i < maxRetries; i++) {
        try {
            const clientConfig = {
                host: process.env.DB_HOST || 'localhost',
                port: parseInt(process.env.DB_PORT || '5432'),
                database: 'postgres', // Connect to default database first
                user: dbUser,
            };
            if (dbPassword) {
                clientConfig.password = dbPassword;
            }
            const client = new pg_1.Client(clientConfig);
            await client.connect();
            await client.query('SELECT 1');
            await client.end();
            console.log(`✅ PostgreSQL is ready! (Connected as: ${dbUser})`);
            return;
        }
        catch (error) {
            console.log(`⏳ Waiting for PostgreSQL... (attempt ${i + 1}/${maxRetries}) [User: ${dbUser}]`);
            if (i === maxRetries - 1) {
                throw new Error(`Failed to connect to PostgreSQL after ${maxRetries} attempts: ${error}`);
            }
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }
}
async function ensureDatabase(useMigrationCredentials = false) {
    console.log('🔧 Ensuring database exists...');
    const dbUser = useMigrationCredentials ? 'postgres' : (process.env.DB_USER || FUZEFRONT_USER);
    const dbPassword = useMigrationCredentials ? null : (process.env.DB_PASSWORD || FUZEFRONT_PASSWORD);
    const clientConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: 'postgres', // Connect to default database
        user: dbUser,
    };
    if (dbPassword) {
        clientConfig.password = dbPassword;
    }
    const client = new pg_1.Client(clientConfig);
    try {
        await client.connect();
        // Check if database exists
        const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [process.env.DB_NAME || 'fuzefront_platform']);
        if (result.rows.length === 0) {
            console.log(`📦 Creating database "${process.env.DB_NAME || 'fuzefront_platform'}"...`);
            await client.query(`CREATE DATABASE "${process.env.DB_NAME || 'fuzefront_platform'}"`);
            console.log('✅ Database created successfully!');
        }
        else {
            console.log('✅ Database already exists');
        }
    }
    catch (error) {
        console.error('❌ Error ensuring database:', error);
        throw error;
    }
    finally {
        await client.end();
    }
}
async function runMigrations() {
    console.log('🚀 Running database migrations...');
    // Create a temporary database instance with migration credentials (postgres user)
    const migrationDb = (0, knex_1.knex)(getDatabaseConfig(false));
    try {
        const [batchNo, log] = await migrationDb.migrate.latest();
        if (log.length === 0) {
            console.log('✅ Database is already up to date');
        }
        else {
            console.log(`✅ Ran ${log.length} migration(s):`);
            log.forEach((migration) => {
                console.log(`  - ${migration}`);
            });
            console.log(`📦 Batch: ${batchNo}`);
        }
    }
    catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    }
    finally {
        await migrationDb.destroy();
    }
}
async function runSeeds() {
    console.log('🌱 Running database seeds...');
    try {
        const [log] = await exports.db.seed.run();
        if (log.length === 0) {
            console.log('✅ No seeds to run');
        }
        else {
            console.log(`✅ Ran ${log.length} seed(s):`);
            log.forEach((seed) => {
                console.log(`  - ${seed}`);
            });
        }
    }
    catch (error) {
        console.error('❌ Seeding failed:', error);
        throw error;
    }
}
async function initializeDatabase() {
    console.log('🔧 Initializing database...');
    try {
        // PHASE 1: Use postgres user for initial setup and migrations
        console.log('📋 Phase 1: Database setup and migrations (postgres user)');
        // 1. Wait for PostgreSQL to be available with postgres user
        await waitForPostgres(30, 2000, false);
        // 2. Ensure the database exists (using postgres user)
        await ensureDatabase(true);
        // 3. Run migrations (using postgres user) - this includes creating fuzefront_user
        await runMigrations();
        // PHASE 2: Switch to fuzefront_user for runtime operations
        console.log('🔄 Phase 2: Switching to fuzefront_user for runtime operations');
        // 4. Verify fuzefront_user can connect
        await waitForPostgres(10, 1000, false);
        // 5. Initialize runtime database connection with fuzefront_user
        initializeDatabaseConnection();
        // 6. Run seeds (only in development) using fuzefront_user
        if (process.env.NODE_ENV !== 'production') {
            await runSeeds();
        }
        console.log('✅ Database initialization complete!');
        console.log('🎉 Ready to serve requests with fuzefront_user credentials');
    }
    catch (error) {
        console.error('❌ Database initialization failed:', error);
        throw error;
    }
}
async function checkDatabaseHealth() {
    try {
        await exports.db.raw('SELECT 1');
        return true;
    }
    catch (error) {
        console.error('❌ Database health check failed:', error);
        return false;
    }
}
async function closeDatabase() {
    try {
        await exports.db.destroy();
        console.log('✅ Database connection closed');
    }
    catch (error) {
        console.error('❌ Error closing database:', error);
    }
}
//# sourceMappingURL=database.js.map