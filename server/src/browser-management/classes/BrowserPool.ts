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
 * Adds the possibility to add, remove and retrieve remote browsers from the pool.
 * It is possible to manage multiple browsers for creating or running a recording.
 * @category BrowserManagement
 */
export class BrowserPool {

    /**
     * Holds all the instances of remote browsers.
     */
    private pool: PoolDictionary = {};

    /**
     * Adds a remote browser instance to the pool indexed by the id.
     * @param id remote browser instance's id
     * @param browser remote browser instance
     * @param active states if the browser's instance is being actively used
     */
    public addRemoteBrowser = (id: string, browser: RemoteBrowser, active: boolean = false): void => {
        this.pool = {
            ...this.pool,
            [id]: {
                browser,
                active,
            },
        }
        logger.log('debug', `Remote browser with id: ${id} added to the pool`);
    };

    /**
     * Removes the remote browser instance from the pool.
     * @param id remote browser instance's id
     * @returns true if the browser was removed successfully, false otherwise
     */
    public deleteRemoteBrowser = (id: string): boolean => {
        if (!this.pool[id]) {
            logger.log('warn', `Remote browser with id: ${id} does not exist in the pool`);
            return false;
        }
        delete (this.pool[id]);
        logger.log('debug', `Remote browser with id: ${id} deleted from the pool`);
        return true;
    };

    /**
     * Returns the remote browser instance from the pool.
     * @param id remote browser instance's id
     * @returns remote browser instance or undefined if it does not exist in the pool
     */
    public getRemoteBrowser = (id: string): RemoteBrowser | undefined => {
        logger.log('debug', `Remote browser with id: ${id} retrieved from the pool`);
        return this.pool[id]?.browser;
    };

    /**
     * Returns the active browser's instance id from the pool.
     * If there is no active browser, it returns undefined.
     * If there are multiple active browsers, it returns the first one.
     * @returns the first remote active browser instance's id from the pool
     */
    public getActiveBrowserId = (): string | null => {
        for (const id of Object.keys(this.pool)) {
            if (this.pool[id].active) {
                return id;
            }
        }
        logger.log('warn', `No active browser in the pool`);
        return null;
    };
}
