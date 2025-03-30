/**
 * The main function group which determines the flow of remote browser management.
 * Holds the singleton instances of browser pool and socket.io server.
 */
import { Socket } from "socket.io";
import { uuid } from 'uuidv4';

import { createSocketConnection, createSocketConnectionForRun, registerBrowserUserContext } from "../socket-connection/connection";
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
  const id = getActiveBrowserIdByState(userId, "recording") || uuid();
  createSocketConnection(
    io.of(id),
    async (socket: Socket) => {
      // browser is already active
      const activeId = getActiveBrowserIdByState(userId, "recording");
      if (activeId) {
        const remoteBrowser = browserPool.getRemoteBrowser(activeId);
        remoteBrowser?.updateSocket(socket);
        await remoteBrowser?.makeAndEmitScreenshot();
      } else {
        const browserSession = new RemoteBrowser(socket, userId);
        browserSession.interpreter.subscribeToPausing();
        await browserSession.initialize(userId);
        await browserSession.registerEditorEvents();
        await browserSession.subscribeToScreencast();
        browserPool.addRemoteBrowser(id, browserSession, userId, false, "recording");
      }
      socket.emit('loaded');
    });
  return id;
};

/**
 * Starts and initializes a {@link RemoteBrowser} instance for interpretation.
 * Creates a new {@link Socket} connection over a dedicated namespace.
 * Returns the new remote browser's generated id.
 * @param userId User ID for browser ownership
 * @returns string Browser ID
 * @category BrowserManagement-Controller
 */
export const createRemoteBrowserForRun = (userId: string): string => {
  const id = uuid();
  
  registerBrowserUserContext(id, userId);
  logger.log('debug', `Created new browser for run: ${id} for user: ${userId}`);
  
  createSocketConnectionForRun(
    io.of(`/${id}`), 
    async (socket: Socket) => {
      try {
        const browserSession = new RemoteBrowser(socket, userId);
        await browserSession.initialize(userId);
        browserPool.addRemoteBrowser(id, browserSession, userId, false, "run");
        socket.emit('ready-for-run');
      } catch (error: any) {
        logger.error(`Error initializing browser: ${error.message}`);
      }
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
export const destroyRemoteBrowser = async (id: string, userId: string): Promise<boolean> => {
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
export const getActiveBrowserId = (userId: string): string | null => {
  return browserPool.getActiveBrowserId(userId);
};

/**
 * Returns the id of an active browser with the specified state or null.
 * @param userId the user ID to find the browser for
 * @param state the browser state to filter by ("recording" or "run")
 * @returns {string | null}
 * @category  BrowserManagement-Controller
 */
export const getActiveBrowserIdByState = (userId: string, state: "recording" | "run"): string | null => {
  return browserPool.getActiveBrowserId(userId, state);
};

/**
 * Returns the url string from a remote browser if exists in the browser pool.
 * @param id instance id of the remote browser
 * @returns {string | undefined}
 * @category  BrowserManagement-Controller
 */
export const getRemoteBrowserCurrentUrl = (id: string, userId: string): string | undefined => {
  return browserPool.getRemoteBrowser(id)?.getCurrentPage()?.url();
};

/**
 * Returns the array of tab strings from a remote browser if exists in the browser pool.
 * @param id instance id of the remote browser
 * @return {string[] | undefined}
 * @category  BrowserManagement-Controller
 */
export const getRemoteBrowserCurrentTabs = (id: string, userId: string): string[] | undefined => {
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
export const interpretWholeWorkflow = async (userId: string) => {
  const id = getActiveBrowserIdByState(userId, "recording");
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
export const stopRunningInterpretation = async (userId: string) => {
  const id = getActiveBrowserIdByState(userId, "recording");
  if (id) {
    const browser = browserPool.getRemoteBrowser(id);
    await browser?.stopCurrentInterpretation();
  } else {
    logger.log('error', 'Cannot stop interpretation: No active browser or generator.');
  }
};
