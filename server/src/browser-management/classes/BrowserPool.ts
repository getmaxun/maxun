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

