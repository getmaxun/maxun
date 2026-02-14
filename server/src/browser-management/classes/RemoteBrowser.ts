import {
    Page,
    Browser,
    CDPSession,
    BrowserContext
} from 'playwright-core';
import { Socket } from "socket.io";
import { PlaywrightBlocker } from '@cliqz/adblocker-playwright';
import fetch from 'cross-fetch';
import logger from '../../logger';
import { readFileSync } from "fs";
import { InterpreterSettings } from "../../types";
import { WorkflowGenerator } from "../../workflow-management/classes/Generator";
import { WorkflowInterpreter } from "../../workflow-management/classes/Interpreter";
import { getDecryptedProxyConfig } from '../../routes/proxy';
import { getInjectableScript } from 'idcac-playwright';
import { FingerprintInjector } from "fingerprint-injector";
import { FingerprintGenerator } from "fingerprint-generator";
import { connectToRemoteBrowser } from '../browserConnection';

declare global {
  interface Window {
    rrweb?: any;
    isRecording?: boolean;
    emitEventToBackend?: (event: any) => Promise<void>;
  }
}

// const MEMORY_CONFIG = {
//     gcInterval: 20000,
//     maxHeapSize: 1536 * 1024 * 1024,
//     heapUsageThreshold: 0.7
// };

/**
 * This class represents a remote browser instance.
 * It is used to allow a variety of interaction with the Playwright's browser instance.
 * Every remote browser holds an instance of a generator and interpreter classes with
 * the purpose of generating and interpreting workflows.
 * @category BrowserManagement
 */
export class RemoteBrowser {

    /**
     * Playwright's [browser](https://playwright.dev/docs/api/class-browser) instance.
     * @private
     */
    private browser: Browser | null = null;

    private context: BrowserContext | null = null;

    /**
     * The Playwright's [CDPSession](https://playwright.dev/docs/api/class-cdpsession) instance,
     * used to talk raw Chrome Devtools Protocol.
     * @private
     */
    private client: CDPSession | null | undefined = null;

    /**
     * Socket.io socket instance enabling communication with the client (frontend) side.
     * @private
     */
    private socket: Socket;

    /**
     * The Playwright's [Page](https://playwright.dev/docs/api/class-page) instance
     * as current interactive remote browser's page.
     * @private
     */
    private currentPage: Page | null | undefined = null;

    /**
     * Interpreter settings for any started interpretation.
     * @private
     */
    private interpreterSettings: InterpreterSettings = {
        debug: false,
        maxConcurrency: 1,
        maxRepeats: 1,
    };

    /**
     * The user ID that owns this browser instance
     * @private
     */
    private userId: string;

    private lastEmittedUrl: string | null = null;

    /**
     * {@link WorkflowGenerator} instance specific to the remote browser.
     */
    public generator: WorkflowGenerator;

    /**
     * {@link WorkflowInterpreter} instance specific to the remote browser.
     */
    public interpreter: WorkflowInterpreter;

    public isDOMStreamingActive: boolean = false;
    private lastScrollPosition = { x: 0, y: 0 };
    private scrollThreshold = 200;

    /**
     * Flag to indicate if this is a recording session (requires rrweb for real-time DOM streaming)
     * When false (robot run mode), rrweb is skipped to improve performance
     * @private
     */
    private isRecordingMode: boolean = false;

    // private memoryCleanupInterval: NodeJS.Timeout | null = null;
    // private memoryManagementInterval: NodeJS.Timeout | null = null;

    /**
     * Initializes a new instances of the {@link Generator} and {@link WorkflowInterpreter} classes and
     * assigns the socket instance everywhere.
     * @param socket socket.io socket instance used to communicate with the client side
     * @constructor
     */
    public constructor(socket: Socket, userId: string, poolId: string, isRecordingMode: boolean = false) {
        this.socket = socket;
        this.userId = userId;
        this.interpreter = new WorkflowInterpreter(socket);
        this.generator = new WorkflowGenerator(socket, poolId);
        this.isRecordingMode = isRecordingMode;
    }

    // private initializeMemoryManagement(): void {
    //   this.memoryManagementInterval = setInterval(() => {
    //     const memoryUsage = process.memoryUsage();
    //     const heapUsageRatio = memoryUsage.heapUsed / MEMORY_CONFIG.maxHeapSize;

    //     if (heapUsageRatio > MEMORY_CONFIG.heapUsageThreshold * 1.2) {
    //       logger.warn(
    //         "Critical memory pressure detected, triggering emergency cleanup"
    //       );
    //       this.performMemoryCleanup();
    //     } else if (heapUsageRatio > MEMORY_CONFIG.heapUsageThreshold) {
    //       logger.warn("High memory usage detected, triggering cleanup");

    //       if (
    //         global.gc &&
    //         heapUsageRatio > MEMORY_CONFIG.heapUsageThreshold * 1.1
    //       ) {
    //         global.gc();
    //       }
    //     }
    //   }, MEMORY_CONFIG.gcInterval);
    // }

    // private async performMemoryCleanup(): Promise<void> {
    //   if (global.gc) {
    //     try {
    //       global.gc();
    //       logger.info("Garbage collection requested");
    //     } catch (error) {
    //       logger.error("Error during garbage collection:", error);
    //     }
    //   }

    //   if (this.currentPage) {
    //     try {
    //       await new Promise((resolve) => setTimeout(resolve, 500));
    //       logger.info("CDP session reset completed");
    //     } catch (error) {
    //       logger.error("Error resetting CDP session:", error);
    //     }
    //   }

    //   this.socket.emit("memory-cleanup", {
    //     userId: this.userId,
    //     timestamp: Date.now(),
    //   });
    // }

    /**
     * Normalizes URLs to prevent navigation loops while maintaining consistent format
     */
    private normalizeUrl(url: string): string {
        try {
            const parsedUrl = new URL(url);
            parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
            parsedUrl.protocol = parsedUrl.protocol.toLowerCase();
            return parsedUrl.toString();
        } catch {
            return url;
        }
    }

    /**
     * Determines if a URL change is significant enough to emit
     */
    private shouldEmitUrlChange(newUrl: string): boolean {
        if (!this.lastEmittedUrl) {
            return true;
        }
        const normalizedNew = this.normalizeUrl(newUrl);
        const normalizedLast = this.normalizeUrl(this.lastEmittedUrl);
        return normalizedNew !== normalizedLast;
    }

    /**
     * Setup scroll event listener to track user scrolling
     */
    private setupScrollEventListener(): void {
      try {
        this.socket.removeAllListeners('dom:scroll');
      } catch (error: any) {
        logger.warn(`Error removing old scroll listener: ${error.message}`);
      }

      this.socket.on(
        "dom:scroll",
        async (data: { deltaX: number; deltaY: number }) => {
          if (!this.isDOMStreamingActive || !this.currentPage) return;

          try {
            await this.currentPage.mouse.wheel(data.deltaX, data.deltaY);

            const scrollInfo = await this.currentPage.evaluate(() => ({
              x: window.scrollX,
              y: window.scrollY,
              maxX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
              maxY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
              documentHeight: document.documentElement.scrollHeight,
              viewportHeight: window.innerHeight,
            }));

            const scrollDelta =
              Math.abs(scrollInfo.y - this.lastScrollPosition.y) +
              Math.abs(scrollInfo.x - this.lastScrollPosition.x);

            if (scrollDelta > this.scrollThreshold) {
              this.lastScrollPosition = { x: scrollInfo.x, y: scrollInfo.y };
            }
          } catch (error) {
            logger.error("Error handling scroll event:", error);
          }
        }
      );
    }

    private emitLoadingProgress(progress: number, pendingRequests: number): void {
      this.socket.emit("domLoadingProgress", {
        progress: Math.round(progress),
        pendingRequests,
        userId: this.userId,
        timestamp: Date.now(),
      });
    }

    private async setupPageEventListeners(page: Page) {
        try {
          page.removeAllListeners('framenavigated');
          page.removeAllListeners('load');
          logger.debug('Removed existing page event listeners before re-registering');
        } catch (error: any) {
          logger.warn(`Error removing existing page listeners: ${error.message}`);
        }

        page.on('framenavigated', async (frame) => {
          if (frame === page.mainFrame()) {
            const currentUrl = page.url();
            if (this.shouldEmitUrlChange(currentUrl)) {
              this.lastEmittedUrl = currentUrl;
              this.socket.emit('urlChanged', { url: currentUrl, userId: this.userId });
            }

            await page.evaluate(() => {
              if (window.rrweb && window.isRecording) {
                window.isRecording = false;
              }
            });

            if (this.isRecordingMode) {
              await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
                logger.warn('[rrweb] Network idle timeout on navigation, proceeding with rrweb initialization');
              });

              await this.initializeRRWebRecording(page);
            }
          }
        });

        page.on('load', async () => {
            const injectScript = async (): Promise<boolean> => {
                try {
                    await page.waitForLoadState('networkidle', { timeout: 5000 });

                    if (page.isClosed()) {
                      logger.debug('Page is closed, cannot inject script');
                      return false;
                    }

                    await page.evaluate(getInjectableScript());
                    return true;
                } catch (error: any) {
                    logger.log('warn', `Script injection attempt failed: ${error.message}`);
                    return false;
                }
            };

            const success = await injectScript();
            console.log("Script injection result:", success);
        });
    }

    /**
   * Initialize rrweb recording for real-time DOM streaming
   * This replaces the snapshot-based approach with live event streaming
   * Only runs in recording mode - skipped for robot runs to improve performance
   */
    private async initializeRRWebRecording(page: Page): Promise<void> {
      if (!this.isRecordingMode) {
        logger.debug('[rrweb] Skipping initialization - not in recording mode (robot run)');
        return;
      }

      try {
        const rrwebJsPath = require.resolve('rrweb/dist/rrweb.min.js');
        const rrwebScriptContent = readFileSync(rrwebJsPath, 'utf8');

        await page.context().addInitScript(rrwebScriptContent);

        await page.evaluate((scriptContent) => {
          if (typeof window.rrweb === 'undefined') {
            try {
              (0, eval)(scriptContent);
            } catch (e) {
              console.error('[rrweb] eval failed:', e);
            }
          }
        }, rrwebScriptContent);

        const rrwebLoaded = await page.evaluate(() => typeof window.rrweb !== 'undefined');
        if (rrwebLoaded) {
          logger.debug('[rrweb] Script injected successfully');
        } else {
          logger.warn('[rrweb] Script injection failed - window.rrweb not found');
        }

        const isAlreadyExposed = await page.evaluate(() => {
          return typeof window.emitEventToBackend === 'function';
        });

        if (!isAlreadyExposed) {
          let hasEmittedFullSnapshot = false;
          await page.exposeFunction('emitEventToBackend', (event: any) => {
            this.socket.emit('rrweb-event', event);

            if (event.type === 2 && !hasEmittedFullSnapshot) {
              hasEmittedFullSnapshot = true;
              this.emitLoadingProgress(100, 0);
              logger.debug(`[rrweb] Full snapshot sent, loading progress at 100%`);
            }
          });
        }

        const rrwebStatus = await page.evaluate(() => {
          if (!window.rrweb) {
            console.error('[rrweb] window.rrweb is not defined!');
            return { success: false, error: 'window.rrweb is not defined' };
          }

          if (window.isRecording) {
            return { success: false, error: 'already recording' };
          }

          window.isRecording = true;

          try {
            const recordHandle = window.rrweb.record({
              emit(event: any) {
                if (window.emitEventToBackend) {
                  window.emitEventToBackend(event).catch(() => { });
                }
              },
              maskAllInputs: false,
              recordCanvas: true,
              input: true
            });

            (window as any).rrwebRecordHandle = recordHandle;

            return { success: true };
          } catch (error: any) {
            console.error('[rrweb] Failed to start recording:', error);
            return { success: false, error: error.message };
          }
        });

        if (rrwebStatus.success) {
          this.isDOMStreamingActive = true;
          this.emitLoadingProgress(80, 0);
          this.setupScrollEventListener();
        } else {
          logger.error(`Failed to initialize rrweb recording: ${rrwebStatus.error}`);
        }
      } catch (error: any) {
        logger.error(`Failed to initialize rrweb recording: ${error.message}`);
      }
    }

    private getUserAgent() {
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.140 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:117.0) Gecko/20100101 Firefox/117.0',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.1938.81 Safari/537.36 Edg/116.0.1938.81',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.96 Safari/537.36 OPR/101.0.4843.25',
            'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.5938.62 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:118.0) Gecko/20100101 Firefox/118.0',
        ];

        return userAgents[Math.floor(Math.random() * userAgents.length)];
    }

  /**
 * Apply modern fingerprint-suite injection
 */
  private async applyEnhancedFingerprinting(context: BrowserContext): Promise<void> {
    try {
      try {
        const fingerprintGenerator = new FingerprintGenerator();
        const fingerprint = fingerprintGenerator.getFingerprint();
        const fingerprintInjector = new FingerprintInjector();

        await fingerprintInjector.attachFingerprintToPlaywright(context as any, fingerprint);

        logger.info("Enhanced fingerprinting applied successfully");
      } catch (fingerprintError: any) {
        logger.warn(`Modern fingerprint injection failed: ${fingerprintError.message}. Using existing protection.`);
      }
    } catch (error: any) {
      logger.error(`Enhanced fingerprinting failed: ${error.message}`);
    }
  }

    /**
     * An asynchronous constructor for asynchronously initialized properties.
     * Must be called right after creating an instance of RemoteBrowser class.
     * @param options remote browser options to be used when launching the browser
     * @returns {Promise<void>}
     */
    public initialize = async (userId: string): Promise<void> => {
        const MAX_RETRIES = 3;
        const OVERALL_INIT_TIMEOUT = 120000;
        let retryCount = 0;
        let success = false;

        this.socket.emit("dom-snapshot-loading", {
          userId: this.userId,
          timestamp: Date.now(),
        });
        this.emitLoadingProgress(0, 0);

        const initializationPromise = (async () => {
          while (!success && retryCount < MAX_RETRIES) {
            try {
              this.browser = await connectToRemoteBrowser();

              if (!this.browser || this.browser.isConnected() === false) {
                  throw new Error('Browser failed to launch or is not connected');
              }

              this.emitLoadingProgress(20, 0);

              const proxyConfig = await getDecryptedProxyConfig(userId);
              let proxyOptions: { server: string, username?: string, password?: string } = { server: '' };

              if (proxyConfig.proxy_url) {
                proxyOptions = {
                  server: proxyConfig.proxy_url,
                  ...(proxyConfig.proxy_username && proxyConfig.proxy_password && {
                    username: proxyConfig.proxy_username,
                    password: proxyConfig.proxy_password,
                  }),
                };
              }

              const contextOptions: any = {
                // viewport: { height: 400, width: 900 },
                // recordVideo: { dir: 'videos/' }
                // Force reduced motion to prevent animation issues
                reducedMotion: 'reduce',
                // Force JavaScript to be enabled
                javaScriptEnabled: true,
                // Set a reasonable timeout
                timeout: 50000,
                // Disable hardware acceleration
                forcedColors: 'none',
                isMobile: false,
                hasTouch: false,
                userAgent: this.getUserAgent(),
              };

              if (proxyOptions.server) {
                contextOptions.proxy = {
                  server: proxyOptions.server,
                  username: proxyOptions.username ? proxyOptions.username : undefined,
                  password: proxyOptions.password ? proxyOptions.password : undefined,
                };
              }

              await new Promise(resolve => setTimeout(resolve, 500));

              const contextPromise = this.browser.newContext(contextOptions);
              this.context = await Promise.race([
                contextPromise,
                new Promise<never>((_, reject) => {
                  setTimeout(() => reject(new Error('Context creation timed out after 15s')), 15000);
                })
              ]) as BrowserContext;

              await this.applyEnhancedFingerprinting(this.context);

              await this.context.addInitScript(
                `const defaultGetter = Object.getOwnPropertyDescriptor(
                        Navigator.prototype,
                        "webdriver"
                      ).get;
                      defaultGetter.apply(navigator);
                      defaultGetter.toString();
                      Object.defineProperty(Navigator.prototype, "webdriver", {
                        set: undefined,
                        enumerable: true,
                        configurable: true,
                        get: new Proxy(defaultGetter, {
                          apply: (target, thisArg, args) => {
                            Reflect.apply(target, thisArg, args);
                            return false;
                          },
                        }),
                      });
                      const patchedGetter = Object.getOwnPropertyDescriptor(
                        Navigator.prototype,
                        "webdriver"
                      ).get;
                      patchedGetter.apply(navigator);
                      patchedGetter.toString();`
              );

              this.currentPage = await this.context.newPage();

              this.emitLoadingProgress(40, 0);

              await this.setupPageEventListeners(this.currentPage);

              if (this.isRecordingMode) {
                await this.currentPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
                  logger.warn('[rrweb] Network idle timeout, proceeding with rrweb initialization');
                });

                await this.initializeRRWebRecording(this.currentPage);
              }

              try {
                const blocker = await PlaywrightBlocker.fromLists(fetch, ['https://easylist.to/easylist/easylist.txt']);
                await blocker.enableBlockingInPage(this.currentPage as any);
                this.client = await this.currentPage.context().newCDPSession(this.currentPage);
                await blocker.disableBlockingInPage(this.currentPage as any);
                console.log('Adblocker initialized');
              } catch (error: any) {
                console.warn('Failed to initialize adblocker, continuing without it:', error.message);
                this.client = await this.currentPage.context().newCDPSession(this.currentPage);
              }

              success = true;
              logger.log('debug', `Browser initialized successfully for user ${userId}`);
            } catch (error: any) {
              retryCount++;
              logger.log('error', `Browser initialization failed (attempt ${retryCount}/${MAX_RETRIES}): ${error.message}`);

              if (this.browser) {
                try {
                  await this.browser.close();
                } catch (closeError) {
                  logger.log('warn', `Failed to close browser during cleanup: ${closeError}`);
                }
                this.browser = null;
              }

              if (retryCount >= MAX_RETRIES) {
                throw new Error(`Failed to initialize browser after ${MAX_RETRIES} attempts: ${error.message}`);
              }

              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        })();

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Browser initialization timed out after ${OVERALL_INIT_TIMEOUT}ms`)), OVERALL_INIT_TIMEOUT);
        });

        await Promise.race([initializationPromise, timeoutPromise]);
    };

    /**
     * Captures a screenshot directly without running the workflow interpreter
     * @param settings Screenshot settings containing fullPage, type, etc.
     * @returns Promise<void>
     */
    public captureDirectScreenshot = async (settings: {
      fullPage: boolean;
      type: 'png' | 'jpeg';
      timeout?: number;
      animations?: 'disabled' | 'allow';
      caret?: 'hide' | 'initial';
      scale?: 'css' | 'device';
    }): Promise<void> => {
      if (!this.currentPage) {
        logger.error("No current page available for screenshot");
        this.socket.emit('screenshotError', {
          userId: this.userId,
          error: 'No active page available'
        });
        return;
      }

      try {
        this.socket.emit('screenshotCaptureStarted', {
          userId: this.userId,
          fullPage: settings.fullPage
        });

        const screenshotBuffer = await this.currentPage.screenshot({
          fullPage: settings.fullPage,
          type: settings.type || 'png',
          timeout: settings.timeout || 30000,
          animations: settings.animations || 'allow',
          caret: settings.caret || 'hide',
          scale: settings.scale || 'device'
        });

        const base64Data = screenshotBuffer.toString('base64');
        const mimeType = `image/${settings.type || 'png'}`;
        const dataUrl = `data:${mimeType};base64,${base64Data}`;

        this.socket.emit('directScreenshotCaptured', {
          userId: this.userId,
          screenshot: dataUrl,
          mimeType: mimeType,
          fullPage: settings.fullPage,
          timestamp: Date.now()
        });
      } catch (error) {
        logger.error('Failed to capture direct screenshot:', error);
        this.socket.emit('screenshotError', {
          userId: this.userId,
          error: error instanceof Error ? error.message : 'Unknown error occurred'
        });
      }
    };

    /**
     * Removes all socket event listeners
     */
    private removeAllSocketListeners(): void {
      try {
        this.socket.removeAllListeners('captureDirectScreenshot');
        this.socket.removeAllListeners('settings');
        this.socket.removeAllListeners('changeTab');
        this.socket.removeAllListeners('addTab');
        this.socket.removeAllListeners('closeTab');
        this.socket.removeAllListeners('dom:scroll');

        logger.debug(`Removed all socket listeners for user ${this.userId}`);
      } catch (error: any) {
        logger.warn(`Error removing socket listeners: ${error.message}`);
      }
    }

    /**
     * Registers all event listeners needed for the recording editor session.
     * Should be called only once after the full initialization of the remote browser.
     * @returns void
     */
    public registerEditorEvents = (): void => {
      logger.log("debug", `Registering editor events for user: ${this.userId}`);

      this.removeAllSocketListeners();

      this.socket.on("captureDirectScreenshot", async (settings) => {
        await this.captureDirectScreenshot(settings);
      });

      this.socket.on(
        "changeTab",
        async (tabIndex) => await this.changeTab(tabIndex)
      );

      this.socket.on("addTab", async () => {
        await this.currentPage?.context().newPage();
        const lastTabIndex = this.currentPage
          ? this.currentPage.context().pages().length - 1
          : 0;
        await this.changeTab(lastTabIndex);
      });

      this.socket.on("closeTab", async (tabInfo) => {
        const page = this.currentPage?.context().pages()[tabInfo.index];
        if (page) {
          if (tabInfo.isCurrent) {
            if (this.currentPage?.context().pages()[tabInfo.index + 1]) {
              await this.changeTab(tabInfo.index + 1);
            } else {
              await this.changeTab(tabInfo.index - 1);
            }
          }
          await page.close();
        }
      });
    };

    /**
     * Terminates the dom snapshot session and closes the remote browser.
     * If an interpretation was running it will be stopped.
     * @returns {Promise<void>}
     */
    public async switchOff(): Promise<void> {
      this.isDOMStreamingActive = false;

      // if (this.memoryCleanupInterval) {
      //   clearInterval(this.memoryCleanupInterval);
      //   this.memoryCleanupInterval = null;
      // }

      // if (this.memoryManagementInterval) {
      //   clearInterval(this.memoryManagementInterval);
      //   this.memoryManagementInterval = null;
      // }

      this.removeAllSocketListeners();

      try {
        if (this.currentPage) {
          const isClosed = this.currentPage.isClosed();
          if (!isClosed) {
            this.currentPage.removeAllListeners();
            logger.debug('Removed all page event listeners');
          } else {
            logger.debug('Page already closed, skipping listener removal');
          }
        }
      } catch (error: any) {
        logger.warn(`Error removing page listeners: ${error.message}`);
      }

      if (this.generator) {
        try {
          this.generator.cleanup();
          logger.debug('Generator cleanup completed');
        } catch (error: any) {
          logger.warn(`Error cleaning up generator: ${error.message}`);
        }
      }

      try {
        await this.interpreter.stopInterpretation();
      } catch (error) {
        logger.error("Error stopping interpretation during shutdown:", error);
      }

      try {
        if (this.client && this.currentPage && !this.currentPage.isClosed()) {
          const detachPromise = this.client.detach();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('CDP detach timeout')), 5000)
          );
          await Promise.race([detachPromise, timeoutPromise]);
          logger.debug('CDP session detached successfully');
        }
      } catch (error: any) {
        logger.warn(`Error detaching CDP session: ${error.message}`);
      } finally {
        this.client = null;
      }

      try {
        if (this.currentPage && !this.currentPage.isClosed()) {
          const closePromise = this.currentPage.close();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Page close timeout')), 5000)
          );
          await Promise.race([closePromise, timeoutPromise]);
          logger.debug('Current page closed successfully');
        }
      } catch (error: any) {
        logger.warn(`Error closing current page: ${error.message}`);
      } finally {
        this.currentPage = null;
      }

      try {
        if (this.context) {
          const contextClosePromise = this.context.close();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Context close timeout')), 5000)
          );
          await Promise.race([contextClosePromise, timeoutPromise]);
          logger.debug('Browser context closed successfully');
        }
      } catch (error: any) {
        logger.warn(`Error closing browser context: ${error.message}`);
      } finally {
        this.context = null;
      }

      try {
        if (this.browser) {
          const browserClosePromise = this.browser.close();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Browser close timeout')), 5000)
          );
          await Promise.race([browserClosePromise, timeoutPromise]);
          logger.debug('Browser closed successfully');
        }
      } catch (error: any) {
        logger.error("Error during browser close:", error);
      } finally {
        this.browser = null;
      }
    }

    /**
     * Updates the active socket instance.
     * This will update all registered events for the socket and
     * all the properties using the socket.
     * @param socket socket.io socket instance used to communicate with the client side
     * @returns void
     */
    public updateSocket = (socket: Socket): void => {
        this.socket = socket;
        this.registerEditorEvents();
        this.generator?.updateSocket(socket);
        this.interpreter?.updateSocket(socket);

        if (this.isDOMStreamingActive) {
          this.setupScrollEventListener();
        }
    };

    /**
     * Starts the interpretation of the currently generated workflow.
     * @returns {Promise<void>}
     */
    public interpretCurrentRecording = async (): Promise<void> => {
        logger.log('debug', 'Starting interpretation in the editor');
        if (this.generator) {
            const workflow = this.generator.AddGeneratedFlags(this.generator.getWorkflowFile());
            await this.initializeNewPage();
            if (this.currentPage) {
                // this.currentPage.setViewportSize({ height: 400, width: 900 });
                const params = this.generator.getParams();
                if (params) {
                    this.interpreterSettings.params = params.reduce((acc, param) => {
                        if (this.interpreterSettings.params && Object.keys(this.interpreterSettings.params).includes(param)) {
                            return { ...acc, [param]: this.interpreterSettings.params[param] };
                        } else {
                            return { ...acc, [param]: '', }
                        }
                    }, {})
                }
                logger.log('debug', `Starting interpretation with settings: ${JSON.stringify(this.interpreterSettings, null, 2)}`);
                await this.interpreter.interpretRecordingInEditor(
                    workflow, this.currentPage,
                    (newPage: Page) => this.currentPage = newPage,
                    this.interpreterSettings
                );
                // clear the active index from generator
                this.generator.clearLastIndex();
            } else {
                logger.log('error', 'Could not get a new page, returned undefined');
            }
        } else {
            logger.log('error', 'Generator is not initialized');
        }
    };

    /**
     * Returns the current page instance.
     * @returns {Page | null | undefined}
     */
    public getCurrentPage = (): Page | null | undefined => {
        return this.currentPage;
    };

    /**
     * Changes the active page to the page instance on the given index
     * available in pages array on the {@link BrowserContext}.
     * Automatically stops the screencast session on the previous page and starts the new one.
     * @param tabIndex index of the page in the pages array on the {@link BrowserContext}
     * @returns {Promise<void>}
     */
    private changeTab = async (tabIndex: number): Promise<void> => {
        const page = this.currentPage?.context().pages()[tabIndex];
        if (page) {
            this.currentPage = page;

            await this.setupPageEventListeners(this.currentPage);

            //await this.currentPage.setViewportSize({ height: 400, width: 900 })
            this.client = await this.currentPage.context().newCDPSession(this.currentPage);
           // Include userId in the URL change event
            this.socket.emit('urlChanged', { 
                url: this.currentPage.url(),
                userId: this.userId
            });
        } else {
            logger.log('error', `${tabIndex} index out of range of pages`)
        }
    }

    /**
     * Internal method for a new page initialization. Subscribes this page to the screencast.
     * @param options optional page options to be used when creating a new page
     * @returns {Promise<void>}
     */
    private initializeNewPage = async (options?: Object): Promise<void> => {
        const newPage = options ? await this.browser?.newPage(options)
            : await this.browser?.newPage();
        await newPage?.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
        });

        await this.currentPage?.close();
        this.currentPage = newPage;
        if (this.currentPage) {
            await this.setupPageEventListeners(this.currentPage);
            logger.debug('Using rrweb live recording for new page');
        } else {
            logger.log('error', 'Could not get a new page, returned undefined');
        }
    };
}
