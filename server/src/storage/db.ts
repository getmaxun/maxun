import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_HOST || !process.env.DB_PORT || !process.env.DB_NAME) {
    throw new Error('One or more required environment variables are missing.');
}

const databaseUrl = `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD)}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

// Extract the hostname using the URL constructor
const host = new URL(databaseUrl).hostname;

const sequelize = new Sequelize(databaseUrl,
    {
        host,
        dialect: 'postgres',
        logging: false,
        pool: {
            max: 10,           // Maximum number of connections in pool (reduced from 20)
            min: 0,            // Minimum number of connections in pool (let pool shrink to 0)
            acquire: 30000,    // Maximum time (ms) to try to get connection before throwing error
            idle: 10000,       // Maximum time (ms) a connection can be idle before being released
            evict: 1000,       // Time interval (ms) for eviction runs
        },
        dialectOptions: {
            statement_timeout: 60000, // 60 seconds
        },
    }
);

export const connectDB = async () => {
    try {
        await sequelize.authenticate();
        console.log('Database connected successfully');
    } catch (error) {
        console.error('Unable to connect to the database:', error);
    }
};

export const syncDB = async () => {
    try {
        // Production schema is owned by Sequelize migrations. Running sync there
        // would let a fresh deployment silently create a weaker schema when a
        // migration job was omitted, especially for unique lease/replay indexes.
        const isDevelopment = process.env.NODE_ENV === 'development';
        if (!isDevelopment) {
            console.log('Production schema is migration-managed; skipping sequelize.sync().');
            return;
        }
        await sequelize.sync({ force: false, alter: true });
        console.log('Development database synced successfully!');
    } catch (error) {
        console.error('Failed to sync database:', error);
    }
};


export default sequelize;
