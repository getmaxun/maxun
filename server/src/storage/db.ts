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
        //setupAssociations();
        const isDevelopment = process.env.NODE_ENV === 'development';
        // force: true will drop and recreate tables on every run
        // Use `alter: true` only in development mode
        await sequelize.sync({ 
            force: false, 
            alter: isDevelopment 
        }); 
        console.log('Database synced successfully!');
    } catch (error) {
        console.error('Failed to sync database:', error);
    }
};


export default sequelize;
