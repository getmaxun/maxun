/**
 * A set of functions handling reproduction of user input
 * on the remote browser instance as well as the generation of workflow pairs.
 * These functions are called by the client through socket communication.
 */
import { Socket } from 'socket.io';
import logger from "../logger";
import { Coordinates, ScrollDeltas, KeyboardInput, DatePickerEventData } from '../types';
import { browserPool } from "../server";
import { Page } from "playwright-core";
import { CustomActions } from "../../../src/shared/types";
import { WhereWhatPair } from "maxun-core";
import { RemoteBrowser } from './classes/RemoteBrowser';

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
        activeBrowser: RemoteBrowser,
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
                await handleCallback(activeBrowser, currentPage, args);
            } else {
                await handleCallback(activeBrowser, currentPage);
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
    actionId?: string;
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
 * @param actionId Optional action ID for tracking and updating specific actions
 * @category BrowserManagement
 */
const handleGenerateAction =
  async (activeBrowser: RemoteBrowser, page: Page, { action, settings, actionId }: CustomActionEventData) => {
    try {
      if (page.isClosed()) {
        logger.log("debug", `Ignoring generate action event: page is closed`);
        return;
      }

      const generator = activeBrowser.generator;
      await generator.customAction(action, actionId || '', settings, page);
    } catch (e) {
      const { message } = e as Error;
      logger.log("warn", `Error handling generate action event: ${message}`);
    }
  }

/**
 * Handles the date selection event.
 * @param activeBrowser - the active remote browser {@link RemoteBrowser}
 * @param page - the active page of the remote browser
 * @param data - the data of the date selection event {@link DatePickerEventData}
 * @category BrowserManagement
 */
const handleDateSelection = async (activeBrowser: RemoteBrowser, page: Page, data: DatePickerEventData) => {
    try {
        if (page.isClosed()) {
            logger.log("debug", `Ignoring date selection event: page is closed`);
            return;
        }

        const generator = activeBrowser.generator;
        await generator.onDateSelection(page, data);
        logger.log("debug", `Date ${data.value} selected`);
    } catch (e) {
        const { message } = e as Error;
        logger.log("warn", `Error handling date selection event: ${message}`);
    }
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
 * @param activeBrowser - the active remote browser {@link RemoteBrowser}
 * @param page - the active page of the remote browser
 * @param data - the data of the dropdown selection event
 * @category BrowserManagement
 */
const handleDropdownSelection = async (activeBrowser: RemoteBrowser, page: Page, data: { selector: string, value: string }) => {
    try {
        if (page.isClosed()) {
            logger.log("debug", `Ignoring dropdown selection event: page is closed`);
            return;
        }

        const generator = activeBrowser.generator;
        await generator.onDropdownSelection(page, data);
        logger.log("debug", `Dropdown value ${data.value} selected`);
    } catch (e) {
        const { message } = e as Error;
        logger.log("warn", `Error handling dropdown selection event: ${message}`);
    }
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
 * @param activeBrowser - the active remote browser {@link RemoteBrowser}
 * @param page - the active page of the remote browser
 * @param data - the data of the time selection event
 * @category BrowserManagement
 */
const handleTimeSelection = async (activeBrowser: RemoteBrowser, page: Page, data: { selector: string, value: string }) => {
    try {
        if (page.isClosed()) {
            logger.log("debug", `Ignoring time selection event: page is closed`);
            return;
        }

        const generator = activeBrowser.generator;
        await generator.onTimeSelection(page, data);
        logger.log("debug", `Time value ${data.value} selected`);
    } catch (e) {
        const { message } = e as Error;
        logger.log("warn", `Error handling time selection event: ${message}`);
    }
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
 * @param activeBrowser - the active remote browser {@link RemoteBrowser}
 * @param page - the active page of the remote browser
 * @param data - the data of the datetime-local selection event
 * @category BrowserManagement
 */
const handleDateTimeLocalSelection = async (activeBrowser: RemoteBrowser, page: Page, data: { selector: string, value: string }) => {
    try {
        if (page.isClosed()) {
            logger.log(
                "debug",
                `Ignoring datetime-local selection event: page is closed`
            );
            return;
        }

        const generator = activeBrowser.generator;
        await generator.onDateTimeLocalSelection(page, data);
        logger.log("debug", `DateTime Local value ${data.value} selected`);
    } catch (e) {
        const { message } = e as Error;
        logger.log(
        "warn",
        `Error handling datetime-local selection event: ${message}`
        );
    }
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
 * @param activeBrowser - the active remote browser {@link RemoteBrowser}
 * @param page - the active page of the remote browser
 * @param key - the released key
 * @category BrowserManagement
 */
const handleKeyup = async (activeBrowser: RemoteBrowser, page: Page, key: string) => {
    try {
        if (page.isClosed()) {
            logger.log("debug", `Ignoring keyup event: page is closed`);
            return;
        }

        await page.keyboard.up(key);
        logger.log("debug", `Key ${key} unpressed`);
    } catch (e) {
        const { message } = e as Error;
        logger.log("warn", `Error handling keyup event: ${message}`);
    }
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
 * @param activeBrowser - the active remote browser {@link RemoteBrowser}
 * @param page - the active page of the remote browser
 * @param url - the new url of the page
 * @category BrowserManagement
 */
const handleChangeUrl = async (activeBrowser: RemoteBrowser, page: Page, url: string) => {
    try {
        if (page.isClosed()) {
            logger.log("debug", `Ignoring change url event: page is closed`);
            return;
        }

        if (url) {
            const generator = activeBrowser.generator;
            await generator.onChangeUrl(url, page);

            try {
                await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
                await page.waitForTimeout(500); 
                logger.log("debug", `Went to ${url}`);
            } catch (e) {
                const { message } = e as Error;
                logger.log("error", message);
            }
        } else {
            logger.log("warn", `No url provided`);
        }
    } catch (e) {
        const { message } = e as Error;
        logger.log("warn", `Error handling change url event: ${message}`);
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
 * @param activeBrowser - the active remote browser {@link RemoteBrowser}
 * @param page - the active page of the remote browser
 * @category BrowserManagement
 */
const handleRefresh = async (activeBrowser: RemoteBrowser, page: Page) => {
    try {
        if (page.isClosed()) {
            logger.log("debug", `Ignoring refresh event: page is closed`);
            return;
        }

        await page.reload();
        logger.log("debug", `Page refreshed.`);
    } catch (e) {
        const { message } = e as Error;
        logger.log("warn", `Error handling refresh event: ${message}`);
    }
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
 * @param activeBrowser - the active remote browser {@link RemoteBrowser}
 * @param page - the active page of the remote browser
 * @category BrowserManagement
 */
const handleGoBack = async (activeBrowser: RemoteBrowser, page: Page) => {
    try {
        if (page.isClosed()) {
            logger.log("debug", `Ignoring go back event: page is closed`);
            return;
        }

        const generator = activeBrowser.generator;
        await page.goBack({ waitUntil: "commit" });
        generator.onGoBack(page.url());
        logger.log("debug", "Page went back");
    } catch (e) {
        const { message } = e as Error;
        logger.log("warn", `Error handling go back event: ${message}`);
    }
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
 * @param activeBrowser - the active remote browser {@link RemoteBrowser}
 * @param page - the active page of the remote browser
 * @category BrowserManagement
 */
const handleGoForward = async (activeBrowser: RemoteBrowser, page: Page) => {
    try {
        if (page.isClosed()) {
            logger.log("debug", `Ignoring go forward event: page is closed`);
            return;
        }

        const generator = activeBrowser.generator;
        await page.goForward({ waitUntil: "commit" });
        generator.onGoForward(page.url());
        logger.log("debug", "Page went forward");
    } catch (e) {
        const { message } = e as Error;
        logger.log("warn", `Error handling go forward event: ${message}`);
    }
};

/**
 * Handles the click action event.
 * @param activeBrowser - the active remote browser {@link RemoteBrowser}
 * @param page - the active page of the remote browser
 * @param data - the data of the click action event
 * @category BrowserManagement
 */
const handleClickAction = async (
  activeBrowser: RemoteBrowser,
  page: Page,
  data: {
    selector: string;
    url: string;
    userId: string;
    elementInfo?: any;
    coordinates?: { x: number; y: number };
    isSPA?: boolean;
  }
) => {
  try {
    if (page.isClosed()) {
      logger.log("debug", `Ignoring click action event: page is closed`);
      return;
    }

    const { selector, url, elementInfo, coordinates, isSPA = false } = data;
    const currentUrl = page.url();

    if (elementInfo && coordinates && (elementInfo.tagName === 'INPUT' || elementInfo.tagName === 'TEXTAREA')) {
      try {
        const elementHandle = await page.$(selector);
        if (elementHandle) {
          const boundingBox = await elementHandle.boundingBox();
          if (boundingBox) {
            await page.mouse.click(
              boundingBox.x + coordinates.x, 
              boundingBox.y + coordinates.y
            );
          } else {
            await page.click(selector);
          }
        } else {
          await page.click(selector);
        }
      } catch (error: any) {
        logger.log("warn", `Failed to click at coordinates: ${error.message}`);
        await page.click(selector);
      }
    } else {
      await page.click(selector);
    }

    const generator = activeBrowser.generator;
    await generator.onDOMClickAction(page, data);

    logger.log("debug", `Click action processed: ${selector}`);

    if (elementInfo && (elementInfo.tagName === 'INPUT' || elementInfo.tagName === 'TEXTAREA')) {
      logger.log("debug", `Input field click - skipping DOM snapshot for smooth typing`);
      return;
    }

    if (isSPA) {
      logger.log("debug", `SPA interaction detected for selector: ${selector}`);

      await new Promise((resolve) => setTimeout(resolve, 1500));
    } else {
      const newUrl = page.url();
      const hasNavigated = newUrl !== currentUrl && !newUrl.endsWith("/#");

      if (hasNavigated) {
        logger.log("debug", `Navigation detected: ${currentUrl} -> ${newUrl}`);

        await generator.onDOMNavigation(page, {
          url: newUrl,
          currentUrl: currentUrl,
          userId: data.userId,
        });
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  } catch (e) {
    const { message } = e as Error;
    logger.log(
      "warn",
      `Error handling enhanced click action event: ${message}`
    );
  }
};

/**
 * A wrapper function for handling the click action event.
 * @param socket The socket connection
 * @param data - the data of the click action event
 * @category HelperFunctions
 */
const onDOMClickAction = async (
  data: {
    selector: string;
    url: string;
    userId: string;
    elementInfo?: any;
    coordinates?: { x: number; y: number };
  },
  userId: string
) => {
  logger.log("debug", "Handling click action event emitted from client");
  await handleWrapper(handleClickAction, userId, data);
};

/**
 * Handles the keyboard action event.
 * @param activeBrowser - the active remote browser {@link RemoteBrowser}
 * @param page - the active page of the remote browser
 * @param data - the data of the keyboard action event
 * @category BrowserManagement
 */
const handleKeyboardAction = async (
  activeBrowser: RemoteBrowser,
  page: Page,
  data: {
    selector: string;
    key: string;
    url: string;
    userId: string;
    inputType?: string;
  }
) => {
  try {
    if (page.isClosed()) {
      logger.log("debug", `Ignoring keyboard action event: page is closed`);
      return;
    }

    const generator = activeBrowser.generator;

    await page.press(data.selector, data.key);    
    await generator.onDOMKeyboardAction(page, data);
    logger.log(
      "debug",
      `Keyboard action processed: ${data.key} on ${data.selector}`
    );
  } catch (e) {
    const { message } = e as Error;
    logger.log("warn", `Error handling keyboard action event: ${message}`);
  }
};

/**
 * A wrapper function for handling the keyboard action event.
 * @param socket The socket connection
 * @param data - the data of the keyboard action event
 * @category HelperFunctions
 */
const onDOMKeyboardAction = async (
  data: {
    selector: string;
    key: string;
    url: string;
    userId: string;
    inputType?: string;
  },
  userId: string
) => {
  logger.log("debug", "Handling keyboard action event emitted from client");
  await handleWrapper(handleKeyboardAction, userId, data);
};

/**
 * Handles the remove action event.
 * This is called when a user discards a capture action (list or text) that was already emitted to the backend.
 * @param activeBrowser - the active remote browser instance
 * @param page - the active page of the remote browser
 * @param data - the data containing the actionId to remove
 * @category BrowserManagement
 */
const handleRemoveAction = async (
  activeBrowser: RemoteBrowser,
  page: Page,
  data: { actionId: string }
) => {
  try {
    const { actionId } = data;
    const generator = activeBrowser.generator;
    const removed = generator.removeAction(actionId);

    if (removed) {
      logger.log("info", `Action ${actionId} successfully removed from workflow`);
    } else {
      logger.log("debug", `Action ${actionId} not found in workflow`);
    }
  } catch (e) {
    const { message } = e as Error;
    logger.log("warn", `Error handling remove action event: ${message}`);
  }
};

/**
 * A wrapper function for handling the remove action event.
 * @param data - the data containing the actionId to remove
 * @param userId - the user ID
 * @category HelperFunctions
 */
const onRemoveAction = async (
    data: { actionId: string },
    userId: string
) => {
    logger.log("debug", "Handling remove action event emitted from client");
    await handleWrapper(handleRemoveAction, userId, data);
};

/**
 * Tests pagination by scrolling down and checking if new content loads
 * @param data Object containing listSelector
 * @param userId The user ID
 * @param socket The socket connection to emit results
 */
const onTestPaginationScroll = async (
  data: { listSelector: string },
  userId: string,
  socket: Socket
) => {
  logger.log("debug", "Testing pagination scroll emitted from client");

  const id = browserPool.getActiveBrowserId(userId, "recording");
  if (!id) {
    logger.log("warn", `No active browser for id ${id}`);
    socket.emit("paginationScrollTestResult", {
      success: false,
      error: "No active browser"
    });
    return;
  }

  const activeBrowser = browserPool.getRemoteBrowser(id);
  const currentPage = activeBrowser?.getCurrentPage();

  if (!currentPage || !activeBrowser) {
    logger.log("warn", `No active page for browser ${id}`);
    socket.emit("paginationScrollTestResult", {
      success: false,
      error: "No active page"
    });
    return;
  }

  try {
    const { listSelector } = data;

    logger.log("info", `Starting pagination scroll test for selector: ${listSelector}`);

    const initialCount = await currentPage.evaluate((selector) => {
      function evaluateSelector(sel: string): Element[] {
        try {
          const isXPath = sel.startsWith('//') || sel.startsWith('(//');
          if (isXPath) {
            const result = document.evaluate(
              sel,
              document,
              null,
              XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
              null
            );
            const elements: Element[] = [];
            for (let i = 0; i < result.snapshotLength; i++) {
              const node = result.snapshotItem(i);
              if (node && node.nodeType === Node.ELEMENT_NODE) {
                elements.push(node as Element);
              }
            }
            return elements;
          } else {
            return Array.from(document.querySelectorAll(sel));
          }
        } catch (err) {
          console.error('Selector evaluation failed:', sel, err);
          return [];
        }
      }

      return evaluateSelector(selector).length;
    }, listSelector);

    logger.log("info", `Initial list count: ${initialCount}`);

    const scrollInfo = await currentPage.evaluate(() => {
      return {
        scrollY: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight
      };
    });

    logger.log("info", `Scroll info:`, scrollInfo);

    await currentPage.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    logger.log("info", "Scrolled to bottom, waiting for potential content load...");

    await currentPage.waitForTimeout(2000);

    const newCount = await currentPage.evaluate((selector) => {
      function evaluateSelector(sel: string): Element[] {
        try {
          const isXPath = sel.startsWith('//') || sel.startsWith('(//');
          if (isXPath) {
            const result = document.evaluate(
              sel,
              document,
              null,
              XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
              null
            );
            const elements: Element[] = [];
            for (let i = 0; i < result.snapshotLength; i++) {
              const node = result.snapshotItem(i);
              if (node && node.nodeType === Node.ELEMENT_NODE) {
                elements.push(node as Element);
              }
            }
            return elements;
          } else {
            return Array.from(document.querySelectorAll(sel));
          }
        } catch (err) {
          return [];
        }
      }

      return evaluateSelector(selector).length;
    }, listSelector);

    logger.log("info", `New list count after scroll: ${newCount}`);

    await currentPage.evaluate((originalY) => {
      window.scrollTo(0, originalY);
    }, scrollInfo.scrollY);

    const contentLoaded = newCount > initialCount;

    logger.log("info", `Scroll test result: ${contentLoaded ? 'Content loaded' : 'No new content'}`);

    socket.emit("paginationScrollTestResult", {
      success: true,
      contentLoaded: contentLoaded,
      initialCount: initialCount,
      newCount: newCount,
      itemsAdded: newCount - initialCount
    });

  } catch (error) {
    const { message } = error as Error;
    logger.log("error", `Error during pagination scroll test: ${message}`);
    socket.emit("paginationScrollTestResult", {
      success: false,
      error: message
    });
  }
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
    socket.on("removeAction", (data) => onRemoveAction(data, userId));

    socket.on("dom:click", (data) => onDOMClickAction(data, userId));
    socket.on("dom:keypress", (data) => onDOMKeyboardAction(data, userId));
    socket.on("testPaginationScroll", (data) => onTestPaginationScroll(data, userId, socket));
};

/**
 *  Removes all input handler socket listeners to prevent memory leaks
 * Must be called when socket disconnects or browser session ends
 * @param socket websocket with established connection
 * @returns void
 * @category BrowserManagement
 */
const removeInputHandlers = (socket: Socket) => {
  try {
    socket.removeAllListeners("input:keyup");
    socket.removeAllListeners("input:url");
    socket.removeAllListeners("input:refresh");
    socket.removeAllListeners("input:back");
    socket.removeAllListeners("input:forward");
    socket.removeAllListeners("input:date");
    socket.removeAllListeners("input:dropdown");
    socket.removeAllListeners("input:time");
    socket.removeAllListeners("input:datetime-local");
    socket.removeAllListeners("action");
    socket.removeAllListeners("dom:input");
    socket.removeAllListeners("dom:click");
    socket.removeAllListeners("dom:keypress");
    socket.removeAllListeners("removeAction");
    socket.removeAllListeners("testPaginationScroll");
  } catch (error: any) {
    console.warn(`Error removing input handlers: ${error.message}`);
  }
};

export { registerInputHandlers, removeInputHandlers };
