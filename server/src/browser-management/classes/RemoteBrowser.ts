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

import logger from '../../logger';
import { InterpreterSettings, RemoteBrowserOptions } from "../../types";
import { WorkflowGenerator } from "../../workflow-management/classes/Generator";
import { WorkflowInterpreter } from "../../workflow-management/classes/Interpreter";
import { getDecryptedProxyConfig } from '../../routes/proxy';
chromium.use(stealthPlugin());


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
     * {@link WorkflowGenerator} instance specific to the remote browser.
     */
    public generator: WorkflowGenerator;

    /**
     * {@link WorkflowInterpreter} instance specific to the remote browser.
     */
    public interpreter: WorkflowInterpreter;

    /**
     * Initializes a new instances of the {@link Generator} and {@link WorkflowInterpreter} classes and
     * assigns the socket instance everywhere.
     * @param socket socket.io socket instance used to communicate with the client side
     * @constructor
     */
    public constructor(socket: Socket) {
        this.socket = socket;
        this.interpreter = new WorkflowInterpreter(socket);
        this.generator = new WorkflowGenerator(socket);
    }

    /**
     * An asynchronous constructor for asynchronously initialized properties.
     * Must be called right after creating an instance of RemoteBrowser class.
     * @param options remote browser options to be used when launching the browser
     * @returns {Promise<void>}
     */
    public initialize = async (userId: string): Promise<void> => {
        // const launchOptions = {
        //     headless: true,
        //     proxy: options.launchOptions?.proxy,
        //     chromiumSandbox: false,
        //     args: [
        //         '--no-sandbox',
        //         '--disable-setuid-sandbox',
        //         '--headless=new',
        //         '--disable-gpu',
        //         '--disable-dev-shm-usage',
        //         '--disable-software-rasterizer',
        //         '--in-process-gpu',
        //         '--disable-infobars',
        //         '--single-process', 
        //         '--no-zygote',
        //         '--disable-notifications',
        //         '--disable-extensions',
        //         '--disable-background-timer-throttling',
        //         ...(options.launchOptions?.args || [])
        //     ],
        //     env: {
        //         ...process.env,
        //         CHROMIUM_FLAGS: '--disable-gpu --no-sandbox --headless=new'
        //     }
        // };
        // console.log('Launch options before:', options.launchOptions);
        // this.browser = <Browser>(await options.browser.launch(launchOptions));

        // console.log('Launch options after:', options.launchOptions)
        this.browser = <Browser>(await chromium.launch({
            headless: true,
        }));
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
            viewport: { height: 400, width: 900 },
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
            hasTouch: false
        };

        if (proxyOptions.server) {
            contextOptions.proxy = {
                server: proxyOptions.server,
                username: proxyOptions.username ? proxyOptions.username : undefined,
                password: proxyOptions.password ? proxyOptions.password : undefined,
            };
        }
        const browserUserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.5481.38 Safari/537.36";


        contextOptions.userAgent = browserUserAgent;
        this.context = await this.browser.newContext(contextOptions);
        this.currentPage = await this.context.newPage();

        this.currentPage.on('framenavigated', (frame) => {
            if (frame === this.currentPage?.mainFrame()) {
                this.socket.emit('urlChanged', this.currentPage.url());
            }
        });

        // await this.currentPage.setExtraHTTPHeaders({
        //     'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
        // });
        const blocker = await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch);
        await blocker.enableBlockingInPage(this.currentPage);
        this.client = await this.currentPage.context().newCDPSession(this.currentPage);
        await blocker.disableBlockingInPage(this.currentPage);
    };

    /**
     * Registers all event listeners needed for the recording editor session.
     * Should be called only once after the full initialization of the remote browser.
     * @returns void
     */
    public registerEditorEvents = (): void => {
        this.socket.on('rerender', async () => await this.makeAndEmitScreenshot());
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
                    `${tabInfo.index} page was closed, new length of pages: ${this.currentPage?.context().pages().length}`
                )
            } else {
                logger.log('error', `${tabInfo.index} index out of range of pages`)
            }
        });
        this.socket.on('setViewportSize', async (data: { width: number, height: number }) => {
            const { width, height } = data;
            logger.log('debug', `Received viewport size: width=${width}, height=${height}`);

            // Update the browser context's viewport dynamically
            if (this.context && this.browser) {
                this.context = await this.browser.newContext({ viewport: { width, height } });
                logger.log('debug', `Viewport size updated to width=${width}, height=${height} for the entire browser context`);
            }
        });
    }

    /**
     * Subscribes the remote browser for a screencast session
     * on [CDP](https://chromedevtools.github.io/devtools-protocol/) level,
     * where screenshot is being sent through the socket
     * every time the browser's active page updates.
     * @returns {Promise<void>}
     */
    public subscribeToScreencast = async (): Promise<void> => {
        await this.startScreencast();
        if (!this.client) {
            logger.log('warn', 'client is not initialized');
            return;
        }
        this.client.on('Page.screencastFrame', ({ data: base64, sessionId }) => {
            this.emitScreenshot(base64)
            setTimeout(async () => {
                try {
                    if (!this.client) {
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
    public switchOff = async (): Promise<void> => {
        await this.interpreter.stopInterpretation();
        if (this.browser) {
            await this.stopScreencast();
            await this.browser.close();
        } else {
            logger.log('error', 'Browser wasn\'t initialized');
            logger.log('error', 'Switching off the browser failed');
        }
    };

    /**
     * Makes and emits a single screenshot to the client side.
     * @returns {Promise<void>}
     */
    public makeAndEmitScreenshot = async (): Promise<void> => {
        try {
            const screenshot = await this.currentPage?.screenshot();
            if (screenshot) {
                this.emitScreenshot(screenshot.toString('base64'));
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
                this.currentPage.setViewportSize({ height: 400, width: 900 });
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

            this.currentPage.on('framenavigated', (frame) => {
                if (frame === this.currentPage?.mainFrame()) {
                    this.socket.emit('urlChanged', this.currentPage.url());
                }
            });

            //await this.currentPage.setViewportSize({ height: 400, width: 900 })
            this.client = await this.currentPage.context().newCDPSession(this.currentPage);
            this.socket.emit('urlChanged', this.currentPage.url());
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
            this.currentPage.on('framenavigated', (frame) => {
                if (frame === this.currentPage?.mainFrame()) {
                    this.socket.emit('urlChanged', this.currentPage.url());
                }
            });
            // this.currentPage.on('load', (page) => {
            //     this.socket.emit('urlChanged', page.url());
            // })
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
    private startScreencast = async (): Promise<void> => {
        if (!this.client) {
            logger.log('warn', 'client is not initialized');
            return;
        }
        await this.client.send('Page.startScreencast', { format: 'jpeg', quality: 75 });
        logger.log('info', `Browser started with screencasting a page.`);
    };

    /**
     * Unsubscribes the current page from the screencast session.
     * @returns {Promise<void>}
     */
    private stopScreencast = async (): Promise<void> => {
        if (!this.client) {
            logger.log('error', 'client is not initialized');
            logger.log('error', 'Screencast stop failed');
        } else {
            await this.client.send('Page.stopScreencast');
            logger.log('info', `Browser stopped with screencasting.`);
        }
    };

    /**
     * Helper for emitting the screenshot of browser's active page through websocket.
     * @param payload the screenshot binary data
     * @returns void
     */
    private emitScreenshot = (payload: any): void => {
        const dataWithMimeType = ('data:image/jpeg;base64,').concat(payload);
        this.socket.emit('screencast', dataWithMimeType);
        logger.log('debug', `Screenshot emitted`);
    };
}
