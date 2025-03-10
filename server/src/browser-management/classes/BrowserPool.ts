import { RemoteBrowser } from "./RemoteBrowser";
import logger from "../../logger";

/**
 * @category Types
 */
interface BrowserPoolInfo {
    /**
     * The instance of remote browser.
     */
    browser: RemoteBrowser,
    /**
     * States if the browser's instance is being actively used.
     * Helps to persist the progress on the frontend when the application has been reloaded.
     * @default false
     */
    active: boolean,
    /**
     * The user ID that owns this browser instance.
     */
    userId: string,
}

/**
 * Dictionary of all the active remote browser's instances indexed by their id.
 * The value in this dictionary is of type BrowserPoolInfo,
 * which provides additional information about the browser's usage.
 * @category Types
 */
interface PoolDictionary {
    [key: string]: BrowserPoolInfo,
}

/**
 * A browser pool is a collection of remote browsers that are initialized and ready to be used.
 * Enforces a "1 User - 1 Browser" policy, while allowing multiple users to have their own browser instances.
 * Adds the possibility to add, remove and retrieve remote browsers from the pool.
 * @category BrowserManagement
 */
export class BrowserPool {
    /**
     * Holds all the instances of remote browsers.
     */
    private pool: PoolDictionary = {};

    /**
     * Maps user IDs to their browser IDs.
     */
    private userToBrowserMap: Map<string, string> = new Map();

    /**
     * Adds a remote browser instance to the pool for a specific user.
     * If the user already has a browser, the existing browser will be closed and replaced.
     * 
     * @param id remote browser instance's id
     * @param browser remote browser instance
     * @param userId the user ID that owns this browser instance
     * @param active states if the browser's instance is being actively used
     * @returns true if a new browser was added, false if an existing browser was replaced
     */
    public addRemoteBrowser = (
        id: string, 
        browser: RemoteBrowser, 
        userId: string,
        active: boolean = false
    ): boolean => {
        // Check if user already has a browser
        const existingBrowserId = this.userToBrowserMap.get(userId);
        let replaced = false;

        if (existingBrowserId) {
            // Close and remove the existing browser
            if (existingBrowserId !== id) {
                this.closeAndDeleteBrowser(existingBrowserId);
                replaced = true;
            } else {
                // If it's the same browser ID, just update the info
                this.pool[id] = {
                    browser,
                    active,
                    userId,
                };
                logger.log('debug', `Updated existing browser with id: ${id} for user: ${userId}`);
                return false;
            }
        }

        // Add the new browser to the pool
        this.pool[id] = {
            browser,
            active,
            userId,
        };

        // Update the user-to-browser mapping
        this.userToBrowserMap.set(userId, id);

        logger.log('debug', `Remote browser with id: ${id} added to the pool for user: ${userId}`);
        return !replaced;
    };

    /**
     * Removes the remote browser instance from the pool.
     * Note: This doesn't handle browser closing as RemoteBrowser doesn't expose a close method.
     * The caller should ensure the browser is properly closed before calling this method.
     * 
     * @param id remote browser instance's id
     * @returns true if the browser was removed successfully, false otherwise
     */
    public closeAndDeleteBrowser = (id: string): boolean => {
        if (!this.pool[id]) {
            logger.log('warn', `Remote browser with id: ${id} does not exist in the pool`);
            return false;
        }

        // Remove the user-to-browser mapping
        const userId = this.pool[id].userId;
        if (this.userToBrowserMap.get(userId) === id) {
            this.userToBrowserMap.delete(userId);
        }

        // Remove from pool
        delete this.pool[id];
        logger.log('debug', `Remote browser with id: ${id} removed from the pool`);
        return true;
    };

    /**
     * Removes the remote browser instance from the pool without attempting to close it.
     * 
     * @param id remote browser instance's id
     * @returns true if the browser was removed successfully, false otherwise
     */
    public deleteRemoteBrowser = (id: string): boolean => {
        if (!this.pool[id]) {
            logger.log('warn', `Remote browser with id: ${id} does not exist in the pool`);
            return false;
        }

        // Remove the user-to-browser mapping
        const userId = this.pool[id].userId;
        if (this.userToBrowserMap.get(userId) === id) {
            this.userToBrowserMap.delete(userId);
        }

        // Remove from pool
        delete this.pool[id];
        logger.log('debug', `Remote browser with id: ${id} deleted from the pool`);
        return true;
    };

    /**
     * Returns the remote browser instance from the pool.
     * 
     * @param id remote browser instance's id
     * @returns remote browser instance or undefined if it does not exist in the pool
     */
    public getRemoteBrowser = (id: string): RemoteBrowser | undefined => {
        logger.log('debug', `Remote browser with id: ${id} retrieved from the pool`);
        return this.pool[id]?.browser;
    };

    /**
     * Returns the active browser's instance id for a specific user.
     * 
     * @param userId the user ID to find the browser for
     * @returns the browser ID for the user, or null if no browser exists
     */
    public getActiveBrowserId = (userId: string): string | null => {
        const browserId = this.userToBrowserMap.get(userId);
        if (!browserId) {
            logger.log('debug', `No browser found for user: ${userId}`);
            return null;
        }

        // Verify the browser still exists in the pool
        if (!this.pool[browserId]) {
            this.userToBrowserMap.delete(userId);
            logger.log('warn', `Browser mapping found for user: ${userId}, but browser doesn't exist in pool`);
            return null;
        }
        console.log(`Browser Id ${browserId} found for user: ${userId}`);
        return browserId;
    };

    /**
     * Returns the user ID associated with a browser ID.
     * 
     * @param browserId the browser ID to find the user for
     * @returns the user ID for the browser, or null if the browser doesn't exist
     */
    public getUserForBrowser = (browserId: string): string | null => {
        if (!this.pool[browserId]) {
            return null;
        }
        return this.pool[browserId].userId;
    };

    /**
     * Sets the active state of a browser.
     * 
     * @param id the browser ID
     * @param active the new active state
     * @returns true if successful, false if the browser wasn't found
     */
    public setActiveBrowser = (id: string, active: boolean): boolean => {
        if (!this.pool[id]) {
            logger.log('warn', `Remote browser with id: ${id} does not exist in the pool`);
            return false;
        }

        this.pool[id].active = active;
        logger.log('debug', `Remote browser with id: ${id} set to ${active ? 'active' : 'inactive'}`);
        return true;
    };

    /**
     * Returns all browser instances for a specific user.
     * Should only be one per the "1 User - 1 Browser" policy, but included for flexibility.
     * 
     * @param userId the user ID to find browsers for
     * @returns an array of browser IDs belonging to the user
     */
    public getAllBrowserIdsForUser = (userId: string): string[] => {
        const browserIds: string[] = [];
        
        // Normally this would just return the one browser from the map
        const mappedBrowserId = this.userToBrowserMap.get(userId);
        if (mappedBrowserId && this.pool[mappedBrowserId]) {
            browserIds.push(mappedBrowserId);
        }
        
        // But as a safeguard, also check the entire pool for any browsers assigned to this user
        // This helps detect and fix any inconsistencies in the maps
        for (const [id, info] of Object.entries(this.pool)) {
            if (info.userId === userId && !browserIds.includes(id)) {
                browserIds.push(id);
                // Fix the map if it's inconsistent
                if (!mappedBrowserId) {
                    this.userToBrowserMap.set(userId, id);
                }
            }
        }
        
        return browserIds;
    };

    /**
     * Returns the total number of browsers in the pool.
     */
    public getPoolSize = (): number => {
        return Object.keys(this.pool).length;
    };

    /**
     * Returns the total number of active users (users with browsers).
     */
    public getActiveUserCount = (): number => {
        return this.userToBrowserMap.size;
    };
    
    /**
     * Gets the current active browser for the system if there's only one active user.
     * This is a migration helper to support code that hasn't been updated to the user-browser model yet.
     * 
     * @param currentUserId The ID of the current user, which will be prioritized if multiple browsers exist
     * @returns A browser ID if one can be determined, or null
     */
    public getActiveBrowserForMigration = (currentUserId?: string): string | null => {
        // If a current user ID is provided and they have a browser, return that
        if (currentUserId) {
            const browserForUser = this.getActiveBrowserId(currentUserId);
            if (browserForUser) {
                return browserForUser;
            }
        }
        
        // If only one user has a browser, return that
        if (this.userToBrowserMap.size === 1) {
            const userId = Array.from(this.userToBrowserMap.keys())[0];
            return this.userToBrowserMap.get(userId) || null;
        }
        
        // Fall back to the first active browser if any
        for (const id of Object.keys(this.pool)) {
            if (this.pool[id].active) {
                return id;
            }
        }
        
        // If all else fails, return the first browser in the pool
        const browserIds = Object.keys(this.pool);
        return browserIds.length > 0 ? browserIds[0] : null;
    };

    /**
     * Returns the first active browser's instance id from the pool.
     * If there is no active browser, it returns null.
     * If there are multiple active browsers, it returns the first one.
     * 
     * @returns the first remote active browser instance's id from the pool
     * @deprecated Use getBrowserIdForUser instead to enforce the 1 User - 1 Browser policy
     */
    public getActiveBrowserIdLegacy = (): string | null => {
        for (const id of Object.keys(this.pool)) {
            if (this.pool[id].active) {
                return id;
            }
        }
        // Don't log a warning since this behavior is expected in the user-browser model
        // logger.log('warn', `No active browser in the pool`);
        return null;
    };
}