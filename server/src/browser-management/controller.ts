/**
 * The main function group which determines the flow of remote browser management.
 * Holds the singleton instances of browser pool and socket.io server.
 */
import { Socket } from "socket.io";
import { uuid } from 'uuidv4';

import { createSocketConnection, createSocketConnectionForRun } from "../socket-connection/connection";
import { io, browserPool } from "../server";
import { RemoteBrowser } from "./classes/RemoteBrowser";
import { RemoteBrowserOptions } from "../types";
import logger from "../logger";

/**
 * Starts and initializes a {@link RemoteBrowser} instance.
 * Creates a new socket connection over a dedicated namespace
 * and registers all interaction event handlers.
 * Returns the id of an active browser or the new remote browser's generated id.
 * @param options {@link RemoteBrowserOptions} to be used when launching the browser
 * @returns string
 * @category BrowserManagement-Controller
 */
export const initializeRemoteBrowserForRecording = (userId: string): string => {
  const id = getActiveBrowserId() || uuid();
  createSocketConnection(
    io.of(id),
    async (socket: Socket) => {
      // browser is already active
      const activeId = getActiveBrowserId();
      if (activeId) {
        const remoteBrowser = browserPool.getRemoteBrowser(activeId);
        remoteBrowser?.updateSocket(socket);
        await remoteBrowser?.makeAndEmitScreenshot();
      } else {
        const browserSession = new RemoteBrowser(socket);
        browserSession.interpreter.subscribeToPausing();
        await browserSession.initialize(userId);
        await browserSession.registerEditorEvents();
        await browserSession.subscribeToScreencast();
        browserPool.addRemoteBrowser(id, browserSession, true);
      }
      socket.emit('loaded');
    });
  return id;
};

/**
 * Starts and initializes a {@link RemoteBrowser} instance for interpretation.
 * Creates a new {@link Socket} connection over a dedicated namespace.
 * Returns the new remote browser's generated id.
 * @param options {@link RemoteBrowserOptions} to be used when launching the browser
 * @returns string
 * @category BrowserManagement-Controller
 */
export const createRemoteBrowserForRun = (userId: string): string => {
  const id = uuid();
  createSocketConnectionForRun(
    io.of(id),
    async (socket: Socket) => {
      const browserSession = new RemoteBrowser(socket);
      await browserSession.initialize(userId);
      browserPool.addRemoteBrowser(id, browserSession, true);
      socket.emit('ready-for-run');
    });
  return id;
};

/**
 * Terminates a remote browser recording session
 * and removes the browser from the browser pool.
 * @param id instance id of the remote browser to be terminated
 * @returns {Promise<boolean>}
 * @category BrowserManagement-Controller
 */
export const destroyRemoteBrowser = async (id: string): Promise<boolean> => {
  const browserSession = browserPool.getRemoteBrowser(id);
  if (browserSession) {
    logger.log('debug', `Switching off the browser with id: ${id}`);
    await browserSession.stopCurrentInterpretation();
    await browserSession.switchOff();
  }
  return browserPool.deleteRemoteBrowser(id);
};

/**
 * Returns the id of an active browser or null.
 * Wrapper around {@link browserPool.getActiveBrowserId()} function.
 * @returns {string | null}
 * @category  BrowserManagement-Controller
 */
export const getActiveBrowserId = (): string | null => {
  return browserPool.getActiveBrowserId();
};

/**
 * Returns the url string from a remote browser if exists in the browser pool.
 * @param id instance id of the remote browser
 * @returns {string | undefined}
 * @category  BrowserManagement-Controller
 */
export const getRemoteBrowserCurrentUrl = (id: string): string | undefined => {
  return browserPool.getRemoteBrowser(id)?.getCurrentPage()?.url();
};

/**
 * Returns the array of tab strings from a remote browser if exists in the browser pool.
 * @param id instance id of the remote browser
 * @return {string[] | undefined}
 * @category  BrowserManagement-Controller
 */
export const getRemoteBrowserCurrentTabs = (id: string): string[] | undefined => {
  return browserPool.getRemoteBrowser(id)?.getCurrentPage()?.context().pages()
    .map((page) => {
      const parsedUrl = new URL(page.url());
      const host = parsedUrl.hostname.match(/\b(?!www\.)[a-zA-Z0-9]+/g)?.join('.');
      if (host) {
        return host;
      }
      return 'new tab';
    });
};

/**
 * Interprets the currently generated workflow in the active browser instance.
 * If there is no active browser, the function logs an error.
 * @returns {Promise<void>}
 * @category  BrowserManagement-Controller
 */
export const interpretWholeWorkflow = async () => {
  const id = getActiveBrowserId();
  if (id) {
    const browser = browserPool.getRemoteBrowser(id);
    if (browser) {
      await browser.interpretCurrentRecording();
    } else {
      logger.log('error', `No active browser with id ${id} found in the browser pool`);
    }
  } else {
    logger.log('error', `Cannot interpret the workflow: bad id ${id}.`);
  }
};

/**
 * Stops the interpretation of the current workflow in the active browser instance.
 * If there is no active browser, the function logs an error.
 * @returns {Promise<void>}
 * @category  BrowserManagement-Controller
 */
export const stopRunningInterpretation = async () => {
  const id = getActiveBrowserId();
  if (id) {
    const browser = browserPool.getRemoteBrowser(id);
    await browser?.stopCurrentInterpretation();
  } else {
    logger.log('error', 'Cannot stop interpretation: No active browser or generator.');
  }
};
