import {
    Page,
    Browser,
    CDPSession,
    BrowserContext,
} from 'playwright';
import { Socket } from "socket.io";
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { PlaywrightBlocker } from '@cliqz/adblocker-playwright';
import fetch from 'cross-fetch';
import sharp from 'sharp';
import logger from '../../logger';
import { InterpreterSettings } from "../../types";
import { WorkflowGenerator } from "../../workflow-management/classes/Generator";
import { WorkflowInterpreter } from "../../workflow-management/classes/Interpreter";
import { getDecryptedProxyConfig } from '../../routes/proxy';
import { getInjectableScript } from 'idcac-playwright';

chromium.use(stealthPlugin());

const MEMORY_CONFIG = {
    gcInterval: 20000, // Check memory more frequently (20s instead of 60s)
    maxHeapSize: 1536 * 1024 * 1024, // 1.5GB
    heapUsageThreshold: 0.7 // 70% (reduced threshold to react earlier)
};

const SCREENCAST_CONFIG: {
    format: "jpeg" | "png";
    maxWidth: number;
    maxHeight: number;
    targetFPS: number;
    compressionQuality: number;
    maxQueueSize: number;
} = {
    format: 'png', 
    maxWidth: 1280,
    maxHeight: 720,
    targetFPS: 15, 
    compressionQuality: 0.95, 
    maxQueueSize: 1 
};

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


    private screenshotQueue: Buffer[] = [];
    private isProcessingScreenshot = false;
    private screencastInterval: NodeJS.Timeout | null = null
    private isScreencastActive: boolean = false;

    /**
     * Initializes a new instances of the {@link Generator} and {@link WorkflowInterpreter} classes and
     * assigns the socket instance everywhere.
     * @param socket socket.io socket instance used to communicate with the client side
     * @constructor
     */
    public constructor(socket: Socket, userId: string) {
        this.socket = socket;
        this.userId = userId;
        this.interpreter = new WorkflowInterpreter(socket);
        this.generator = new WorkflowGenerator(socket);
    }

    private initializeMemoryManagement(): void {
        setInterval(() => {
            const memoryUsage = process.memoryUsage();
            const heapUsageRatio = memoryUsage.heapUsed / MEMORY_CONFIG.maxHeapSize;
            
            if (heapUsageRatio > MEMORY_CONFIG.heapUsageThreshold * 1.2) {
                logger.warn('Critical memory pressure detected, triggering emergency cleanup');
                this.performMemoryCleanup();
            } else if (heapUsageRatio > MEMORY_CONFIG.heapUsageThreshold) {
                logger.warn('High memory usage detected, triggering cleanup');
                
                if (this.screenshotQueue.length > 0) {
                    this.screenshotQueue = [];
                    logger.info('Screenshot queue cleared due to memory pressure');
                }
                
                if (global.gc && heapUsageRatio > MEMORY_CONFIG.heapUsageThreshold * 1.1) {
                    global.gc();
                }
            }
            
            if (this.screenshotQueue.length > SCREENCAST_CONFIG.maxQueueSize) {
                this.screenshotQueue = this.screenshotQueue.slice(-SCREENCAST_CONFIG.maxQueueSize);
            }
        }, MEMORY_CONFIG.gcInterval);
    }

    private async performMemoryCleanup(): Promise<void> {
        this.screenshotQueue = [];
        this.isProcessingScreenshot = false;
        
        if (global.gc) {
            try {
                global.gc();
                logger.info('Garbage collection requested');
            } catch (error) {
                logger.error('Error during garbage collection:', error);
            }
        }
        
        if (this.client) {
            try {
                await this.stopScreencast();
                
                await new Promise(resolve => setTimeout(resolve, 500));
                
                this.client = null;
                if (this.currentPage) {
                    this.client = await this.currentPage.context().newCDPSession(this.currentPage);
                    await this.startScreencast();
                    logger.info('CDP session reset completed');
                }
            } catch (error) {
                logger.error('Error resetting CDP session:', error);
            }
        }
        
        this.socket.emit('memory-cleanup', {
            userId: this.userId,
            timestamp: Date.now()
        });
    }

    /**
     * Normalizes URLs to prevent navigation loops while maintaining consistent format
     */
    private normalizeUrl(url: string): string {
        try {
            const parsedUrl = new URL(url);
            // Remove trailing slashes except for root path
            parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
            // Ensure consistent protocol handling
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

    private async setupPageEventListeners(page: Page) {
        page.on('framenavigated', async (frame) => {
            if (frame === page.mainFrame()) {
                const currentUrl = page.url();
                if (this.shouldEmitUrlChange(currentUrl)) {
                    this.lastEmittedUrl = currentUrl;
                    this.socket.emit('urlChanged', {url: currentUrl, userId: this.userId});
                }
            }
        });

        // Handle page load events with retry mechanism
        page.on('load', async () => {
            const injectScript = async (): Promise<boolean> => {
                try {
                    await page.waitForLoadState('networkidle', { timeout: 5000 });

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
     * An asynchronous constructor for asynchronously initialized properties.
     * Must be called right after creating an instance of RemoteBrowser class.
     * @param options remote browser options to be used when launching the browser
     * @returns {Promise<void>}
     */
    public initialize = async (userId: string): Promise<void> => {
        const MAX_RETRIES = 3;
        let retryCount = 0;
        let success = false;
    
        while (!success && retryCount < MAX_RETRIES) {
            try {
                this.browser = <Browser>(await chromium.launch({
                    headless: true,
                    args: [
                        "--disable-blink-features=AutomationControlled",
                        "--disable-web-security",
                        "--disable-features=IsolateOrigins,site-per-process",
                        "--disable-site-isolation-trials",
                        "--disable-extensions",
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                        "--force-color-profile=srgb",
                        "--force-device-scale-factor=2",
                    ],
                }));
                
                if (!this.browser || this.browser.isConnected() === false) {
                    throw new Error('Browser failed to launch or is not connected');
                }
                
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
                    deviceScaleFactor: 2,
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
                await this.setupPageEventListeners(this.currentPage);
    
                const viewportSize = await this.currentPage.viewportSize();
                if (viewportSize) {
                    this.socket.emit('viewportInfo', {
                        width: viewportSize.width,
                        height: viewportSize.height,
                        userId: this.userId
                    });
                }
    
                try {
                    const blocker = await PlaywrightBlocker.fromLists(fetch, ['https://easylist.to/easylist/easylist.txt']);
                    await blocker.enableBlockingInPage(this.currentPage);
                    this.client = await this.currentPage.context().newCDPSession(this.currentPage);
                    await blocker.disableBlockingInPage(this.currentPage);
                    console.log('Adblocker initialized');
                } catch (error: any) {
                    console.warn('Failed to initialize adblocker, continuing without it:', error.message);
                    // Still need to set up the CDP session even if blocker fails
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

        // this.initializeMemoryManagement();
    };

    public updateViewportInfo = async (): Promise<void> => {
        if (this.currentPage) {
            const viewportSize = await this.currentPage.viewportSize();
            if (viewportSize) {
                this.socket.emit('viewportInfo', {
                    width: viewportSize.width,
                    height: viewportSize.height,
                    userId: this.userId
                });
            }
        }
    };

    /**
     * Registers all event listeners needed for the recording editor session.
     * Should be called only once after the full initialization of the remote browser.
     * @returns void
     */
    public registerEditorEvents = (): void => {
        // For each event, include userId to make sure events are handled for the correct browser
        logger.log('debug', `Registering editor events for user: ${this.userId}`);
        
        // Listen for specific events for this user
        this.socket.on(`rerender:${this.userId}`, async () => {
            logger.debug(`Rerender event received for user ${this.userId}`);
            await this.makeAndEmitScreenshot();
        });
        
        // For backward compatibility, also listen to the general event
        this.socket.on('rerender', async () => {
            logger.debug(`General rerender event received, checking if for user ${this.userId}`);
            await this.makeAndEmitScreenshot();
        });
        
        this.socket.on(`settings:${this.userId}`, (settings) => {
            this.interpreterSettings = settings;
            logger.debug(`Settings updated for user ${this.userId}`);
        });
        
        this.socket.on(`changeTab:${this.userId}`, async (tabIndex) => {
            logger.debug(`Tab change to ${tabIndex} requested for user ${this.userId}`);
            await this.changeTab(tabIndex);
        });
        
        this.socket.on(`addTab:${this.userId}`, async () => {
            logger.debug(`New tab requested for user ${this.userId}`);
            await this.currentPage?.context().newPage();
            const lastTabIndex = this.currentPage ? this.currentPage.context().pages().length - 1 : 0;
            await this.changeTab(lastTabIndex);
        });
        
        this.socket.on(`closeTab:${this.userId}`, async (tabInfo) => {
            logger.debug(`Close tab ${tabInfo.index} requested for user ${this.userId}`);
            const page = this.currentPage?.context().pages()[tabInfo.index];
            if (page) {
                if (tabInfo.isCurrent) {
                    if (this.currentPage?.context().pages()[tabInfo.index + 1]) {
                        // next tab
                        await this.changeTab(tabInfo.index + 1);
                    } else {
                        //previous tab
                        await this.changeTab(tabInfo.index - 1);
                    }
                }
                await page.close();
                logger.log(
                    'debug',
                    `Tab ${tabInfo.index} was closed for user ${this.userId}, new tab count: ${this.currentPage?.context().pages().length}`
                );
            } else {
                logger.log('error', `Tab index ${tabInfo.index} out of range for user ${this.userId}`);
            }
        });
        
        this.socket.on(`setViewportSize:${this.userId}`, async (data: { width: number, height: number }) => {
            const { width, height } = data;
            logger.log('debug', `Viewport size change to width=${width}, height=${height} requested for user ${this.userId}`);

            // Update the browser context's viewport dynamically
            if (this.context && this.browser) {
                this.context = await this.browser.newContext({ viewport: { width, height } });
                logger.log('debug', `Viewport size updated to width=${width}, height=${height} for user ${this.userId}`);
            }
        });
        
        // For backward compatibility, also register the standard events
        this.socket.on('settings', (settings) => this.interpreterSettings = settings);
        this.socket.on('changeTab', async (tabIndex) => await this.changeTab(tabIndex));
        this.socket.on('addTab', async () => {
            await this.currentPage?.context().newPage();
            const lastTabIndex = this.currentPage ? this.currentPage.context().pages().length - 1 : 0;
            await this.changeTab(lastTabIndex);
        });
        this.socket.on('closeTab', async (tabInfo) => {
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
        this.socket.on('setViewportSize', async (data: { width: number, height: number }) => {
            const { width, height } = data;
            if (this.context && this.browser) {
                this.context = await this.browser.newContext({ viewport: { width, height } });
            }
        });
    };
    /**
     * Subscribes the remote browser for a screencast session
     * on [CDP](https://chromedevtools.github.io/devtools-protocol/) level,
     * where screenshot is being sent through the socket
     * every time the browser's active page updates.
     * @returns {Promise<void>}
     */
    public subscribeToScreencast = async (): Promise<void> => {
        logger.log('debug', `Starting screencast for user: ${this.userId}`);
        await this.startScreencast();
        if (!this.client) {
            logger.log('warn', 'client is not initialized');
            return;
        }
        // Set flag to indicate screencast is active
        this.isScreencastActive = true;

        await this.updateViewportInfo();

        this.client.on('Page.screencastFrame', ({ data: base64, sessionId }) => {
            // Only process if screencast is still active for this user
            if (!this.isScreencastActive) {
                return;
            }
            this.emitScreenshot(Buffer.from(base64, 'base64'))
            setTimeout(async () => {
                try {
                    if (!this.client || !this.isScreencastActive) {
                        logger.log('warn', 'client is not initialized');
                        return;
                    }
                    await this.client.send('Page.screencastFrameAck', { sessionId: sessionId });
                } catch (e: any) {
                    logger.log('error', `Screencast error: ${e}`);
                }
            }, 100);
        });
    };

    /**
     * Terminates the screencast session and closes the remote browser.
     * If an interpretation was running it will be stopped.
     * @returns {Promise<void>}
     */
    public async switchOff(): Promise<void> {
        try {
            this.isScreencastActive = false;

            await this.interpreter.stopInterpretation();

            if (this.screencastInterval) {
                clearInterval(this.screencastInterval);
            }

            if (this.client) {
                await this.stopScreencast();
            }

            if (this.browser) {
                await this.browser.close();
            }

            this.screenshotQueue = [];
            //this.performanceMonitor.reset();

        } catch (error) {
            logger.error('Error during browser shutdown:', error);
        }
    }

    private async optimizeScreenshot(screenshot: Buffer): Promise<Buffer> {
        try {
            return await sharp(screenshot)
                .png({
                    quality: Math.round(SCREENCAST_CONFIG.compressionQuality * 100),                
                    compressionLevel: 6,        
                    adaptiveFiltering: true,    
                    force: true                 
                })
                .resize({
                    width: SCREENCAST_CONFIG.maxWidth,
                    height: SCREENCAST_CONFIG.maxHeight,
                    fit: 'inside',
                    withoutEnlargement: true,
                    kernel: 'lanczos3' 
                })
                .toBuffer();
        } catch (error) {
            logger.error('Screenshot optimization failed:', error);            
            return screenshot;
        }
    }
    

    /**
     * Makes and emits a single screenshot to the client side.
     * @returns {Promise<void>}
     */
    public makeAndEmitScreenshot = async (): Promise<void> => {
        try {
            const screenshot = await this.currentPage?.screenshot();
            if (screenshot) {
                this.emitScreenshot(screenshot);
            }
        } catch (e) {
            const { message } = e as Error;
            logger.log('error', `Screenshot error: ${message}`);
        }
    };

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
     * Stops the workflow interpretation and initializes a new page.
     * @returns {Promise<void>}
     */
    public stopCurrentInterpretation = async (): Promise<void> => {
        await this.interpreter.stopInterpretation();
        await this.initializeNewPage();
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
            await this.stopScreencast();
            this.currentPage = page;

            await this.setupPageEventListeners(this.currentPage);

            //await this.currentPage.setViewportSize({ height: 400, width: 900 })
            this.client = await this.currentPage.context().newCDPSession(this.currentPage);
           // Include userId in the URL change event
            this.socket.emit('urlChanged', { 
                url: this.currentPage.url(),
                userId: this.userId
            });
            await this.makeAndEmitScreenshot();
            await this.subscribeToScreencast();
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
        await this.stopScreencast();
        const newPage = options ? await this.browser?.newPage(options)
            : await this.browser?.newPage();
        await newPage?.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
        });

        await this.currentPage?.close();
        this.currentPage = newPage;
        if (this.currentPage) {
            await this.setupPageEventListeners(this.currentPage);

            this.client = await this.currentPage.context().newCDPSession(this.currentPage);
            await this.subscribeToScreencast();
        } else {
            logger.log('error', 'Could not get a new page, returned undefined');
        }
    };

    /**
     * Initiates screencast of the remote browser through socket,
     * registers listener for rerender event and emits the loaded event.
     * Should be called only once after the browser is fully initialized.
     * @returns {Promise<void>}
     */
    private async startScreencast(): Promise<void> {
        if (!this.client) {
            logger.warn('Client is not initialized');
            return;
        }

        try {
            await this.client.send('Page.startScreencast', {
                format: SCREENCAST_CONFIG.format,
                quality: Math.round(SCREENCAST_CONFIG.compressionQuality * 100),
                maxWidth: SCREENCAST_CONFIG.maxWidth,
                maxHeight: SCREENCAST_CONFIG.maxHeight,
                everyNthFrame: 1 
            });
            
            this.isScreencastActive = true;
    
            this.client.on('Page.screencastFrame', async ({ data, sessionId }) => {
                try {
                    if (this.screenshotQueue.length >= SCREENCAST_CONFIG.maxQueueSize && this.isProcessingScreenshot) {
                        await this.client?.send('Page.screencastFrameAck', { sessionId });
                        return;
                    }
                    
                    const buffer = Buffer.from(data, 'base64');
                    this.emitScreenshot(buffer);
                    
                    setTimeout(async () => {
                        try {
                            if (this.client) {
                                await this.client.send('Page.screencastFrameAck', { sessionId });
                            }
                        } catch (e) {
                            logger.error('Error acknowledging screencast frame:', e);
                        }
                    }, 10); 
                } catch (error) {
                    logger.error('Screencast frame processing failed:', error);
                    
                    try {
                        await this.client?.send('Page.screencastFrameAck', { sessionId });
                    } catch (ackError) {
                        logger.error('Failed to acknowledge screencast frame:', ackError);
                    }
                }
            });
            logger.info('Screencast started successfully');
        } catch (error) {
            logger.error('Failed to start screencast:', error);
        }
    }

    private async stopScreencast(): Promise<void> {
        if (!this.client) {
            logger.error('Client is not initialized');
            return;
        }

        try {
            // Set flag to indicate screencast is active
            this.isScreencastActive = false;
            await this.client.send('Page.stopScreencast');
            this.screenshotQueue = [];
            this.isProcessingScreenshot = false;
            logger.info('Screencast stopped successfully');
        } catch (error) {
            logger.error('Failed to stop screencast:', error);
        }
    }


    /**
     * Helper for emitting the screenshot of browser's active page through websocket.
     * @param payload the screenshot binary data
     * @returns void
     */
    private emitScreenshot = async (payload: Buffer, viewportSize?: { width: number, height: number }): Promise<void> => {
        if (this.screenshotQueue.length > SCREENCAST_CONFIG.maxQueueSize) {
            this.screenshotQueue = this.screenshotQueue.slice(-SCREENCAST_CONFIG.maxQueueSize);
        }
        
        if (this.isProcessingScreenshot) {
            if (this.screenshotQueue.length < SCREENCAST_CONFIG.maxQueueSize) {
                this.screenshotQueue.push(payload);
            }
            return;
        }
        
        this.isProcessingScreenshot = true;
        
        try {
            const optimizationPromise = this.optimizeScreenshot(payload);
            const timeoutPromise = new Promise<Buffer>((resolve) => {
                setTimeout(() => resolve(payload), 150);
            });
            
            const optimizedScreenshot = await Promise.race([optimizationPromise, timeoutPromise]);
            const base64Data = optimizedScreenshot.toString('base64');
            const dataWithMimeType = `data:image/${SCREENCAST_CONFIG.format};base64,${base64Data}`;
            
            payload = null as any;
            
            this.socket.emit('screencast', {
                image: dataWithMimeType,
                userId: this.userId,
                viewport: viewportSize || await this.currentPage?.viewportSize() || null
            });
        } catch (error) {
            logger.error('Screenshot emission failed:', error);
            try {
                const base64Data = payload.toString('base64');
                const dataWithMimeType = `data:image/png;base64,${base64Data}`;
                
                this.socket.emit('screencast', {
                    image: dataWithMimeType,
                    userId: this.userId,
                    viewport: viewportSize || await this.currentPage?.viewportSize() || null
                });
            } catch (e) {
                logger.error('Fallback screenshot emission also failed:', e);
            }
        } finally {
            this.isProcessingScreenshot = false;
            
            if (this.screenshotQueue.length > 0) {
                const nextScreenshot = this.screenshotQueue.shift();  
                if (nextScreenshot) {
                    setTimeout(() => {
                        this.emitScreenshot(nextScreenshot);
                    }, 1000 / SCREENCAST_CONFIG.targetFPS);
                }
            }
        }
    };

}
