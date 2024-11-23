import bcrypt from "bcrypt";
import crypto from 'crypto';
import { getEnvVariable } from './env';

export const hashPassword = (password: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        bcrypt.genSalt(12, (err, salt) => {
            if (err) {
                reject(err);
            }
            bcrypt.hash(password, salt, (err, hash) => {
                if (err) {
                    reject(err);
                }
                resolve(hash);
            });
        });
    });
};

// password from frontend and hash from database
export const comparePassword = (password: string, hash: string): Promise<boolean> => {
    return bcrypt.compare(password, hash);
};

export const encrypt = (text: string): string => {
    const ivLength = 16;
    const iv = crypto.randomBytes(ivLength);
    const algorithm = 'aes-256-cbc';

    // Retrieve the encryption key or generate a new one if invalid or empty
    let key = getEnvVariable('ENCRYPTION_KEY');
    if (!key || key.length !== 64) { // aes-256-cbc requires a 256-bit key, which is 64 hex characters
        console.warn('Invalid or missing ENCRYPTION_KEY, generating a new one.');
        key = crypto.randomBytes(32).toString('hex'); // Generate a new 256-bit (32-byte) key
    }
    const keyBuffer = Buffer.from(key, 'hex');

    const cipher = crypto.createCipheriv(algorithm, keyBuffer, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
};

export const decrypt = (encryptedText: string): string => {
    const [iv, encrypted] = encryptedText.split(':');
    const algorithm = "aes-256-cbc";

    // Retrieve the encryption key or generate a new one if invalid or empty
    let key = getEnvVariable('ENCRYPTION_KEY');
    if (!key || key.length !== 64) { // aes-256-cbc requires a 256-bit key, which is 64 hex characters
        console.warn('Invalid or missing ENCRYPTION_KEY, generating a new one.');
        key = crypto.randomBytes(32).toString('hex'); // Generate a new 256-bit (32-byte) key
    }
    const keyBuffer = Buffer.from(key, 'hex');

    const decipher = crypto.createDecipheriv(algorithm, keyBuffer, Buffer.from(iv, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
};
