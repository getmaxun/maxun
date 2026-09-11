/**
 * The main function group which determines the flow of remote browser management.
 * Holds the singleton instances of browser pool and socket.io server.
 */
import { Socket } from "socket.io";
import { v4 as uuid } from "uuid";
import { Page } from "playwright-core";
import { createSocketConnection, createSocketConnectionForRun } from "../socket-connection/connection";
import { socketOwns } from "../socket-connection/socketAuth";
import { io, browserPool } from "../server";
import { RemoteBrowser } from "./classes/RemoteBrowser";
import { RemoteBrowserOptions } from "../types";
import { ControlLeaseError, heartbeatControl, releaseControl, type ControlActor } from '../sdk/controlLease';
import {
  cancelBrowserControlCommands,
  executeBrowserControlCommand,
  normalizeControlCommand,
} from '../sdk/browserControl';
import logger from "../logger";
import { sanitizeBrowserUrl } from '../sdk/urlPrivacy';

const RECORDING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const recordingTimeouts = new Map<string, NodeJS.Timeout>();

/**
 * Starts and initializes a {@link RemoteBrowser} instance.
 * Creates a new socket connection over a dedicated namespace
 * and registers all interaction event handlers.
 * Returns the id of an active browser or the new remote browser's generated id.
 * @param options {@link RemoteBrowserOptions} to be used when launching the browser
 * @returns string
 * @category BrowserManagement-Controller
 */
export const initializeRemoteBrowserForRecording = (userId: string, mode: string = "dom"): string => {
  const id = getActiveBrowserIdByState(userId, "recording") || uuid();
  createSocketConnection(
    io.of(id),
    userId,
    async (socket: Socket) => {
      // browser is already active
      const activeId = getActiveBrowserIdByState(userId, "recording");
      if (activeId) {
        const remoteBrowser = browserPool.getRemoteBrowser(activeId);
        remoteBrowser?.updateSocket(socket);
      } else {
        const browserSession = new RemoteBrowser(socket, userId, id, true);
        browserSession.interpreter.subscribeToPausing();
        
        try {
          await browserSession.initialize(userId);
          await browserSession.registerEditorEvents();

          logger.info('DOM streaming started for remote browser in recording mode');

          const added = browserPool.addRemoteBrowser(id, browserSession, userId, false, "recording");
          if (!added) {
            logger.error(`Failed to add recording browser ${id} to pool; cleaning up session`);
            socket.emit('dom-mode-error', {
              userId,
              error: 'Failed to start the browser, please try again in some time.'
            });
            await browserSession.switchOff();
            return id;
          }

          const timeoutHandle = setTimeout(async () => {
            recordingTimeouts.delete(id);
            logger.warn(`Recording session ${id} timed out, auto-discarding`);
            try {
              io.of(id).emit('recording-timeout');
            } catch (e) {
              logger.warn(`Failed to emit recording-timeout event for session ${id}: ${e}`);
            }
            // Wait for the frontend to receive the event, post BroadcastChannel message,
            // and close the recording tab before we tear down the socket connection.
            await new Promise(resolve => setTimeout(resolve, 1000));
            await destroyRemoteBrowser(id, userId);
          }, RECORDING_TIMEOUT_MS);
          recordingTimeouts.set(id, timeoutHandle);
        } catch (initError: any) {
          logger.error(`Failed to initialize browser for recording: ${initError.message}`);
          logger.info('Sending browser failure notification to frontend');

          socket.emit('dom-mode-error', {
            userId: userId,
            error: 'Failed to start the browser, please try again in some time.'
          });

          socket.emit('error', {
            userId: userId,
            message: 'Failed to start the browser, please try again in some time.',
            details: initError.message
          });

          await new Promise(resolve => setTimeout(resolve, 100));

          try {
            await browserSession.switchOff();
            logger.debug('Cleaned up failed browser session');
          } catch (cleanupError: any) {
            logger.warn(`Failed to cleanup browser session: ${cleanupError.message}`);
          }

          logger.info('Browser initialization failed, user notified');

          return id;
        }
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
export const createRemoteBrowserForRun = (userId: string, enableLiveStream: boolean = false): string => {
  if (!userId) {
    logger.log('error', 'createRemoteBrowserForRun: Missing required parameter userId');
    throw new Error('userId is required');
  }
  
  const id = uuid();

  const slotReserved = browserPool.reserveBrowserSlotAtomic(id, userId, "run");
  if (!slotReserved) {
    logger.log('warn', `Cannot create browser for user ${userId}: no available slots`);
    throw new Error('User has reached maximum browser limit');
  }

  logger.log('info', `createRemoteBrowserForRun: Reserved slot ${id} for user ${userId}`);

  initializeBrowserAsync(id, userId, enableLiveStream)
    .catch((error: any) => {
      logger.log('error', `Unhandled error in initializeBrowserAsync for browser ${id}: ${error.message}`);
      browserPool.failBrowserSlot(id);
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
export const clearRecordingTimeout = (id: string): void => {
  const existingTimeout = recordingTimeouts.get(id);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    recordingTimeouts.delete(id);
    logger.log('debug', `Recording timeout cancelled for session ${id}`);
  }
};

export const destroyRemoteBrowser = async (id: string, userId: string): Promise<boolean> => {
  const owner = browserPool.getUserForBrowser(id);
  if (owner && String(owner) !== String(userId)) {
    logger.log('warn', `Refusing to destroy browser ${id} for non-owner user ${userId}`);
    return false;
  }
  clearRecordingTimeout(id);

  const DESTROY_TIMEOUT = 30000;

  const destroyPromise = (async () => {
    try {
      const browserSession = browserPool.getRemoteBrowser(id);
      if (!browserSession) {
        // Reserved and failed slots intentionally have no RemoteBrowser object;
        // release them from the pool as well so an explicit owner release cannot
        // leave an orphaned reconnect target until the stale-slot sweeper runs.
        const deleted = browserPool.deleteRemoteBrowser(id);
        logger.log('info', deleted
          ? `Removed browser slot ${id} without an initialized session`
          : `Browser with id: ${id} not found, may have already been destroyed`);
        return true;
      }

      logger.log('debug', `Switching off the browser with id: ${id}`);

      try {
        await browserSession.switchOff();
      } catch (switchOffError) {
        logger.log('warn', `Error switching off browser ${id}: ${switchOffError}`);
      }

      try {
        const namespace = io.of(id);

        const sockets = await namespace.fetchSockets();
        for (const socket of sockets) {
          socket.disconnect(true);
        }

        namespace.removeAllListeners();

        await new Promise(resolve => setTimeout(resolve, 100));

        const nsps = (io as any)._nsps;
        if (nsps && nsps.has(`/${id}`)) {
          const ns = nsps.get(`/${id}`);
          if (ns && ns.sockets && ns.sockets.size === 0) {
            nsps.delete(`/${id}`);
            logger.log('debug', `Deleted empty namespace /${id} from io._nsps Map`);
          } else {
            logger.log('warn', `Namespace /${id} still has ${ns?.sockets?.size || 0} sockets, skipping manual deletion`);
          }
        }

        logger.log('debug', `Cleaned up socket namespace for browser ${id}`);
      } catch (namespaceCleanupError: any) {
        logger.log('warn', `Error cleaning up socket namespace for browser ${id}: ${namespaceCleanupError.message}`);
      }

      return browserPool.deleteRemoteBrowser(id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.log('error', `Failed to destroy browser ${id}: ${errorMessage}`);

      try {
        return browserPool.deleteRemoteBrowser(id);
      } catch (deleteError) {
        logger.log('error', `Failed to delete browser ${id} from pool: ${deleteError}`);
        return false;
      }
    }
  })();

  try {
    const timeoutPromise = new Promise<boolean>((_, reject) =>
      setTimeout(() => reject(new Error(`Browser destruction timed out after ${DESTROY_TIMEOUT}ms`)), DESTROY_TIMEOUT)
    );

    return await Promise.race([destroyPromise, timeoutPromise]);
  } catch (timeoutError: any) {
    logger.log('error', `Browser ${id} destruction timeout: ${timeoutError.message} - force removing from pool`);
    try {
      return browserPool.deleteRemoteBrowser(id);
    } catch (deleteError) {
      logger.log('error', `Failed to force delete browser ${id} after timeout: ${deleteError}`);
      return false;
    }
  }
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
 * Checks if there are available browser slots for a user.
 * Wrapper around {@link browserPool.hasAvailableBrowserSlots()} function.
 * If state is provided, also checks that none of their active browsers are in that state.
 * @param userId the user ID to check browser slots for
 * @param state optional state to check - if provided, ensures no browser is in this state
 * @returns {boolean} true if user has available slots (and no browsers in specified state if state is provided)
 * @category BrowserManagement-Controller
 */
export const canCreateBrowserInState = (userId: string, state?: "recording" | "run"): boolean => {
  return browserPool.hasAvailableBrowserSlots(userId, state);
};

/**
 * Returns the url string from a remote browser if exists in the browser pool.
 * @param id instance id of the remote browser
 * @returns {string | undefined}
 * @category  BrowserManagement-Controller
 */
export const getRemoteBrowserCurrentUrl = (id: string, userId: string): string | undefined => {
  return sanitizeBrowserUrl(browserPool.getRemoteBrowser(id)?.getCurrentPage()?.url()) ?? undefined;
};

/** Return the process-local browser slot status for an authenticated owner. */
export const getRemoteBrowserStatus = (id: string): 'reserved' | 'initializing' | 'ready' | 'failed' | null => (
  browserPool.getBrowserStatus(id)
);

/** Return the process-local owner of a browser slot, or null when it is gone. */
export const getRemoteBrowserOwner = (id: string): string | null => browserPool.getUserForBrowser(id);

/** Return a remote browser only to its authenticated owner. */
export const getRemoteBrowser = (id: string, userId: string): RemoteBrowser | undefined => {
  if (getRemoteBrowserOwner(id) !== String(userId)) return undefined;
  return browserPool.getRemoteBrowser(id);
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
    const browserSession = browserPool.getRemoteBrowser(id);
    await browserSession?.switchOff();
  } else {
    logger.log('error', 'Cannot stop interpretation: No active browser or generator.');
  }
};

const attachControlSocket = (browserSession: RemoteBrowser, socket: Socket, userId: string, browserId: string): void => {
  const activeControllers = new Map<string, AbortController>();
  socket.removeAllListeners('control-command');
  socket.removeAllListeners('control-cancel');
  socket.removeAllListeners('control-heartbeat');
  socket.removeAllListeners('control-release');

  const capability = () => socket.data.maxunControlCapability as {
    browserId?: string;
    ownerSessionId?: string;
    controlEpoch?: number;
    actor?: ControlActor;
  } | undefined;

  socket.on('control-command', async (payload: any) => {
    const current = capability();
    const commandId = typeof payload?.commandId === 'string' ? payload.commandId.trim() : '';
    const controlEpoch = current?.controlEpoch;
    if (!current || current.browserId !== browserId || !current.ownerSessionId || !Number.isSafeInteger(controlEpoch) || !current.actor || !commandId) {
      socket.emit('control-result', { commandId, success: false, code: 'stale_control' });
      return;
    }
    if (commandId.length > 255) {
      socket.emit('control-result', { commandId, success: false, code: 'invalid_control' });
      return;
    }
    try {
      const command = normalizeControlCommand(payload);
      const abort = new AbortController();
      activeControllers.set(commandId, abort);
      const result = await executeBrowserControlCommand(Number(userId), browserSession, {
        browserSessionId: browserId,
        ownerSessionId: current.ownerSessionId,
        actor: current.actor,
        controlEpoch: controlEpoch as number,
        commandId,
        commandType: command.kind,
        mode: command.mode,
      }, command, abort.signal);
      socket.emit('control-result', { commandId, success: true, data: result });
    } catch (error: unknown) {
      if (error instanceof ControlLeaseError) {
        socket.emit('control-result', { commandId, success: false, code: error.code });
      } else {
        socket.emit('control-result', { commandId, success: false, code: 'control_command_failed' });
      }
    } finally {
      activeControllers.delete(commandId);
    }
  });

  socket.on('control-cancel', (payload: { commandId?: string }) => {
    const commandId = typeof payload?.commandId === 'string' ? payload.commandId : '';
    activeControllers.get(commandId)?.abort(new Error('control command cancelled'));
  });

  socket.on('control-heartbeat', async () => {
    const current = capability();
    if (!current?.ownerSessionId || !current.actor || !Number.isSafeInteger(current.controlEpoch)) {
      socket.emit('control-status', { success: false, code: 'stale_control' });
      return;
    }
    try {
      const lease = await heartbeatControl(Number(userId), {
        browserSessionId: browserId,
        ownerSessionId: current.ownerSessionId,
        actor: current.actor,
        controlEpoch: current.controlEpoch,
      });
      socket.emit('control-status', { success: true, data: lease });
    } catch (error: unknown) {
      socket.emit('control-status', { success: false, code: error instanceof ControlLeaseError ? error.code : 'control_internal_error' });
    }
  });

  socket.on('control-release', async () => {
    const current = capability();
    if (!current?.ownerSessionId || !current.actor || !Number.isSafeInteger(current.controlEpoch)) {
      socket.emit('control-status', { success: false, code: 'stale_control' });
      return;
    }
    try {
      const released = await releaseControl(Number(userId), {
        browserSessionId: browserId,
        ownerSessionId: current.ownerSessionId,
        actor: current.actor,
        controlEpoch: current.controlEpoch,
      });
      cancelBrowserControlCommands(Number(userId), browserId);
      socket.emit('control-status', { success: true, data: released });
    } catch (error: unknown) {
      socket.emit('control-status', { success: false, code: error instanceof ControlLeaseError ? error.code : 'control_internal_error' });
    }
  });

  socket.on('disconnect', () => {
    for (const controller of activeControllers.values()) controller.abort(new Error('control socket disconnected'));
    cancelBrowserControlCommands(Number(userId), browserId);
  });
};

const initializeBrowserAsync = async (id: string, userId: string, enableLiveStream: boolean = false) => {
  try {
    const namespace = io.of(id);
    let clientConnected = false;
    let connectionTimeout: NodeJS.Timeout;
    let browserSession: RemoteBrowser | undefined;

    const waitForConnection = new Promise<Socket | null>((resolve) => {
      let initialResolved = false;
      namespace.on('connection', (socket: Socket) => {
        if (!socketOwns(socket, userId)) {
          logger.log('warn', `Rejected socket ${socket.id}: does not own browser ${id}`);
          socket.disconnect(true);
          return;
        }
        const streamCapability = socket.data.maxunStreamCapability as { browserId?: string } | undefined;
        const controlCapability = socket.data.maxunControlCapability as { browserId?: string } | undefined;
        const internalRunCapability = socket.data.maxunInternalRunCapability as { browserId?: string } | undefined;
        if (enableLiveStream && !streamCapability && !controlCapability) {
          logger.log('warn', `Rejected generic mutating socket ${socket.id} for Harness browser ${id}`);
          socket.disconnect(true);
          return;
        }
        if ((streamCapability && streamCapability.browserId !== id)
          || (controlCapability && controlCapability.browserId !== id)
          || (internalRunCapability && internalRunCapability.browserId !== id)) {
          logger.log('warn', `Rejected browser socket ${socket.id}: capability does not match browser ${id}`);
          socket.disconnect(true);
          return;
        }
        if (!initialResolved) {
          initialResolved = true;
          clientConnected = true;
          clearTimeout(connectionTimeout);
          logger.log('info', `Frontend connected to browser ${id} via socket ${socket.id}`);
          resolve(socket);
        } else if (browserSession) {
          if (streamCapability) browserSession.updateStreamSocket(socket);
          else if (controlCapability) attachControlSocket(browserSession, socket, userId, id);
          else browserSession.updateSocket(socket);
          logger.log('debug', `Additional frontend socket ${socket.id} joined browser ${id} namespace (shared connection)`);
        } else {
          logger.log('debug', `Additional frontend socket ${socket.id} joined browser ${id} namespace before initialization`);
        }
      });
      
      connectionTimeout = setTimeout(() => {
        if (!clientConnected) {
          logger.log('warn', `No client connected to browser ${id} within timeout, proceeding with dummy socket`);
          resolve(null);
        }
      }, 15000);
    });

    namespace.on('error', (error: any) => {
      logger.log('error', `Socket namespace error for browser ${id}: ${error.message}`);
      clearTimeout(connectionTimeout);
      browserPool.failBrowserSlot(id);
    });

    const connectWithRetry = async (maxRetries: number = 3): Promise<Socket | null> => {
      let retryCount = 0;
      
      while (retryCount < maxRetries) {
        try {
          const socket = await waitForConnection;
          if (socket || retryCount === maxRetries - 1) {
            return socket;
          }
        } catch (error: any) {
          logger.log('warn', `Connection attempt ${retryCount + 1} failed for browser ${id}: ${error.message}`);
        }
        
        retryCount++;
        if (retryCount < maxRetries) {
          const delay = Math.pow(2, retryCount) * 1000;
          logger.log('info', `Retrying connection for browser ${id} in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      return null;
    };

    const socket = await connectWithRetry(3);
    
    try {
      if (socket) {
        logger.log('info', `Using real socket for browser ${id}`);
        browserSession = new RemoteBrowser(socket, userId, id, enableLiveStream);
      } else {
        logger.log('info', `Using dummy socket for browser ${id}`);
        const dummySocket = {
          emit: (event: string, data?: any) => {
            logger.log('debug', `Browser ${id} dummy socket emitted ${event}:`, data);
          },
          on: () => {},
          off: () => {},
          removeAllListeners: () => {},
          id: `dummy-${id}`,
          nsp: {
            emit: (event: string, ...args: any[]) => {
              logger.log('debug', `Browser ${id} dummy namespace emitted ${event}`);
            },
          },
        } as any;
        
        browserSession = new RemoteBrowser(dummySocket, userId, id, enableLiveStream);
      }

      logger.log('debug', `Starting browser initialization for ${id}`);

      try {
        const BROWSER_INIT_TIMEOUT = 45000;
        logger.log('info', `Browser initialization starting with ${BROWSER_INIT_TIMEOUT/1000}s timeout`);

        const initPromise = browserSession.initialize(userId);
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Browser initialization timeout')), BROWSER_INIT_TIMEOUT);
        });

        await Promise.race([initPromise, timeoutPromise]);
      } catch (initError: any) {
        logger.log('error', `Browser initialization failed for ${id}: ${initError.message}`);
        try {
          await browserSession.switchOff();
          logger.log('info', `Cleaned up failed browser initialization for ${id}`);
        } catch (cleanupError: any) {
          logger.log('error', `Failed to cleanup browser ${id}: ${cleanupError.message}`);
        }
        throw initError;
      }

      const upgraded = browserPool.upgradeBrowserSlot(id, browserSession);
      if (!upgraded) {
        try {
          await browserSession.switchOff();
        } catch (cleanupError: any) {
          logger.log('error', `Failed to cleanup browser after slot upgrade failure: ${cleanupError.message}`);
        }
        throw new Error('Failed to upgrade reserved browser slot');
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (socket) {
        const initialControl = socket.data.maxunControlCapability as { browserId?: string } | undefined;
        if (initialControl) attachControlSocket(browserSession, socket, userId, id);
        else if (enableLiveStream) browserSession.updateStreamSocket(socket);
        socket.emit('ready-for-run');
      } else {
        setTimeout(async () => {
          try {
            logger.log('info', `Browser ${id} with dummy socket is ready for execution`);
          } catch (error: any) {
            logger.log('error', `Error with dummy socket browser ${id}: ${error.message}`);
          }
        }, 100); 
      }
      
      logger.log('info', `Browser ${id} successfully initialized for run with ${socket ? 'real' : 'dummy'} socket`);
      
    } catch (error: any) {
      logger.log('error', `Error initializing browser ${id}: ${error.message}`);
      browserPool.failBrowserSlot(id);
      if (socket) {
        socket.emit('error', { message: error.message });
      }
      throw error;
    }
    
  } catch (error: any) {
    logger.log('error', `Error setting up browser ${id}: ${error.message}`);
    browserPool.failBrowserSlot(id);
    throw error;
  }
};

/**
 * Creates a RemoteBrowser instance specifically for SDK validation
 * Uses dummy socket and returns browser ID and Page for validation tasks
 * @param userId User ID for browser ownership
 * @returns Promise with browser ID and Page instance
 * @category BrowserManagement-Controller
 */
export const createRemoteBrowserForValidation = async (
  userId: string
): Promise<{ browserId: string; page: Page }> => {
  const id = uuid();

  logger.log('info', `Creating validation browser ${id} for user ${userId}`);

  try {
    const dummySocket = {
      emit: (event: string, data?: any) => {
        logger.log('debug', `Browser ${id} emitted ${event}`);
      },
      on: () => {},
      off: () => {},
      id: `validation-${id}`,
      nsp: {
        emit: (event: string, ...args: any[]) => {},
      },
    } as any;

    const browserSession = new RemoteBrowser(dummySocket, userId, id);

    const VALIDATION_INIT_TIMEOUT = 45000;
    const initPromise = browserSession.initialize(userId);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Validation browser initialization timeout')), VALIDATION_INIT_TIMEOUT);
    });

    await Promise.race([initPromise, timeoutPromise]);

    const added = browserPool.addRemoteBrowser(id, browserSession, userId, true, 'run');
    if (!added) {
      await browserSession.switchOff();
      throw new Error('Failed to add validation browser to pool');
    }

    const page = browserSession.getCurrentPage();
    if (!page) {
      await destroyRemoteBrowser(id, userId);
      throw new Error('Failed to get page from validation browser');
    }

    logger.log('info', `Browser ${id} initialized successfully`);

    return { browserId: id, page };
  } catch (error: any) {
    logger.log('error', `Failed to create validation browser ${id}: ${error.message}`);
    try {
      await destroyRemoteBrowser(id, userId);
    } catch (cleanupError) {
      logger.log('warn', `Failed to cleanup browser ${id}: ${cleanupError}`);
    }
    throw error;
  }
};