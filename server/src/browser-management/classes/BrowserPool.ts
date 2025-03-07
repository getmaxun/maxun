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
    
}