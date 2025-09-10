import { RemoteBrowser } from "./RemoteBrowser";
import logger from "../../logger";

/**
 * @category Types
 */
/**
 * Represents the possible states of a remote browser.
 * @category Types
 */
type BrowserState = "recording" | "run";

interface BrowserPoolInfo {
    /**
     * The instance of remote browser.
     */
    browser: RemoteBrowser | null,
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
    /**
     * The current state of the browser.
     * Can be "recording" or "run".
     * @default "recording"
     */
    state: BrowserState,
    /**
     * The status of the browser instance.
     * Can be "reserved", "initializing", "ready" or "failed".
     */
    status?: "reserved" | "initializing" | "ready" | "failed",
    /**
     * Timestamp when the browser slot was created/reserved
     */
    createdAt?: number,
    /**
     * Timestamp when the browser was last accessed
     */
    lastAccessed?: number,
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
 * Enforces a "1 User - 2 Browser" policy, while allowing multiple users to have their own browser instances.
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
     * A user can have up to 2 browsers.
     */
    private userToBrowserMap: Map<string, string[]> = new Map();

    /**
     * Locks for atomic operations to prevent race conditions
     * Key format: "userId-state", Value: timestamp when lock was acquired
     */
    private reservationLocks: Map<string, number> = new Map();

    /**
     * Adds a remote browser instance to the pool for a specific user.
     * If the user already has two browsers, the oldest browser will be closed and replaced.
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
        active: boolean = false,
        state: BrowserState = "recording"
    ): boolean => {
        // Check if browser with this ID already exists and belongs to this user
        if (this.pool[id] && this.pool[id].userId === userId) {
            // Just update the existing browser
            this.pool[id] = {
                browser,
                active,
                userId,
                state: this.pool[id].state || state,
            };
            logger.log('debug', `Updated existing browser with id: ${id} for user: ${userId}`);
            return false;
        }

        // Get existing browsers for this user
        let userBrowserIds = this.userToBrowserMap.get(userId) || [];
        let replaced = false;

        // If trying to add a "recording" browser, check if one already exists
        if (state === "recording") {
            // Check if user already has a recording browser
            const hasRecordingBrowser = userBrowserIds.some(browserId => 
                this.pool[browserId] && this.pool[browserId].state === "recording"
            );
            
            if (hasRecordingBrowser) {
                logger.log('debug', `User ${userId} already has a browser in "recording" state`);
                return false;
            }
        }
        
        // For "run" state, check if the user already has the maximum number of browsers (2)
        if (userBrowserIds.length >= 2 && !userBrowserIds.includes(id)) {
            logger.log('debug', "User already has the maximum number of browsers (2)");
            return false;
        }

        // Add the new browser to the pool
        this.pool[id] = {
            browser,
            active,
            userId,
            state,
        };

        // Update the user-to-browser mapping
        if (!userBrowserIds.includes(id)) {
            userBrowserIds.push(id);
        }
        this.userToBrowserMap.set(userId, userBrowserIds);

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
        const userBrowserIds = this.userToBrowserMap.get(userId) || [];
        
        if (userBrowserIds.includes(id)) {
            const updatedBrowserIds = userBrowserIds.filter(bid => bid !== id);
            
            if (updatedBrowserIds.length === 0) {
                this.userToBrowserMap.delete(userId);
            } else {
                this.userToBrowserMap.set(userId, updatedBrowserIds);
            }
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
        const userBrowserIds = this.userToBrowserMap.get(userId) || [];
        
        if (userBrowserIds.includes(id)) {
            const updatedBrowserIds = userBrowserIds.filter(bid => bid !== id);
            
            if (updatedBrowserIds.length === 0) {
                this.userToBrowserMap.delete(userId);
            } else {
                this.userToBrowserMap.set(userId, updatedBrowserIds);
            }
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
        const poolInfo = this.pool[id];
        if (!poolInfo) {
            return undefined;
        }
        
        // Return undefined for reserved slots (browser is null)
        if (poolInfo.status === "reserved") {
            logger.log('debug', `Browser ${id} is reserved but not yet ready`);
            return undefined;
        }
        
        // Return undefined for failed slots
        if (poolInfo.status === "failed") {
            logger.log('debug', `Browser ${id} has failed status`);
            return undefined;
        }
        
        return poolInfo.browser || undefined;
    };

    /**
     * Returns the active browser's instance id for a specific user.
     * If state is specified, only returns a browser with that exact state.
     * 
     * @param userId the user ID to find the browser for
     * @param state optional browser state filter ("recording" or "run")
     * @returns the browser ID for the user, or null if no browser exists with the required state
     */
    public getActiveBrowserId = (userId: string, state?: BrowserState): string | null => {
        const browserIds = this.userToBrowserMap.get(userId);
        if (!browserIds || browserIds.length === 0) {
            logger.log('debug', `No browser found for user: ${userId}`);
            return null;
        }

        // If state is specified, only return browsers with that exact state
        if (state) {
            // Check browsers in reverse order (newest first) to find one with the specified state
            for (let i = browserIds.length - 1; i >= 0; i--) {
                const browserId = browserIds[i];
                
                // Verify the browser still exists in the pool
                if (!this.pool[browserId]) {
                    browserIds.splice(i, 1);
                    continue;
                }
                
                // Check if browser matches state filter
                if (this.pool[browserId].state === state) {
                    return browserId;
                }
            }
            
            // If no browser with matching state, return null
            logger.log('debug', `No browser with state ${state} found for user: ${userId}`);
            return null;
        }
        
        // If no state specified, return any browser
        for (let i = browserIds.length - 1; i >= 0; i--) {
            const browserId = browserIds[i];
            
            // Verify the browser still exists in the pool
            if (!this.pool[browserId]) {
                browserIds.splice(i, 1);
                continue;
            }
            
            // Return the first browser found
            if (this.pool[browserId]) {
                console.log(`Active browser Id ${browserId} found for user: ${userId}`);
                return browserId;
            }
        }
        
        // If no active browser, return the most recent one
        if (browserIds.length > 0) {
            const mostRecentId = browserIds[browserIds.length - 1];
            console.log(`No active browser found, returning most recent browser Id ${mostRecentId} for user: ${userId}`);
            return mostRecentId;
        }
        
        // Clean up the mapping if all browsers were invalid
        if (browserIds.length === 0) {
            this.userToBrowserMap.delete(userId);
        }
        
        logger.log('warn', `Browser mapping found for user: ${userId}, but no valid browsers exist in pool`);
        return null;
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
     * Sets the state of a browser.
     * Only allows one browser in "recording" state per user.
     * 
     * @param id the browser ID
     * @param state the new state ("recording" or "run")
     * @returns true if successful, false if the browser wasn't found or state change not allowed
     */
    public setBrowserState = (id: string, state: BrowserState): boolean => {
        if (!this.pool[id]) {
            logger.log('warn', `Remote browser with id: ${id} does not exist in the pool`);
            return false;
        }

        // If trying to set to "recording" state, check if another browser is already recording
        if (state === "recording") {
            const userId = this.pool[id].userId;
            const userBrowserIds = this.userToBrowserMap.get(userId) || [];
            
            // Check if any other browser for this user is already in recording state
            const hasAnotherRecordingBrowser = userBrowserIds.some(browserId => 
                browserId !== id && 
                this.pool[browserId] && 
                this.pool[browserId].state === "recording"
            );
            
            if (hasAnotherRecordingBrowser) {
                logger.log('warn', `Cannot set browser ${id} to "recording" state: User ${userId} already has a browser in recording state`);
                return false;
            }
        }

        this.pool[id].state = state;
        logger.log('debug', `Remote browser with id: ${id} state set to ${state}`);
        return true;
    };
    
    /**
     * Gets the current state of a browser.
     * 
     * @param id the browser ID
     * @returns the current state or null if the browser wasn't found
     */
    public getBrowserState = (id: string): BrowserState | null => {
        if (!this.pool[id]) {
            logger.log('warn', `Remote browser with id: ${id} does not exist in the pool`);
            return null;
        }
        
        return this.pool[id].state;
    };

    /**
     * Returns all browser instances for a specific user.
     * With the "1 User - 2 Browser" policy, this can return up to 2 browsers.
     * 
     * @param userId the user ID to find browsers for
     * @returns an array of browser IDs belonging to the user
     */
    public getAllBrowserIdsForUser = (userId: string): string[] => {
        const browserIds: string[] = [];
        
        // Get browser IDs from the map
        const mappedBrowserIds = this.userToBrowserMap.get(userId) || [];
        
        // Filter to only include IDs that exist in the pool
        for (const id of mappedBrowserIds) {
            if (this.pool[id]) {
                browserIds.push(id);
            }
        }
        
        // As a safeguard, also check the entire pool for any browsers assigned to this user
        // This helps detect and fix any inconsistencies in the maps
        for (const [id, info] of Object.entries(this.pool)) {
            if (info.userId === userId && !browserIds.includes(id)) {
                browserIds.push(id);
            }
        }
        
        // Update the map if inconsistencies were found
        if (browserIds.length > 0 && JSON.stringify(browserIds) !== JSON.stringify(mappedBrowserIds)) {
            // Limit to 2 browsers if more were found
            const limitedBrowserIds = browserIds.slice(-2);
            this.userToBrowserMap.set(userId, limitedBrowserIds);
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
     * @param state Optional state filter to find browsers in a specific state
     * @returns A browser ID if one can be determined, or null
     */
    public getActiveBrowserForMigration = (currentUserId?: string, state?: BrowserState): string | null => {
        // If a current user ID is provided and they have a browser, return that
        if (currentUserId) {
            const browserForUser = this.getActiveBrowserId(currentUserId, state);
            if (browserForUser) {
                return browserForUser;
            }
            
            // If state is specified and no matching browser was found, return null
            if (state) {
                return null;
            }
        }
        
        // If only one user has a browser, try to find a matching browser
        if (this.userToBrowserMap.size === 1) {
            const userId = Array.from(this.userToBrowserMap.keys())[0];
            const browserIds = this.userToBrowserMap.get(userId) || [];
            
            // If state is specified, only look for that state
            if (state) {
                // Return the active browser that matches the state
                for (let i = browserIds.length - 1; i >= 0; i--) {
                    const bid = browserIds[i];
                    if (this.pool[bid]?.active && this.pool[bid].state === state) {
                        return bid;
                    }
                }
                
                // If no active browser with matching state, try to find any browser with matching state
                for (let i = browserIds.length - 1; i >= 0; i--) {
                    const bid = browserIds[i];
                    if (this.pool[bid] && this.pool[bid].state === state) {
                        return bid;
                    }
                }
                
                // If still no matching browser, return null
                return null;
            }
            
            // If no state filter, find any active browser
            for (let i = browserIds.length - 1; i >= 0; i--) {
                if (this.pool[browserIds[i]]?.active) {
                    return browserIds[i];
                }
            }
            
            return browserIds.length > 0 ? browserIds[browserIds.length - 1] : null;
        }
        
        // Fall back to checking all browsers if no user was specified
        if (state) {
            // Look for active browsers with the specific state
            for (const id of Object.keys(this.pool)) {
                if (this.pool[id].active && this.pool[id].state === state) {
                    return id;
                }
            }
            
            // Then look for any browser with the specific state
            for (const id of Object.keys(this.pool)) {
                if (this.pool[id].state === state) {
                    return id;
                }
            }
            
            // If no browser with the requested state is found, return null
            return null;
        }
        
        // If no state filter, find any active browser
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
     * Checks if there are available browser slots for a user.
     * Returns true if user has available slots AND none of their active browsers are in "recording" state.
     * @param userId the user ID to check browser slots for
     * @returns {boolean} true if user has available slots and no recording browsers, false otherwise
     */
    public hasAvailableBrowserSlots = (userId: string, state?: BrowserState): boolean => {
        const userBrowserIds = this.userToBrowserMap.get(userId) || [];
        
        if (userBrowserIds.length >= 2) {
            return false;
        }
        
        if (state === "recording") {
            const hasBrowserInState = userBrowserIds.some(browserId => 
                this.pool[browserId] && this.pool[browserId].state === "recording"
            );
            return !hasBrowserInState;
        }
        
        return true;
    };

    /**
     * Returns the first active browser's instance id from the pool.
     * If there is no active browser, it returns null.
     * If there are multiple active browsers, it returns the first one.
     * 
     * @returns the first remote active browser instance's id from the pool
     * @deprecated Use getBrowserIdForUser instead to enforce the 1 User - 2 Browser policy
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

    /**
     * Reserves a browser slot atomically to prevent race conditions.
     * This ensures slot counting is accurate for rapid successive requests.
     * 
     * @param id browser ID to reserve
     * @param userId user ID that owns this reservation
     * @param state browser state ("recording" or "run")
     * @returns true if slot was reserved, false if user has reached limit
     */
    public reserveBrowserSlotAtomic = (id: string, userId: string, state: BrowserState = "run"): boolean => {
        const lockKey = `${userId}-${state}`;
        
        if (this.reservationLocks.has(lockKey)) {
            logger.log('debug', `Reservation already in progress for user ${userId} state ${state}`);
            return false;
        }
        
        try {
            this.reservationLocks.set(lockKey, Date.now());
            
            if (!this.hasAvailableBrowserSlots(userId, state)) {
                logger.log('debug', `Cannot reserve slot for user ${userId}: no available slots`);
                return false;
            }

            if (this.pool[id]) {
                logger.log('debug', `Browser slot ${id} already exists`);
                return false;
            }

            const now = Date.now();
            
            this.pool[id] = {
                browser: null,
                active: false,
                userId,
                state,
                status: "reserved",
                createdAt: now,
                lastAccessed: now
            };

            const userBrowserIds = this.userToBrowserMap.get(userId) || [];
            if (!userBrowserIds.includes(id)) {
                userBrowserIds.push(id);
                this.userToBrowserMap.set(userId, userBrowserIds);
            }

            logger.log('info', `Atomically reserved browser slot ${id} for user ${userId} in state ${state}`);
            return true;
            
        } catch (error: any) {
            logger.log('error', `Error during atomic slot reservation: ${error.message}`);
            if (this.pool[id] && this.pool[id].status === "reserved") {
                this.deleteRemoteBrowser(id);
            }
            return false;
        } finally {
            this.reservationLocks.delete(lockKey);
        }
    };

    /**
     * Legacy method - kept for backwards compatibility but now uses atomic version
     * @deprecated Use reserveBrowserSlotAtomic instead
     */
    public reserveBrowserSlot = (id: string, userId: string, state: BrowserState = "run"): boolean => {
        return this.reserveBrowserSlotAtomic(id, userId, state);
    };

    /**
     * Upgrades a reserved slot to an actual browser instance.
     * 
     * @param id browser ID that was previously reserved
     * @param browser the actual RemoteBrowser instance
     * @returns true if successful, false if slot wasn't reserved
     */
    public upgradeBrowserSlot = (id: string, browser: RemoteBrowser): boolean => {
        if (!this.pool[id]) {
            logger.log('warn', `Cannot upgrade browser ${id}: slot does not exist in pool`);
            return false;
        }
        
        if (this.pool[id].status !== "reserved") {
            logger.log('warn', `Cannot upgrade browser ${id}: slot not in reserved state (current: ${this.pool[id].status})`);
            return false;
        }

        this.pool[id].browser = browser;
        this.pool[id].status = "ready";
        logger.log('info', `Upgraded browser slot ${id} to ready state`);
        return true;
    };

    /**
     * Marks a reserved slot as failed and removes it with proper cleanup.
     * 
     * @param id browser ID to mark as failed
     */
    public failBrowserSlot = (id: string): void => {
        if (this.pool[id]) {
            logger.log('info', `Marking browser slot ${id} as failed`);
            
            // Attempt to cleanup browser resources before deletion
            const browserInfo = this.pool[id];
            if (browserInfo.browser) {
                try {
                    // Try to close browser if it exists
                    browserInfo.browser.switchOff?.().catch((error: any) => {
                        logger.log('warn', `Error closing failed browser ${id}: ${error.message}`);
                    });
                } catch (error: any) {
                    logger.log('warn', `Error during browser cleanup for ${id}: ${error.message}`);
                }
            }
            
            this.deleteRemoteBrowser(id);
        }
    };

    /**
     * Cleanup stale browser slots that have been in reserved/initializing state too long
     * This prevents resource leaks from failed initializations
     */
    public cleanupStaleBrowserSlots = (): void => {
        const now = Date.now();
        const staleThreshold = 5 * 60 * 1000; // 5 minutes
        
        const staleSlots: string[] = [];
        
        for (const [id, info] of Object.entries(this.pool)) {
            const isStale = info.status === "reserved" || info.status === "initializing";
            const createdAt = info.createdAt || 0;
            const age = now - createdAt;
            
            if (isStale && info.browser === null && age > staleThreshold) {
                staleSlots.push(id);
            }
        }
        
        staleSlots.forEach(id => {
            const info = this.pool[id];
            logger.log('warn', `Cleaning up stale browser slot ${id} with status ${info.status}, age: ${Math.round((now - (info.createdAt || 0)) / 1000)}s`);
            this.failBrowserSlot(id);
        });
        
        if (staleSlots.length > 0) {
            logger.log('info', `Cleaned up ${staleSlots.length} stale browser slots`);
        }
        
        this.cleanupStaleReservationLocks();
    };

    /**
     * Cleans up reservation locks that are older than 1 minute
     * This prevents locks from being held indefinitely due to crashes
     */
    private cleanupStaleReservationLocks = (): void => {
        const now = Date.now();
        const lockTimeout = 60 * 1000; // 1 minute
        
        const staleLocks: string[] = [];
        
        for (const [lockKey, timestamp] of this.reservationLocks.entries()) {
            if (now - timestamp > lockTimeout) {
                staleLocks.push(lockKey);
            }
        }
        
        staleLocks.forEach(lockKey => {
            this.reservationLocks.delete(lockKey);
        });
        
        if (staleLocks.length > 0) {
            logger.log('warn', `Cleaned up ${staleLocks.length} stale reservation locks`);
        }
    };

    /**
     * Gets the current status of a browser slot.
     * 
     * @param id browser ID to check
     * @returns the status or null if browser doesn't exist
     */
    public getBrowserStatus = (id: string): "reserved" | "initializing" | "ready" | "failed" | null => {
        if (!this.pool[id]) {
            return null;
        }
        return this.pool[id].status || null;
    };

    /**
     * Returns all browser instances in the pool.
     * Used for cleanup operations like graceful shutdown.
     * 
     * @returns Map of browser IDs to browser instances
     */
    public getAllBrowsers = (): Map<string, RemoteBrowser> => {
        const browsers = new Map<string, RemoteBrowser>();
        
        for (const [id, info] of Object.entries(this.pool)) {
            if (info.browser) {
                browsers.set(id, info.browser);
            }
        }
        
        return browsers;
    };
}