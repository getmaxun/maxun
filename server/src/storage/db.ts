import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';
import setupAssociations from '../models/associations';

dotenv.config();

const databaseUrl = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

// Extract the hostname using the URL constructor
const host = new URL(databaseUrl).hostname;

const sequelize = new Sequelize(databaseUrl,
    {
        host,
        dialect: 'postgres',
        logging: false,
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
        await sequelize.sync({ force: false });  // force: true will drop and recreate tables on every run
        console.log('Database synced successfully!');
    } catch (error) {
        console.error('Failed to sync database:', error);
    }
};


export default sequelize;