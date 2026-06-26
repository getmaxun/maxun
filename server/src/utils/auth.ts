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

    const key = getEnvVariable('ENCRYPTION_KEY');
    if (!key || key.length !== 64) {
        throw new Error('ENCRYPTION_KEY is missing or invalid. Set a 64-character hex string in your .env file.');
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

    const key = getEnvVariable('ENCRYPTION_KEY');
    if (!key || key.length !== 64) {
        throw new Error('ENCRYPTION_KEY is missing or invalid. Set a 64-character hex string in your .env file.');
    }
    const keyBuffer = Buffer.from(key, 'hex');

    const decipher = crypto.createDecipheriv(algorithm, keyBuffer, Buffer.from(iv, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
};

export const safeDecrypt = (value: string): string => {
    if (value.includes(':')) {
        try {
            return decrypt(value);
        } catch {
            return value;
        }
    }
    return value;
};
