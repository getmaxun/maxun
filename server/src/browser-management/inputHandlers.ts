/**
 * A set of functions handling reproduction of user input
 * on the remote browser instance as well as the generation of workflow pairs.
 * These functions are called by the client through socket communication.
 */
import { Socket } from 'socket.io';
import logger from "../logger";
import { Coordinates, ScrollDeltas, KeyboardInput, DatePickerEventData } from '../types';
import { browserPool } from "../server";
import { WorkflowGenerator } from "../workflow-management/classes/Generator";
import { Page } from "playwright";
import { throttle } from "../../../src/helpers/inputHelpers";
import { CustomActions } from "../../../src/shared/types";

/**
 * A wrapper function for handling user input.
 * This function gets the active browser instance from the browser pool
 * and passes necessary arguments to the appropriate handlers.
 * e.g. {@link Generator}, {@link RemoteBrowser.currentPage}
 *
 * Also ignores any user input while interpretation is in progress.
 *
 * @param handleCallback The callback handler to be called
 * @param args - arguments to be passed to the handler
 * @param socket - socket with authenticated request
 * @category HelperFunctions
 */
const handleWrapper = async (
    handleCallback: (
        generator: WorkflowGenerator,
        page: Page,
        args?: any
    ) => Promise<void>,
    userId: string,
    args?: any
) => {
    const id = browserPool.getActiveBrowserId(userId, "recording");
    if (id) {
        const activeBrowser = browserPool.getRemoteBrowser(id);
        if (activeBrowser?.interpreter.interpretationInProgress() && !activeBrowser.interpreter.interpretationIsPaused) {
            logger.log('debug', `Ignoring input, while interpretation is in progress`);
            return;
        }
        const currentPage = activeBrowser?.getCurrentPage();
        if (currentPage && activeBrowser) {
            if (args) {
                await handleCallback(activeBrowser.generator, currentPage, args);
            } else {
                await handleCallback(activeBrowser.generator, currentPage);
            }
        } else {
            logger.log('warn', `No active page for browser ${id}`);
        }
    } else {
        logger.log('warn', `No active browser for id ${id}`);
    }
}

/**
 * An interface for custom action description.
 * @category Types
 */
interface CustomActionEventData {
    action: CustomActions;
    settings: any;
}

/**
 * A wrapper function for handling custom actions.
 * @param socket The socket connection
 * @param customActionEventData The custom action event data
 * @category HelperFunctions
 */
const onGenerateAction = async (customActionEventData: CustomActionEventData, userId: string) => {
    logger.log('debug', `Generating ${customActionEventData.action} action emitted from client`);
    await handleWrapper(handleGenerateAction, userId, customActionEventData);
}

/**
 * Handles the generation of a custom action workflow pair.
 * @param generator The workflow generator
 * @param page The active page
 * @param action The custom action
 * @param settings The custom action settings
 * @category BrowserManagement
 */
const handleGenerateAction =
    async (generator: WorkflowGenerator, page: Page, { action, settings }: CustomActionEventData) => {
        await generator.customAction(action, settings, page);
    }

/**
 * A wrapper function for handling mousedown event.
 * @param socket The socket connection
 * @param coordinates - coordinates of the mouse click
 * @category HelperFunctions
 */
const onMousedown = async (coordinates: Coordinates, userId: string) => {
    logger.log('debug', 'Handling mousedown event emitted from client');
    await handleWrapper(handleMousedown, userId, coordinates);
}

/**
 * A mousedown event handler.
 * Reproduces the click on the remote browser instance
 * and generates pair data for the recorded workflow.
 * @param generator - the workflow generator {@link Generator}
 * @param page - the active page of the remote browser
 * @param x - the x coordinate of the mousedown event
 * @param y - the y coordinate of the mousedown event
 * @category BrowserManagement
 */
const handleMousedown = async (generator: WorkflowGenerator, page: Page, { x, y }: Coordinates) => {
    await generator.onClick({ x, y }, page);
    const previousUrl = page.url();
    const tabsBeforeClick = page.context().pages().length;
    await page.mouse.click(x, y);
    // try if the click caused a navigation to a new url
    try {
        await page.waitForNavigation({ timeout: 2000 });
        const currentUrl = page.url();
        if (currentUrl !== previousUrl) {
            generator.notifyUrlChange(currentUrl);
        }
    } catch (e) {
        const { message } = e as Error;
    } //ignore possible timeouts

    // check if any new page was opened by the click
    const tabsAfterClick = page.context().pages().length;
    const numOfNewPages = tabsAfterClick - tabsBeforeClick;
    if (numOfNewPages > 0) {
        for (let i = 1; i <= numOfNewPages; i++) {
            const newPage = page.context().pages()[tabsAfterClick - i];
            if (newPage) {
                generator.notifyOnNewTab(newPage, tabsAfterClick - i);
            }
        }
    }
    logger.log('debug', `Clicked on position x:${x}, y:${y}`);
};

/**
 * A wrapper function for handling the wheel event.
 * @param socket The socket connection 
 * @param scrollDeltas - the scroll deltas of the wheel event
 * @category HelperFunctions
 */
const onWheel = async (scrollDeltas: ScrollDeltas, userId: string) => {
    logger.log('debug', 'Handling scroll event emitted from client');
    await handleWrapper(handleWheel, userId, scrollDeltas);
};

/**
 * A wheel event handler.
 * Reproduces the wheel event on the remote browser instance.
 * Scroll is not generated for the workflow pair. This is because
 * Playwright scrolls elements into focus on any action.
 * @param generator - the workflow generator {@link Generator}
 * @param page - the active page of the remote browser
 * @param deltaX - the delta x of the wheel event
 * @param deltaY - the delta y of the wheel event
 * @category BrowserManagement
 */
const handleWheel = async (generator: WorkflowGenerator, page: Page, { deltaX, deltaY }: ScrollDeltas) => {
    try {
        if (page.isClosed()) {
            return;
        }
        
        await page.mouse.wheel(deltaX, deltaY).catch(error => {
            logger.log('warn', `Wheel event failed: ${error.message}`);
        });    
        logger.log('debug', `Scrolled horizontally ${deltaX} pixels and vertically ${deltaY} pixels`);    
    } catch (e) {
        const { message } = e as Error;
        logger.log('warn', `Error handling wheel event: ${message}`);
    }
};

/**
 * A wrapper function for handling the mousemove event.
 * @param socket The socket connection
 * @param coordinates - the coordinates of the mousemove event
 * @category HelperFunctions
 */
const onMousemove = async (coordinates: Coordinates, userId: string) => {
    logger.log('debug', 'Handling mousemove event emitted from client');
    await handleWrapper(handleMousemove, userId, coordinates);
}

/**
 * A mousemove event handler.
 * Reproduces the mousemove event on the remote browser instance
 * and generates data for the client's highlighter.
 * Mousemove is also not reflected in the workflow.
 * @param generator - the workflow generator {@link Generator}
 * @param page - the active page of the remote browser
 * @param x - the x coordinate of the mousemove event
 * @param y - the y coordinate of the mousemove event
 * @category BrowserManagement
 */
const handleMousemove = async (generator: WorkflowGenerator, page: Page, { x, y }: Coordinates) => {
    try {
        if (page.isClosed()) {
            logger.log('debug', `Ignoring mousemove event: page is closed`);
            return;
        }
        await page.mouse.move(x, y);
        throttle(async () => {
            if (!page.isClosed()) {
                await generator.generateDataForHighlighter(page, { x, y });
            }
        }, 100)();
        logger.log('debug', `Moved over position x:${x}, y:${y}`);
    } catch (e) {
        const { message } = e as Error;
        logger.log('error', message);
    }
}

/**
 * A wrapper function for handling the keydown event.
 * @param socket The socket connection
 * @param keyboardInput - the keyboard input of the keydown event
 * @category HelperFunctions
 */
const onKeydown = async (keyboardInput: KeyboardInput, userId: string) => {
    logger.log('debug', 'Handling keydown event emitted from client');
    await handleWrapper(handleKeydown, userId, keyboardInput);
}

/**
 * A keydown event handler.
 * Reproduces the keydown event on the remote browser instance
 * and generates the workflow pair data.
 * @param generator - the workflow generator {@link Generator}
 * @param page - the active page of the remote browser
 * @param key - the pressed key
 * @param coordinates - the coordinates, where the keydown event happened
 * @category BrowserManagement
 */
const handleKeydown = async (generator: WorkflowGenerator, page: Page, { key, coordinates }: KeyboardInput) => {
    await page.keyboard.down(key);
    await generator.onKeyboardInput(key, coordinates, page);
    logger.log('debug', `Key ${key} pressed`);
};

/**
 * Handles the date selection event.
 * @param generator - the workflow generator {@link Generator}
 * @param page - the active page of the remote browser
 * @param data - the data of the date selection event {@link DatePickerEventData}
 * @category BrowserManagement
 */
const handleDateSelection = async (generator: WorkflowGenerator, page: Page, data: DatePickerEventData) => {
    await generator.onDateSelection(page, data);
    logger.log('debug', `Date ${data.value} selected`);
}

/**
 * A wrapper function for handling the date selection event.
 * @param socket The socket connection
 * @param data - the data of the date selection event
 * @category HelperFunctions
 */
const onDateSelection = async (data: DatePickerEventData, userId: string) => {
    logger.log('debug', 'Handling date selection event emitted from client');
    await handleWrapper(handleDateSelection, userId, data);
}

/**
 * Handles the dropdown selection event.
 * @param generator - the workflow generator {@link Generator}
 * @param page - the active page of the remote browser
 * @param data - the data of the dropdown selection event
 * @category BrowserManagement
 */
const handleDropdownSelection = async (generator: WorkflowGenerator, page: Page, data: { selector: string, value: string }) => {
    await generator.onDropdownSelection(page, data);
    logger.log('debug', `Dropdown value ${data.value} selected`);
}

/**
 * A wrapper function for handling the dropdown selection event.
 * @param socket The socket connection
 * @param data - the data of the dropdown selection event
 * @category HelperFunctions
 */
const onDropdownSelection = async (data: { selector: string, value: string }, userId: string) => {
    logger.log('debug', 'Handling dropdown selection event emitted from client');
    await handleWrapper(handleDropdownSelection, userId, data);
}

/**
 * Handles the time selection event.
 * @param generator - the workflow generator {@link Generator}
 * @param page - the active page of the remote browser
 * @param data - the data of the time selection event
 * @category BrowserManagement
 */
const handleTimeSelection = async (generator: WorkflowGenerator, page: Page, data: { selector: string, value: string }) => {
    await generator.onTimeSelection(page, data);
    logger.log('debug', `Time value ${data.value} selected`);
}

/**
 * A wrapper function for handling the time selection event.
 * @param socket The socket connection
 * @param data - the data of the time selection event
 * @category HelperFunctions
 */
const onTimeSelection = async (data: { selector: string, value: string }, userId: string) => {
    logger.log('debug', 'Handling time selection event emitted from client');
    await handleWrapper(handleTimeSelection, userId, data);
}

/**
 * Handles the datetime-local selection event.
 * @param generator - the workflow generator {@link Generator}
 * @param page - the active page of the remote browser
 * @param data - the data of the datetime-local selection event
 * @category BrowserManagement
 */
const handleDateTimeLocalSelection = async (generator: WorkflowGenerator, page: Page, data: { selector: string, value: string }) => {
    await generator.onDateTimeLocalSelection(page, data);
    logger.log('debug', `DateTime Local value ${data.value} selected`);
}

/**
 * A wrapper function for handling the datetime-local selection event.
 * @param socket The socket connection
 * @param data - the data of the datetime-local selection event
 * @category HelperFunctions
 */
const onDateTimeLocalSelection = async (data: { selector: string, value: string }, userId: string) => {
    logger.log('debug', 'Handling datetime-local selection event emitted from client');
    await handleWrapper(handleDateTimeLocalSelection, userId, data);
}

/**
 * A wrapper function for handling the keyup event.
 * @param socket The socket connection
 * @param keyboardInput - the keyboard input of the keyup event
 * @category HelperFunctions
 */
const onKeyup = async (keyboardInput: KeyboardInput, userId: string) => {
    logger.log('debug', 'Handling keyup event emitted from client');
    await handleWrapper(handleKeyup, userId, keyboardInput);
}

/**
 * A keyup event handler.
 * Reproduces the keyup event on the remote browser instance.
 * Does not generate any data - keyup is not reflected in the workflow.
 * @param generator - the workflow generator {@link Generator}
 * @param page - the active page of the remote browser
 * @param key - the released key
 * @category BrowserManagement
 */
const handleKeyup = async (generator: WorkflowGenerator, page: Page, key: string) => {
    await page.keyboard.up(key);
    logger.log('debug', `Key ${key} unpressed`);
};

/**
 * A wrapper function for handling the url change event.
 * @param socket The socket connection
 * @param url - the new url of the page
 * @category HelperFunctions
 */
const onChangeUrl = async (url: string, userId: string) => {
    logger.log('debug', 'Handling change url event emitted from client');
    await handleWrapper(handleChangeUrl, userId, url);
}

/**
 * An url change event handler.
 * Navigates the page to the given url and generates data for the workflow.
 * @param generator - the workflow generator {@link Generator}
 * @param page - the active page of the remote browser
 * @param url - the new url of the page
 * @category BrowserManagement
 */
const handleChangeUrl = async (generator: WorkflowGenerator, page: Page, url: string) => {
    if (url) {
        await generator.onChangeUrl(url, page);
        try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });
            logger.log('debug', `Went to ${url}`);
        } catch (e) {
            const { message } = e as Error;
            logger.log('error', message);
        }
    } else {
        logger.log('warn', `No url provided`);
    }
};

/**
 * A wrapper function for handling the refresh event.
 * @param socket The socket connection
 * @category HelperFunctions
 */
const onRefresh = async (userId: string) => {
    logger.log('debug', 'Handling refresh event emitted from client');
    await handleWrapper(handleRefresh, userId, undefined);
}

/**
 * A refresh event handler.
 * Refreshes the page. This is not reflected in the workflow.
 * @param generator - the workflow generator {@link Generator}
 * @param page - the active page of the remote browser
 * @category BrowserManagement
 */
const handleRefresh = async (generator: WorkflowGenerator, page: Page) => {
    await page.reload();
    logger.log('debug', `Page refreshed.`);
};

/**
 * A wrapper function for handling the go back event.
 * @param socket The socket connection
 * @category HelperFunctions
 */
const onGoBack = async (userId: string) => {
    logger.log('debug', 'Handling go back event emitted from client');
    await handleWrapper(handleGoBack, userId, undefined);
}

/**
 * A go back event handler.
 * Navigates the page back and generates data for the workflow.
 * @param generator - the workflow generator {@link Generator}
 * @param page - the active page of the remote browser
 * @category BrowserManagement
 */
const handleGoBack = async (generator: WorkflowGenerator, page: Page) => {
    await page.goBack({ waitUntil: 'commit' });
    generator.onGoBack(page.url());
    logger.log('debug', 'Page went back')
};

/**
 * A wrapper function for handling the go forward event.
 * @param socket The socket connection
 * @category HelperFunctions
 */
const onGoForward = async (userId: string) => {
    logger.log('debug', 'Handling go forward event emitted from client');
    await handleWrapper(handleGoForward, userId, undefined);
}

/**
 * A go forward event handler.
 * Navigates the page forward and generates data for the workflow.
 * @param generator - the workflow generator {@link Generator}
 * @param page - the active page of the remote browser
 * @category BrowserManagement
 */
const handleGoForward = async (generator: WorkflowGenerator, page: Page) => {
    await page.goForward({ waitUntil: 'commit' });
    generator.onGoForward(page.url());
    logger.log('debug', 'Page went forward');
};

/**
 * Helper function for registering the handlers onto established websocket connection.
 * Registers various input handlers.
 *
 * All these handlers first generates the workflow pair data
 * and then calls the corresponding playwright's function to emulate the input.
 * They also ignore any user input while interpretation is in progress.
 *
 * @param socket websocket with established connection
 * @returns void
 * @category BrowserManagement
 */
const registerInputHandlers = (socket: Socket, userId: string) => {    
    // Register handlers with the socket
    socket.on("input:mousedown", (data) => onMousedown(data, userId));
    socket.on("input:wheel", (data) => onWheel(data, userId));
    socket.on("input:mousemove", (data) => onMousemove(data, userId));
    socket.on("input:keydown", (data) => onKeydown(data, userId));
    socket.on("input:keyup", (data) => onKeyup(data, userId));
    socket.on("input:url", (data) => onChangeUrl(data, userId));
    socket.on("input:refresh", () => onRefresh(userId));
    socket.on("input:back", () => onGoBack(userId));
    socket.on("input:forward", () => onGoForward(userId));
    socket.on("input:date", (data) => onDateSelection(data, userId));
    socket.on("input:dropdown", (data) => onDropdownSelection(data, userId));
    socket.on("input:time", (data) => onTimeSelection(data, userId));
    socket.on("input:datetime-local", (data) => onDateTimeLocalSelection(data, userId));
    socket.on("action", (data) => onGenerateAction(data, userId));
};

export default registerInputHandlers;
