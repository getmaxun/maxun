import crypto from 'crypto';

export const genAPIKey = (): string => {
    return crypto.randomBytes(24).toString('base64url');
};
