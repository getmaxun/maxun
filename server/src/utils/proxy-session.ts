import crypto from 'crypto';

const SESSION_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SESSION_ID_LENGTH = 10;

/**
 * Random sticky-session id for a proxy username. Lowercase alphanumeric only,
 * which every major residential provider accepts in the session field, and long
 * enough that concurrent runs on one account do not share an exit IP.
 */
export const newProxySessionId = (): string => {
    let id = '';
    for (let i = 0; i < SESSION_ID_LENGTH; i++) {
        id += SESSION_ID_ALPHABET[crypto.randomInt(SESSION_ID_ALPHABET.length)];
    }
    return id;
};

/**
 * Expands the `{session}` placeholder in a proxy username. Residential proxy
 * providers key sticky sessions on the username, so a fresh id gives each
 * browser session its own exit IP. Usernames without the placeholder pass
 * through unchanged.
 */
export const expandSessionPlaceholder = (username: string | null, sessionId?: string): string | null => {
    if (!username || !username.includes('{session}')) return username;
    return username.replace(/\{session\}/g, sessionId ?? newProxySessionId());
};
