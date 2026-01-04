/* eslint-disable no-await-in-loop, no-restricted-syntax */
import { ElementHandle, Page, PageScreenshotOptions } from 'playwright-core';
import fetch from 'cross-fetch';
import path from 'path';

import { EventEmitter } from 'events';
import {
  Where, What, PageState, Workflow, WorkflowFile,
  ParamType, SelectorArray, CustomFunctions,
} from './types/workflow';

import { operators, meta } from './types/logic';
import { arrayToObject } from './utils/utils';
import Concurrency from './utils/concurrency';
import Preprocessor from './preprocessor';
import log, { Level } from './utils/logger';

/**
 * Extending the Window interface for custom scraping functions.
 */
declare global {
  interface Window {
    scrape: (selector: string | null) => Record<string, string>[];
    scrapeSchema: (
      schema: Record<string, { selector: string; tag: string; attribute: string }>
    ) => Record<string, any>;
    scrapeList: (config: { listSelector: string; fields: any; limit?: number; pagination: any }) => Record<string, any>[];
    scrapeListAuto: (listSelector: string) => { selector: string; innerText: string }[];
    scrollDown: (pages?: number) => void;
    scrollUp: (pages?: number) => void;
  }
}


/**
 * Defines optional intepreter options (passed in constructor)
 */
interface InterpreterOptions {
  mode?: string;
  maxRepeats: number;
  maxConcurrency: number;
  serializableCallback: (output: any) => (void | Promise<void>);
  binaryCallback: (output: any, mimeType: string) => (void | Promise<void>);
  debug: boolean;
  debugChannel: Partial<{
    activeId: (id: number) => void,
    debugMessage: (msg: string) => void,
    setActionType: (type: string) => void,
    incrementScrapeListIndex: () => void,
    progressUpdate: (current: number, total: number, percentage: number) => void,
  }>
}

/**
 * Class for running the Smart Workflows.
 */
export default class Interpreter extends EventEmitter {
  private workflow: Workflow;

  private initializedWorkflow: Workflow | null;

  private options: InterpreterOptions;

  private concurrency: Concurrency;

  private stopper: Function | null = null;
  
  private isAborted: boolean = false;

  private log: typeof log;

  // private blocker: PlaywrightBlocker | null = null;

  private cumulativeResults: Record<string, any>[] = [];

  private namedResults: Record<string, Record<string, any>> = {};

  private screenshotCounter: number = 0;

  private serializableDataByType: Record<string, Record<string, any>> = {
    scrapeList: {},
    scrapeSchema: {},
    crawl: {},
    search: {}
  };

  private scrapeListCounter: number = 0;

  private totalActions: number = 0;

  private executedActions: number = 0;

  constructor(workflow: WorkflowFile, options?: Partial<InterpreterOptions>) {
    super();
    this.workflow = workflow.workflow;
    this.initializedWorkflow = null;
    this.options = {
      maxRepeats: 5,
      maxConcurrency: 5,
      serializableCallback: (data) => { 
        log(JSON.stringify(data), Level.WARN);
      },
      binaryCallback: () => { log('Received binary data, thrashing them.', Level.WARN); },
      debug: false,
      debugChannel: {},
      ...options,
    };
    this.concurrency = new Concurrency(this.options.maxConcurrency);
    this.log = (...args) => log(...args);

    const error = Preprocessor.validateWorkflow(workflow);
    if (error) {
      throw (error);
    }

    if (this.options.debugChannel?.debugMessage) {
      const oldLog = this.log;
      // @ts-ignore
      this.log = (...args: Parameters<typeof oldLog>) => {
        if (args[1] !== Level.LOG) {
          this.options.debugChannel.debugMessage!(typeof args[0] === 'string' ? args[0] : args[0].message);
        }
        oldLog(...args);
      };
    }

    // PlaywrightBlocker.fromLists(fetch, ['https://easylist.to/easylist/easylist.txt']).then(blocker => {
    //   this.blocker = blocker;
    // }).catch(err => {
    //   this.log(`Failed to initialize ad-blocker: ${err.message}`, Level.ERROR);
    //   // Continue without ad-blocker rather than crashing
    //   this.blocker = null;
    // })
  }

  /**
   * Sets the abort flag to immediately stop all operations
   */
  public abort(): void {
    this.isAborted = true;
  }

  /**
   * Returns the current abort status
   */
  public getIsAborted(): boolean {
    return this.isAborted;
  }

  // private getSelectors(workflow: Workflow, actionId: number): string[] {
  //   const selectors: string[] = [];

  //   // Validate actionId
  //   if (actionId <= 0) {
  //       console.log("No previous selectors to collect.");
  //       return selectors; // Empty array as there are no previous steps
  //   }

  //   // Iterate from the start up to (but not including) actionId
  //   for (let index = 0; index < actionId; index++) {
  //       const currentSelectors = workflow[index]?.where?.selectors;
  //       console.log(`Selectors at step ${index}:`, currentSelectors);

  //       if (currentSelectors && currentSelectors.length > 0) {
  //           currentSelectors.forEach((selector) => {
  //               if (!selectors.includes(selector)) {
  //                   selectors.push(selector); // Avoid duplicates
  //               }
  //           });
  //       }
  //   }

  //   console.log("Collected Selectors:", selectors);
  //   return selectors;
  // }

  private getSelectors(workflow: Workflow): string[] {
    const selectorsSet = new Set<string>();

    if (workflow.length === 0) {
        return [];
    }

    for (let index = workflow.length - 1; index >= 0; index--) {
        const currentSelectors = workflow[index]?.where?.selectors;

        if (currentSelectors && currentSelectors.length > 0) {
            currentSelectors.forEach((selector) => selectorsSet.add(selector));
            return Array.from(selectorsSet);
        }
    }

    return [];
  }


  /**
    * Returns the context object from given Page and the current workflow.\
    * \
    * `workflow` is used for selector extraction - function searches for used selectors to
    * look for later in the page's context.
    * @param page Playwright Page object
    * @param workflow Current **initialized** workflow (array of where-what pairs).
    * @returns {PageState} State of the current page.
    */
  private async getState(page: Page, workflowCopy: Workflow, selectors: string[]): Promise<PageState> {
    /**
     * All the selectors present in the current Workflow
     */
    // const selectors = Preprocessor.extractSelectors(workflow);
    // console.log("Current selectors:", selectors);

    /**
      * Determines whether the element targetted by the selector is [actionable](https://playwright.dev/docs/actionability).
      * @param selector Selector to be queried
      * @returns True if the targetted element is actionable, false otherwise.
      */
    // const actionable = async (selector: string): Promise<boolean> => {
    //   try {
    //     const proms = [
    //       page.isEnabled(selector, { timeout: 10000 }),
    //       page.isVisible(selector, { timeout: 10000 }),
    //     ];

    //     return await Promise.all(proms).then((bools) => bools.every((x) => x));
    //   } catch (e) {
    //     // log(<Error>e, Level.ERROR);
    //     return false;
    //   }
    // };

    /**
      * Object of selectors present in the current page.
      */
    // const presentSelectors: SelectorArray = await Promise.all(
    //   selectors.map(async (selector) => {
    //     if (await actionable(selector)) {
    //       return [selector];
    //     }
    //     return [];
    //   }),
    // ).then((x) => x.flat());

    const presentSelectors: SelectorArray = await Promise.all(
        selectors.map(async (selector) => {
            try {
                await page.waitForSelector(selector, { state: 'attached' });
                return [selector];
            } catch (e) {
                return [];
            }
        }),
    ).then((x) => x.flat());
    
    const action = workflowCopy[workflowCopy.length - 1];

    // console.log("Next action:", action)

    let url: any = page.url();

    if (action && action.where.url !== url && action.where.url !== "about:blank") {
      url = action.where.url;
    }

    return {
      url,
      cookies: (await page.context().cookies([page.url()]))
        .reduce((p, cookie) => (
          {
            ...p,
            [cookie.name]: cookie.value,
          }), {}),
      selectors: presentSelectors,
    };
  }

  /**
   * Tests if the given action is applicable with the given context.
   * @param where Tested *where* condition
   * @param context Current browser context.
   * @returns True if `where` is applicable in the given context, false otherwise
   */
  private applicable(where: Where, context: PageState, usedActions: string[] = []): boolean {
    /**
     * Given two arbitrary objects, determines whether `subset` is a subset of `superset`.\
     * \
     * For every key in `subset`, there must be a corresponding key with equal scalar
     * value in `superset`, or `inclusive(subset[key], superset[key])` must hold.
     * @param subset Arbitrary non-cyclic JS object (where clause)
     * @param superset Arbitrary non-cyclic JS object (browser context)
     * @returns `true` if `subset <= superset`, `false` otherwise.
     */
    const inclusive = (subset: Record<string, unknown>, superset: Record<string, unknown>)
      : boolean => (
      Object.entries(subset).every(
        ([key, value]) => {
          /**
           * Arrays are compared without order (are transformed into objects before comparison).
           */
          const parsedValue = Array.isArray(value) ? arrayToObject(value) : value;

          const parsedSuperset: Record<string, unknown> = {};
          parsedSuperset[key] = Array.isArray(superset[key])
            ? arrayToObject(<any>superset[key])
            : superset[key];

          if ((key === 'url' || key === 'selectors') && 
            Array.isArray(value) && Array.isArray(superset[key]) && 
            value.length === 0 && (superset[key] as any[]).length === 0) {
            return true;
          }

          if (key === 'selectors' && Array.isArray(value) && Array.isArray(superset[key])) {
            return value.some(selector => 
              (superset[key] as any[]).includes(selector)
            );
          }

          // Every `subset` key must exist in the `superset` and
          // have the same value (strict equality), or subset[key] <= superset[key]
          return parsedSuperset[key]
            && (
              (parsedSuperset[key] === parsedValue)
              || ((parsedValue).constructor.name === 'RegExp' && (<RegExp>parsedValue).test(<string>parsedSuperset[key]))
              || (
                (parsedValue).constructor.name !== 'RegExp'
                && typeof parsedValue === 'object' && inclusive(<typeof subset>parsedValue, <typeof superset>parsedSuperset[key])
              )
            );
        },
      )
    );

    // Every value in the "where" object should be compliant to the current state.
    return Object.entries(where).every(
      ([key, value]) => {
        if (operators.includes(<any>key)) {
          const array = Array.isArray(value)
            ? value as Where[]
            : Object.entries(value).map((a) => Object.fromEntries([a]));
          // every condition is treated as a single context

          switch (key as keyof typeof operators) {
            case '$and' as keyof typeof operators:
              return array?.every((x) => this.applicable(x, context));
            case '$or' as keyof typeof operators:
              return array?.some((x) => this.applicable(x, context));
            case '$not' as keyof typeof operators:
              return !this.applicable(<Where>value, context); // $not should be a unary operator
            default:
              throw new Error('Undefined logic operator.');
          }
        } else if (meta.includes(<any>key)) {
          const testRegexString = (x: string) => {
            if (typeof value === 'string') {
              return x === value;
            }

            return (<RegExp><unknown>value).test(x);
          };

          switch (key as keyof typeof meta) {
            case '$before' as keyof typeof meta:
              return !usedActions.find(testRegexString);
            case '$after' as keyof typeof meta:
              return !!usedActions.find(testRegexString);
            default:
              throw new Error('Undefined meta operator.');
          }
        } else {
          // Current key is a base condition (url, cookies, selectors)
          return inclusive({ [key]: value }, context);
        }
      },
    );
  }

  /**
 * Given a Playwright's page object and a "declarative" list of actions, this function
 * calls all mentioned functions on the Page object.\
 * \
 * Manipulates the iterator indexes (experimental feature, likely to be removed in
 * the following versions of maxun-core)
 * @param page Playwright Page object
 * @param steps Array of actions.
 */
  private async carryOutSteps(page: Page, steps: What[]): Promise<void> {
    if (this.isAborted) {
      this.log('Workflow aborted, stopping execution', Level.WARN);
      return;
    }

    /**
     * Defines overloaded (or added) methods/actions usable in the workflow.
     * If a method overloads any existing method of the Page class, it accepts the same set
     * of parameters *(but can override some!)*\
     * \
     * Also, following piece of code defines functions to be run in the browser's context.
     * Beware of false linter errors - here, we know better!
     */
    const wawActions: Record<CustomFunctions, (...args: any[]) => void> = {
      screenshot: async (
        params: PageScreenshotOptions,
        nameOverride?: string
      ) => {
        if (this.options.debugChannel?.setActionType) {
          this.options.debugChannel.setActionType("screenshot");
        }

        const screenshotBuffer = await page.screenshot({
          ...params,
          path: undefined,
        });

        const explicitName = (typeof nameOverride === 'string' && nameOverride.trim().length > 0) ? nameOverride.trim() : null;
        let screenshotName: string;

        if (explicitName) {
          screenshotName = explicitName;
        } else {
          this.screenshotCounter += 1;
          screenshotName = `Screenshot ${this.screenshotCounter}`;
        }

        await this.options.binaryCallback(
          {
            name: screenshotName,
            data: screenshotBuffer,
            mimeType: "image/png",
          },
          "image/png"
        );
      },
      enqueueLinks: async (selector: string) => {
        if (this.options.debugChannel?.setActionType) {
          this.options.debugChannel.setActionType('enqueueLinks');
        }

        const links: string[] = await page.locator(selector)
          .evaluateAll(
            // @ts-ignore
            (elements) => elements.map((a) => a.href).filter((x) => x),
          );
        const context = page.context();

        for (const link of links) {
          // eslint-disable-next-line
          this.concurrency.addJob(async () => {
            let newPage = null;
            try {
              newPage = await context.newPage();
              await newPage.goto(link);
              await newPage.waitForLoadState('networkidle');
              await this.runLoop(newPage, this.initializedWorkflow!);
            } catch (e) {
              // `runLoop` uses soft mode, so it recovers from it's own exceptions
              // but newPage(), goto() and waitForLoadState() don't (and will kill
              // the interpreter by throwing).
              this.log(<Error>e, Level.ERROR);
            } finally {
              if (newPage && !newPage.isClosed()) {
                try {
                  await newPage.close();
                } catch (closeError) {
                  this.log('Failed to close enqueued page', Level.WARN);
                }
              }
            }
          });
        }
        await page.close();
      },
      scrape: async (selector?: string) => {
        if (this.options.debugChannel?.setActionType) {
          this.options.debugChannel.setActionType('scrape');
        }

        await this.ensureScriptsLoaded(page);

        const scrapeResults: Record<string, string>[] = await page.evaluate((s) => window.scrape(s ?? null), selector);
        await this.options.serializableCallback(scrapeResults);
      },

      scrapeSchema: async (schema: Record<string, { selector: string; tag: string, attribute: string; shadow: string}>, actionName: string = "") => {
        if (this.isAborted) {
          this.log('Workflow aborted, stopping scrapeSchema', Level.WARN);
          return;
        }

        if (this.options.debugChannel?.setActionType) {
          this.options.debugChannel.setActionType('scrapeSchema');
        }

        if (this.options.mode && this.options.mode === 'editor') {
          await this.options.serializableCallback({});
          return;
        }
      
        await this.ensureScriptsLoaded(page);
      
        const scrapeResult = await page.evaluate((schemaObj) => window.scrapeSchema(schemaObj), schema);
      
        if (!this.cumulativeResults || !Array.isArray(this.cumulativeResults)) {
          this.cumulativeResults = [];
        }
      
        const resultToProcess = Array.isArray(scrapeResult) ? scrapeResult[0] : scrapeResult;
        
        if (this.cumulativeResults.length === 0) {
          const newRow = {};
          Object.entries(resultToProcess).forEach(([key, value]) => {
            if (value !== undefined) {
              newRow[key] = value;
            }
          });
          this.cumulativeResults.push(newRow);
        } else {
          const lastRow = this.cumulativeResults[this.cumulativeResults.length - 1];
          const newResultKeys = Object.keys(resultToProcess).filter(key => resultToProcess[key] !== undefined);
          const hasRepeatedKeys = newResultKeys.some(key => lastRow.hasOwnProperty(key));
          
          if (hasRepeatedKeys) {
            const newRow = {};
            Object.entries(resultToProcess).forEach(([key, value]) => {
              if (value !== undefined) {
                newRow[key] = value;
              }
            });
            this.cumulativeResults.push(newRow);
          } else {
            Object.entries(resultToProcess).forEach(([key, value]) => {
              if (value !== undefined) {
                lastRow[key] = value;
              }
            });
          }
        }
      
        const actionType = "scrapeSchema";
        const name = actionName || "Texts";

        if (!this.namedResults[actionType]) this.namedResults[actionType] = {};
        this.namedResults[actionType][name] = this.cumulativeResults;

        if (!this.serializableDataByType[actionType]) this.serializableDataByType[actionType] = {};
        if (!this.serializableDataByType[actionType][name]) {
          this.serializableDataByType[actionType][name] = [];
        }

        this.serializableDataByType[actionType][name] = [...this.cumulativeResults];

        await this.options.serializableCallback({
          scrapeList: this.serializableDataByType.scrapeList,
          scrapeSchema: this.serializableDataByType.scrapeSchema,
          crawl: this.serializableDataByType.crawl || {},
          search: this.serializableDataByType.search || {}
        });
      },

      scrapeList: async (config: { listSelector: string, fields: any, limit?: number, pagination: any }, actionName: string = "") => {
        if (this.isAborted) {
          this.log('Workflow aborted, stopping scrapeList', Level.WARN);
          return;
        }

        if (this.options.debugChannel?.setActionType) {
          this.options.debugChannel.setActionType('scrapeList');
        }

        if (this.options.mode && this.options.mode === 'editor') {
          await this.options.serializableCallback({});
          return;
        }

        try {
          await this.ensureScriptsLoaded(page);

          if (this.options.debugChannel?.incrementScrapeListIndex) {
            this.options.debugChannel.incrementScrapeListIndex();
          }

          let scrapeResults = [];
          let paginationUsed = false;

          if (!config.pagination) {
            scrapeResults = await page.evaluate((cfg) => {
              try {
                return window.scrapeList(cfg);
              } catch (error) {
                console.warn('ScrapeList evaluation failed:', error.message);
                return [];
              }
            }, config);
          } else {
            paginationUsed = true;
            scrapeResults = await this.handlePagination(page, config, actionName);
          }

          if (!Array.isArray(scrapeResults)) {
            scrapeResults = [];
          }

          console.log(`ScrapeList completed with ${scrapeResults.length} results`);

          if (!paginationUsed) {
            const actionType = "scrapeList";
            let name = actionName || "";

            if (!name || name.trim() === "") {
              this.scrapeListCounter++;
              name = `List ${this.scrapeListCounter}`;
            }

            if (!this.serializableDataByType[actionType]) this.serializableDataByType[actionType] = {};
            if (!this.serializableDataByType[actionType][name]) {
              this.serializableDataByType[actionType][name] = [];
            }

            this.serializableDataByType[actionType][name].push(...scrapeResults);

            await this.options.serializableCallback({
              scrapeList: this.serializableDataByType.scrapeList,
              scrapeSchema: this.serializableDataByType.scrapeSchema
            });
          }
        } catch (error) {
          console.error('ScrapeList action failed completely:', error.message);

          const actionType = "scrapeList";
          let name = actionName || "";

          if (!name || name.trim() === "") {
            this.scrapeListCounter++;
            name = `List ${this.scrapeListCounter}`;
          }

          if (!this.namedResults[actionType]) this.namedResults[actionType] = {};
          this.namedResults[actionType][name] = [];

          if (!this.serializableDataByType[actionType]) this.serializableDataByType[actionType] = {};
          this.serializableDataByType[actionType][name] = [];

          await this.options.serializableCallback({
            scrapeList: this.serializableDataByType.scrapeList,
            scrapeSchema: this.serializableDataByType.scrapeSchema
          });
        }
      },

      scrapeListAuto: async (config: { listSelector: string }) => {
        if (this.options.debugChannel?.setActionType) {
          this.options.debugChannel.setActionType('scrapeListAuto');
        }

        await this.ensureScriptsLoaded(page);

        const scrapeResults: { selector: string, innerText: string }[] = await page.evaluate((listSelector) => {
          return window.scrapeListAuto(listSelector);
        }, config.listSelector);

        await this.options.serializableCallback(scrapeResults);
      },

      scroll: async (pages?: number) => {
        if (this.options.debugChannel?.setActionType) {
          this.options.debugChannel.setActionType('scroll');
        }

        await page.evaluate(async (pagesInternal) => {
          for (let i = 1; i <= (pagesInternal ?? 1); i += 1) {
            // @ts-ignore
            window.scrollTo(0, window.scrollY + window.innerHeight);
          }
        }, pages ?? 1);
      },

      script: async (code: string) => {
        if (this.options.debugChannel?.setActionType) {
          this.options.debugChannel.setActionType('script');
        }

        try {
          const AsyncFunction: FunctionConstructor = Object.getPrototypeOf(
            async () => { },
          ).constructor;
          const x = new AsyncFunction('page', 'log', code);
          await x(page, this.log);
        } catch (error) {
          this.log(`Script execution failed: ${error.message}`, Level.ERROR);
          throw new Error(`Script execution error: ${error.message}`);
        }
      },

      crawl: async (crawlConfig: {
        mode: 'domain' | 'subdomain' | 'path';
        limit: number;
        maxDepth: number;
        includePaths: string[];
        excludePaths: string[];
        useSitemap: boolean;
        followLinks: boolean;
        respectRobots: boolean;
      }) => {
        if (this.isAborted) {
          this.log('Workflow aborted, stopping crawl', Level.WARN);
          return;
        }


        if (this.options.debugChannel?.setActionType) {
          this.options.debugChannel.setActionType('crawl');
        }

        this.log('Starting crawl operation', Level.LOG);

        try {
          const currentUrl = page.url();
          this.log(`Current page URL: ${currentUrl}`, Level.LOG);

          if (!currentUrl || currentUrl === 'about:blank' || currentUrl === '') {
            this.log('Page not yet navigated, waiting for navigation...', Level.WARN);
            await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
          }

          const baseUrl = page.url();
          this.log(`Using base URL for crawl: ${baseUrl}`, Level.LOG);

          const parsedBase = new URL(baseUrl);
          const baseDomain = parsedBase.hostname;

          let discoveredUrls: string[] = [];

          if (crawlConfig.useSitemap) {
            this.log('Fetching sitemap URLs...', Level.LOG);
            try {
              const sitemapUrl = `${parsedBase.protocol}//${parsedBase.host}/sitemap.xml`;

              const sitemapUrls = await page.evaluate((url) => {
                return new Promise<string[]>((resolve) => {
                  const xhr = new XMLHttpRequest();
                  xhr.open('GET', url, true);
                  xhr.onload = function() {
                    if (xhr.status === 200) {
                      const text = xhr.responseText;
                      const locMatches = text.match(/<loc>(.*?)<\/loc>/g) || [];
                      const urls = locMatches.map(match => match.replace(/<\/?loc>/g, ''));
                      resolve(urls);
                    } else {
                      resolve([]);
                    }
                  };
                  xhr.onerror = function() {
                    resolve([]);
                  };
                  xhr.send();
                });
              }, sitemapUrl);

              if (sitemapUrls.length > 0) {
                const nestedSitemaps = sitemapUrls.filter(url =>
                  url.endsWith('/sitemap') || url.endsWith('sitemap.xml') || url.includes('/sitemap/')
                );
                const regularUrls = sitemapUrls.filter(url =>
                  !url.endsWith('/sitemap') && !url.endsWith('sitemap.xml') && !url.includes('/sitemap/')
                );

                discoveredUrls.push(...regularUrls);
                this.log(`Found ${regularUrls.length} regular URLs from main sitemap`, Level.LOG);

                for (const nestedUrl of nestedSitemaps.slice(0, 10)) {
                  try {
                    this.log(`Fetching nested sitemap: ${nestedUrl}`, Level.LOG);
                    const nestedUrls = await page.evaluate((url) => {
                      return new Promise<string[]>((resolve) => {
                        const xhr = new XMLHttpRequest();
                        xhr.open('GET', url, true);
                        xhr.onload = function() {
                          if (xhr.status === 200) {
                            const text = xhr.responseText;
                            const locMatches = text.match(/<loc>(.*?)<\/loc>/g) || [];
                            const urls = locMatches.map(match => match.replace(/<\/?loc>/g, ''));
                            resolve(urls);
                          } else {
                            resolve([]);
                          }
                        };
                        xhr.onerror = function() {
                          resolve([]);
                        };
                        xhr.send();
                      });
                    }, nestedUrl);

                    if (nestedUrls.length > 0) {
                      discoveredUrls.push(...nestedUrls);
                      this.log(`Found ${nestedUrls.length} URLs from nested sitemap ${nestedUrl}`, Level.LOG);
                    }
                  } catch (error) {
                    this.log(`Failed to fetch nested sitemap ${nestedUrl}: ${error.message}`, Level.WARN);
                  }
                }

                this.log(`Total URLs from all sitemaps: ${discoveredUrls.length}`, Level.LOG);
              } else {
                this.log('No URLs found in sitemap or sitemap not available', Level.WARN);
              }
            } catch (error) {
              this.log(`Sitemap fetch failed: ${error.message}`, Level.WARN);
            }
          }

          if (crawlConfig.followLinks) {
            this.log('Extracting links from current page...', Level.LOG);
            try {
              await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});

              await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
                this.log('Network did not become idle, continuing anyway', Level.WARN);
              });

              await new Promise(resolve => setTimeout(resolve, 5000));

              const anchorCount = await page.evaluate(() => {
                return document.querySelectorAll('a').length;
              });
              this.log(`Page has ${anchorCount} total anchor tags`, Level.LOG);

              const pageLinks = await page.evaluate(() => {
                const links: string[] = [];
                const allAnchors = document.querySelectorAll('a');
                console.log('Total anchors found:', allAnchors.length);

                for (let i = 0; i < allAnchors.length; i++) {
                  const anchor = allAnchors[i] as HTMLAnchorElement;
                  const href = anchor.getAttribute('href');
                  const fullHref = anchor.href;

                  if (fullHref && (fullHref.startsWith('http://') || fullHref.startsWith('https://'))) {
                    links.push(fullHref);
                  }
                }

                console.log('Links extracted:', links.length);
                return links;
              });

              discoveredUrls.push(...pageLinks);
              this.log(`Found ${pageLinks.length} links from page`, Level.LOG);
            } catch (error) {
              this.log(`Link extraction failed: ${error.message}`, Level.WARN);
            }
          }

          const filteredUrls = discoveredUrls.filter(url => {
            try {
              const urlObj = new URL(url);

              if (crawlConfig.mode === 'domain') {
                if (urlObj.hostname !== baseDomain) return false;
              } else if (crawlConfig.mode === 'subdomain') {
                if (!urlObj.hostname.endsWith(baseDomain) && urlObj.hostname !== baseDomain) return false;
              } else if (crawlConfig.mode === 'path') {
                if (urlObj.hostname !== baseDomain || !urlObj.pathname.startsWith(parsedBase.pathname)) return false;
              }

              if (crawlConfig.includePaths && crawlConfig.includePaths.length > 0) {
                const matches = crawlConfig.includePaths.some(pattern => {
                  const regex = new RegExp(pattern);
                  return regex.test(url);
                });
                if (!matches) return false;
              }

              if (crawlConfig.excludePaths && crawlConfig.excludePaths.length > 0) {
                const matches = crawlConfig.excludePaths.some(pattern => {
                  const regex = new RegExp(pattern);
                  return regex.test(url);
                });
                if (matches) return false;
              }

              return true;
            } catch (error) {
              return false;
            }
          });

          const uniqueUrls = Array.from(new Set(filteredUrls.map(url => {
            return url.replace(/#.*$/, '').replace(/\/$/, '');
          })));

          const basePathname = parsedBase.pathname;
          const prioritizedUrls = uniqueUrls.sort((a, b) => {
            try {
              const aUrl = new URL(a);
              const bUrl = new URL(b);
              const aMatchesBase = aUrl.pathname.startsWith(basePathname);
              const bMatchesBase = bUrl.pathname.startsWith(basePathname);

              if (aMatchesBase && !bMatchesBase) return -1;
              if (!aMatchesBase && bMatchesBase) return 1;

              return 0;
            } catch (error) {
              return 0;
            }
          });

          const finalUrls = prioritizedUrls.slice(0, crawlConfig.limit);

          this.log(`Crawl discovered ${finalUrls.length} URLs (from ${discoveredUrls.length} total)`, Level.LOG);

          this.log(`Starting to scrape content from ${finalUrls.length} discovered URLs...`, Level.LOG);
          const crawlResults = [];

          for (let i = 0; i < finalUrls.length; i++) {
            const url = finalUrls[i];
            try {
              this.log(`[${i + 1}/${finalUrls.length}] Scraping: ${url}`, Level.LOG);

              await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
              }).catch(() => {
                this.log(`Failed to navigate to ${url}, skipping...`, Level.WARN);
              });

              await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});

              const pageData = await page.evaluate(() => {
                const getMeta = (name: string) => {
                  const meta = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
                  return meta?.getAttribute('content') || '';
                };

                const getAllMeta = () => {
                  const metadata: Record<string, string> = {};
                  const metaTags = document.querySelectorAll('meta');
                  metaTags.forEach(tag => {
                    const name = tag.getAttribute('name') || tag.getAttribute('property');
                    const content = tag.getAttribute('content');
                    if (name && content) {
                      metadata[name] = content;
                    }
                  });
                  return metadata;
                };

                const title = document.title || '';
                const bodyText = document.body?.innerText || '';

                const elementsWithMxId = document.querySelectorAll('[data-mx-id]');
                elementsWithMxId.forEach(el => el.removeAttribute('data-mx-id'));

                const html = document.documentElement.outerHTML;
                const links = Array.from(document.querySelectorAll('a')).map(a => a.href);
                const allMetadata = getAllMeta();

                return {
                  title,
                  description: getMeta('description'),
                  text: bodyText,
                  html: html,
                  links: links,
                  wordCount: bodyText.split(/\s+/).filter(w => w.length > 0).length,
                  metadata: {
                    ...allMetadata,
                    title,
                    language: document.documentElement.lang || '',
                    favicon: (document.querySelector('link[rel="icon"], link[rel="shortcut icon"]') as HTMLLinkElement)?.href || '',
                    statusCode: 200
                  }
                };
              });

              crawlResults.push({
                metadata: {
                  ...pageData.metadata,
                  url: url,
                  sourceURL: url
                },
                html: pageData.html,
                text: pageData.text,
                links: pageData.links,
                wordCount: pageData.wordCount,
                scrapedAt: new Date().toISOString()
              });

              this.log(`✓ Scraped ${url} (${pageData.wordCount} words)`, Level.LOG);

            } catch (error) {
              this.log(`Failed to scrape ${url}: ${error.message}`, Level.WARN);
              crawlResults.push({
                url: url,
                error: error.message,
                scrapedAt: new Date().toISOString()
              });
            }
          }

          this.log(`Successfully scraped ${crawlResults.length} pages`, Level.LOG);

          const actionType = "crawl";
          const actionName = "Crawl Results";

          if (!this.serializableDataByType[actionType]) {
            this.serializableDataByType[actionType] = {};
          }
          if (!this.serializableDataByType[actionType][actionName]) {
            this.serializableDataByType[actionType][actionName] = [];
          }

          this.serializableDataByType[actionType][actionName] = crawlResults;

          await this.options.serializableCallback({
            scrapeList: this.serializableDataByType.scrapeList || {},
            scrapeSchema: this.serializableDataByType.scrapeSchema || {},
            crawl: this.serializableDataByType.crawl || {},
            search: this.serializableDataByType.search || {}
          });

        } catch (error) {
          this.log(`Crawl action failed: ${error.message}`, Level.ERROR);
          throw new Error(`Crawl execution error: ${error.message}`);
        }
      },

      search: async (searchConfig: {
        query: string;
        limit: number;
        provider?: 'duckduckgo';
        filters?: {
          timeRange?: 'day' | 'week' | 'month' | 'year';
          location?: string;
          lang?: string;
        };
        mode: 'discover' | 'scrape';
      }) => {
        if (this.isAborted) {
          this.log('Workflow aborted, stopping search', Level.WARN);
          return;
        }

        if (this.options.debugChannel?.setActionType) {
          this.options.debugChannel.setActionType('search');
        }

        searchConfig.provider = 'duckduckgo';

        this.log(`Performing DuckDuckGo search for: ${searchConfig.query}`, Level.LOG);

        try {
          let searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(searchConfig.query)}`;

          if (searchConfig.filters?.timeRange) {
            const timeMap: Record<string, string> = {
              'day': 'd',
              'week': 'w',
              'month': 'm',
              'year': 'y'
            };
            searchUrl += `&df=${timeMap[searchConfig.filters.timeRange]}`;
          }

          const initialDelay = 500 + Math.random() * 1000;
          await new Promise(resolve => setTimeout(resolve, initialDelay));

          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

          await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {
            this.log('Load state timeout, continuing anyway', Level.WARN);
          });

          const pageLoadDelay = 2000 + Math.random() * 1500;
          await new Promise(resolve => setTimeout(resolve, pageLoadDelay));

          let searchResults: any[] = [];
          let retryCount = 0;
          const maxRetries = 2;

          while (searchResults.length === 0 && retryCount <= maxRetries) {
            if (retryCount > 0) {
              this.log(`Retry attempt ${retryCount}/${maxRetries} for DuckDuckGo search...`, Level.LOG);
              const retryDelay = 1000 * Math.pow(2, retryCount) + Math.random() * 1000;
              await new Promise(resolve => setTimeout(resolve, retryDelay));
            }

            this.log('Attempting to extract DuckDuckGo search results...', Level.LOG);

            await page.waitForSelector('[data-testid="result"], .result', { timeout: 5000 }).catch(() => {
              this.log('DuckDuckGo results not found on initial wait', Level.WARN);
            });

            let currentResultCount = 0;
            const maxLoadAttempts = Math.ceil(searchConfig.limit / 10) * 2;
            let loadAttempts = 0;
            let noNewResultsCount = 0;

            while (currentResultCount < searchConfig.limit && loadAttempts < maxLoadAttempts && noNewResultsCount < 3) {
              const previousCount = currentResultCount;

              currentResultCount = await page.evaluate(() => {
                const selectors = [
                  '[data-testid="result"]',
                  'article[data-testid="result"]',
                  'li[data-layout="organic"]',
                  '.result',
                  'article[data-testid]'
                ];

                for (const selector of selectors) {
                  const elements = document.querySelectorAll(selector);
                  if (elements.length > 0) {
                    return elements.length;
                  }
                }
                return 0;
              });

              if (currentResultCount >= searchConfig.limit) {
                this.log(`Reached desired result count: ${currentResultCount}`, Level.LOG);
                break;
              }

              if (currentResultCount === previousCount) {
                noNewResultsCount++;
                this.log(`No new results after load more (attempt ${noNewResultsCount}/3)`, Level.WARN);
                if (noNewResultsCount >= 3) break;
              } else {
                noNewResultsCount = 0;
                this.log(`Current results count: ${currentResultCount}/${searchConfig.limit}`, Level.LOG);
              }

              await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
              });

              await new Promise(resolve => setTimeout(resolve, 800));

              const loadMoreClicked = await page.evaluate(() => {
                const selectors = [
                  '#more-results',
                  'button:has-text("More results")',
                  'button:has-text("more results")',
                  'button[id*="more"]',
                  'button:has-text("Load more")'
                ];

                for (const selector of selectors) {
                  try {
                    const button = document.querySelector(selector) as HTMLButtonElement;
                    if (button && button.offsetParent !== null) {
                      button.click();
                      console.log(`Clicked load more button with selector: ${selector}`);
                      return true;
                    }
                  } catch (e) {
                    continue;
                  }
                }
                return false;
              });

              if (loadMoreClicked) {
                this.log('Clicked "More results" button', Level.LOG);
                await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));
              } else {
                this.log('No "More results" button found, results may be limited', Level.WARN);
                break;
              }

              loadAttempts++;
            }

            this.log(`Finished pagination. Total results available: ${currentResultCount}`, Level.LOG);

            searchResults = await page.evaluate((limit: number) => {
              const results: any[] = [];

              const cleanDescription = (text: string): string => {
                if (!text) return '';
                let cleaned = text.replace(/^\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago\s*/i, '');
                cleaned = cleaned.replace(/^[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}\s*[—\-]\s*/i, '');
                cleaned = cleaned.replace(/^\d{4}-\d{2}-\d{2}\s*[—\-]\s*/i, '');
                cleaned = cleaned.trim().replace(/\s+/g, ' ');
                return cleaned;
              };

              const selectors = [
                '[data-testid="result"]',
                'article[data-testid="result"]',
                'li[data-layout="organic"]',
                '.result',
                'article[data-testid]'
              ];
              let allElements: Element[] = [];

              for (const selector of selectors) {
                const elements = Array.from(document.querySelectorAll(selector));
                if (elements.length > 0) {
                  console.log(`Found ${elements.length} DDG elements with: ${selector}`);
                  allElements = elements;
                  break;
                }
              }

              for (let i = 0; i < Math.min(allElements.length, limit); i++) {
                const element = allElements[i];

                const titleEl = element.querySelector('h2, [data-testid="result-title-a"], h3, [data-testid="result-title"]');

                let linkEl = titleEl?.querySelector('a[href]') as HTMLAnchorElement;
                if (!linkEl) {
                  linkEl = element.querySelector('a[href]') as HTMLAnchorElement;
                }

                if (!linkEl || !linkEl.href) continue;

                let actualUrl = linkEl.href;

                if (actualUrl.includes('uddg=')) {
                  try {
                    const urlParams = new URLSearchParams(actualUrl.split('?')[1]);
                    const uddgUrl = urlParams.get('uddg');
                    if (uddgUrl) {
                      actualUrl = decodeURIComponent(uddgUrl);
                    }
                  } catch (e) {
                    console.log('Failed to parse uddg parameter:', e);
                  }
                }

                if (actualUrl.includes('duckduckgo.com')) {
                  console.log(`Skipping DDG internal URL: ${actualUrl}`);
                  continue;
                }

                const descEl = element.querySelector('[data-result="snippet"], .result__snippet, [data-testid="result-snippet"]');

                if (titleEl && titleEl.textContent && actualUrl) {
                  const rawDescription = (descEl?.textContent || '').trim();
                  const cleanedDescription = cleanDescription(rawDescription);

                  results.push({
                    url: actualUrl,
                    title: titleEl.textContent.trim(),
                    description: cleanedDescription,
                    position: results.length + 1
                  });
                }
              }

              console.log(`Extracted ${results.length} DuckDuckGo search results`);
              return results;
            }, searchConfig.limit);

            if (searchResults.length === 0) {
              this.log(`No DuckDuckGo results found (attempt ${retryCount + 1}/${maxRetries + 1})`, Level.WARN);
              retryCount++;
            } else {
              this.log(`Successfully extracted ${searchResults.length} results`, Level.LOG);
              break;
            }
          }

          this.log(`Search found ${searchResults.length} results`, Level.LOG);

          if (searchConfig.mode === 'discover') {
            const actionType = "search";
            const actionName = "Search Results";

            if (!this.serializableDataByType[actionType]) {
              this.serializableDataByType[actionType] = {};
            }
            if (!this.serializableDataByType[actionType][actionName]) {
              this.serializableDataByType[actionType][actionName] = {};
            }

            const searchData = {
              query: searchConfig.query,
              provider: searchConfig.provider,
              filters: searchConfig.filters || {},
              resultsCount: searchResults.length,
              results: searchResults,
              searchedAt: new Date().toISOString()
            };

            this.serializableDataByType[actionType][actionName] = searchData;

            await this.options.serializableCallback({
              scrapeList: this.serializableDataByType.scrapeList || {},
              scrapeSchema: this.serializableDataByType.scrapeSchema || {},
              crawl: this.serializableDataByType.crawl || {},
              search: this.serializableDataByType.search || {}
            });

            this.log(`Search completed in discover mode with ${searchResults.length} results`, Level.LOG);
            return;
          }

          this.log(`Starting to scrape content from ${searchResults.length} search results...`, Level.LOG);
          const scrapedResults = [];

          for (let i = 0; i < searchResults.length; i++) {
            const result = searchResults[i];
            try {
              this.log(`[${i + 1}/${searchResults.length}] Scraping: ${result.url}`, Level.LOG);

              await page.goto(result.url, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
              }).catch(() => {
                this.log(`Failed to navigate to ${result.url}, skipping...`, Level.WARN);
              });

              await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});

              const pageData = await page.evaluate(() => {
                const getMeta = (name: string) => {
                  const meta = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
                  return meta?.getAttribute('content') || '';
                };

                const getAllMeta = () => {
                  const metadata: Record<string, string> = {};
                  const metaTags = document.querySelectorAll('meta');
                  metaTags.forEach(tag => {
                    const name = tag.getAttribute('name') || tag.getAttribute('property');
                    const content = tag.getAttribute('content');
                    if (name && content) {
                      metadata[name] = content;
                    }
                  });
                  return metadata;
                };

                const title = document.title || '';
                const bodyText = document.body?.innerText || '';

                const elementsWithMxId = document.querySelectorAll('[data-mx-id]');
                elementsWithMxId.forEach(el => el.removeAttribute('data-mx-id'));

                const html = document.documentElement.outerHTML;
                const links = Array.from(document.querySelectorAll('a')).map(a => a.href);
                const allMetadata = getAllMeta();

                return {
                  title,
                  description: getMeta('description'),
                  text: bodyText,
                  html: html,
                  links: links,
                  wordCount: bodyText.split(/\s+/).filter(w => w.length > 0).length,
                  metadata: {
                    ...allMetadata,
                    title,
                    language: document.documentElement.lang || '',
                    favicon: (document.querySelector('link[rel="icon"], link[rel="shortcut icon"]') as HTMLLinkElement)?.href || '',
                    statusCode: 200
                  }
                };
              });

              scrapedResults.push({
                searchResult: {
                  query: searchConfig.query,
                  position: result.position,
                  searchTitle: result.title,
                  searchDescription: result.description,
                },
                metadata: {
                  ...pageData.metadata,
                  url: result.url,
                  sourceURL: result.url
                },
                html: pageData.html,
                text: pageData.text,
                links: pageData.links,
                wordCount: pageData.wordCount,
                scrapedAt: new Date().toISOString()
              });

              this.log(`✓ Scraped ${result.url} (${pageData.wordCount} words)`, Level.LOG);

            } catch (error) {
              this.log(`Failed to scrape ${result.url}: ${error.message}`, Level.WARN);
              scrapedResults.push({
                searchResult: {
                  query: searchConfig.query,
                  position: result.position,
                  searchTitle: result.title,
                  searchDescription: result.description,
                },
                url: result.url,
                error: error.message,
                scrapedAt: new Date().toISOString()
              });
            }
          }

          this.log(`Successfully scraped ${scrapedResults.length} search results`, Level.LOG);

          const actionType = "search";
          const actionName = "Search Results";

          if (!this.serializableDataByType[actionType]) {
            this.serializableDataByType[actionType] = {};
          }
          if (!this.serializableDataByType[actionType][actionName]) {
            this.serializableDataByType[actionType][actionName] = {};
          }

          const searchData = {
            query: searchConfig.query,
            provider: searchConfig.provider,
            filters: searchConfig.filters || {},
            mode: searchConfig.mode,
            resultsCount: scrapedResults.length,
            results: scrapedResults,
            searchedAt: new Date().toISOString()
          };

          this.serializableDataByType[actionType][actionName] = searchData;

          await this.options.serializableCallback({
            scrapeList: this.serializableDataByType.scrapeList || {},
            scrapeSchema: this.serializableDataByType.scrapeSchema || {},
            crawl: this.serializableDataByType.crawl || {},
            search: this.serializableDataByType.search || {}
          });

        } catch (error) {
          this.log(`Search action failed: ${error.message}`, Level.ERROR);
          throw new Error(`Search execution error: ${error.message}`);
        }
      },

      flag: async () => new Promise((res) => {
        if (this.options.debugChannel?.setActionType) {
          this.options.debugChannel.setActionType('flag');
        }

        this.emit('flag', page, res);
      }),
    };

    const executeAction = async (invokee: any, methodName: string, args: any) => {
      console.log("Executing action:", methodName, args);

      if (methodName === 'press' || methodName === 'type') {
        // Extract only the first two arguments for these methods
        const limitedArgs = Array.isArray(args) ? args.slice(0, 2) : [args];
        await (<any>invokee[methodName])(...limitedArgs);
        return;
      }

      if (!args || Array.isArray(args)) {
        await (<any>invokee[methodName])(...(args ?? []));
      } else {
        await (<any>invokee[methodName])(args);
      }
    };
    

    for (const step of steps) {
      if (this.isAborted) {
        this.log('Workflow aborted during step execution', Level.WARN);
        return;
      }

      this.log(`Launching ${String(step.action)}`, Level.LOG);

      let stepName: string | null = null;
      try {
        const debug = this.options.debugChannel;
        if (debug?.setActionType) {
          debug.setActionType(String(step.action));
        }

        stepName = (step as any)?.name || String(step.action);

        if (debug && typeof (debug as any).setActionName === "function") {
          (debug as any).setActionName(stepName);
        }
      } catch (err) {
        this.log(`Failed to set action name/type: ${(err as Error).message}`, Level.WARN);
      }

      if (step.action in wawActions) {
        // "Arrayifying" here should not be needed (TS + syntax checker - only arrays; but why not)
        const params = !step.args || Array.isArray(step.args) ? step.args : [step.args];
        if (step.action === 'screenshot') {
            await (wawActions.screenshot as any)(...(params ?? []), stepName ?? undefined);
          } else if (step.action === 'scrapeList' || step.action === 'scrapeSchema') {
            const actionName = (step as any).name || "";
            await wawActions[step.action as CustomFunctions](...(params ?? []), actionName);
          } else {
            await wawActions[step.action as CustomFunctions](...(params ?? []));
          }
      } else {
        if (this.options.debugChannel?.setActionType) {
          this.options.debugChannel.setActionType(String(step.action));
        }

        // Implements the dot notation for the "method name" in the workflow
        const levels = String(step.action).split('.');
        const methodName = levels[levels.length - 1];

        let invokee: any = page;
        for (const level of levels.splice(0, levels.length - 1)) {
          invokee = invokee[level];
        }

        if (methodName === 'waitForLoadState') {
          try {
            let args = step.args;

            if (Array.isArray(args) && args.length === 1) {
              args = [args[0], { timeout: 30000 }];
            } else if (!Array.isArray(args)) {
              args = [args, { timeout: 30000 }];
            }
            await executeAction(invokee, methodName, step.args);
          } catch (error) {
            await executeAction(invokee, methodName, 'domcontentloaded');
          }
        } else if (methodName === 'click') {
          try {
            await executeAction(invokee, methodName, step.args);
          } catch (error) {
            try{
              await executeAction(invokee, methodName, [step.args[0], { force: true }]);
            } catch (error) {
              this.log(`Click action failed: ${error.message}`, Level.WARN);
              continue;
            }
          }
        } else {
          try {
            await executeAction(invokee, methodName, step.args);
          } catch (error) {
            this.log(`Action ${methodName} failed: ${error.message}`, Level.ERROR);
            // Continue with next action instead of crashing
            continue;
          }
        }
      }

      await new Promise((res) => { setTimeout(res, 500); });
    }
  }

  private async handlePagination(page: Page, config: { 
    listSelector: string, 
    fields: any, 
    limit?: number, 
    pagination: any 
  }, providedActionName: string = "") {
    if (this.isAborted) {
      this.log('Workflow aborted, stopping pagination', Level.WARN);
      return [];
    }

    const actionType = "scrapeList";
    let actionName = providedActionName || "";
    if (!actionName || actionName.trim() === "") {
      this.scrapeListCounter++;
      actionName = `List ${this.scrapeListCounter}`;
    }

    if (!this.serializableDataByType[actionType]) {
      this.serializableDataByType[actionType] = {};
    }
    if (!this.serializableDataByType[actionType][actionName]) {
      this.serializableDataByType[actionType][actionName] = [];
    }

    let allResults: Record<string, any>[] = [];
    let previousHeight = 0;
    let scrapedItems: Set<string> = new Set<string>();
    let visitedUrls: Set<string> = new Set<string>();
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000;
    const MAX_UNCHANGED_RESULTS = 5;

    const debugLog = (message: string, ...args: any[]) => {
        console.log(`[Page ${visitedUrls.size}] [URL: ${page.url()}] ${message}`, ...args);
    };

    const scrapeCurrentPage = async () => {
        if (this.isAborted) {
          debugLog("Workflow aborted, stopping scrapeCurrentPage");
          return;
        }

        const evaluationPromise = page.evaluate((cfg) => window.scrapeList(cfg), config);
        const timeoutPromise = new Promise<any[]>((_, reject) =>
          setTimeout(() => reject(new Error('Page evaluation timeout')), 10000)
        );

        let results;
        try {
          results = await Promise.race([evaluationPromise, timeoutPromise]);
        } catch (error) {
          debugLog(`Page evaluation failed: ${error.message}`);
          return;
        }
        const newResults = results.filter(item => {
            const uniqueKey = JSON.stringify(item);
            if (scrapedItems.has(uniqueKey)) return false;
            scrapedItems.add(uniqueKey);
            return true;
        });
        allResults = allResults.concat(newResults);
        debugLog("Results collected:", allResults.length);

        this.serializableDataByType[actionType][actionName] = [...allResults];
        await this.options.serializableCallback({
          scrapeList: this.serializableDataByType.scrapeList,
          scrapeSchema: this.serializableDataByType.scrapeSchema,
          crawl: this.serializableDataByType.crawl || {},
          search: this.serializableDataByType.search || {}
        });
    };

    const checkLimit = () => {
        if (config.limit && allResults.length >= config.limit) {
            allResults = allResults.slice(0, config.limit);
            return true;
        }
        return false;
    };

    // Helper function to detect if a selector is XPath
    const isXPathSelector = (selector: string): boolean => {
      return selector.startsWith('//') ||
        selector.startsWith('/') ||
        selector.startsWith('./') ||
        selector.includes('contains(@') ||
        selector.includes('[count(') ||
        selector.includes('@class=') ||
        selector.includes('@id=') ||
        selector.includes(' and ') ||
        selector.includes(' or ');
    };

    // Helper function to wait for selector (CSS or XPath)
    const waitForSelectorUniversal = async (selector: string, options: any = {}): Promise<ElementHandle | null> => {
      try {
        if (isXPathSelector(selector)) {
          // Use XPath locator
          const locator = page.locator(`xpath=${selector}`);
          await locator.waitFor({
            state: 'attached',
            timeout: options.timeout || 10000
          });
          return await locator.elementHandle();
        } else {
          // Use CSS selector
          return await page.waitForSelector(selector, {
            state: 'attached',
            timeout: options.timeout || 10000
          });
        }
      } catch (error) {
        return null;
      }
    };

    // Enhanced button finder with retry mechanism
    const findWorkingButton = async (selectors: string[]): Promise<{
      button: ElementHandle | null,
      workingSelector: string | null,
      updatedSelectors: string[]
    }> => {
      const startTime = Date.now();
      const MAX_BUTTON_SEARCH_TIME = 15000;
      let updatedSelectors = [...selectors];

      for (let i = 0; i < selectors.length; i++) {
        if (Date.now() - startTime > MAX_BUTTON_SEARCH_TIME) {
          debugLog(`Button search timeout reached (${MAX_BUTTON_SEARCH_TIME}ms), aborting`);
          break;
        }
        const selector = selectors[i];
        let retryCount = 0;
        let selectorSuccess = false;
        
        while (retryCount < MAX_RETRIES && !selectorSuccess) {
          try {
            const button = await waitForSelectorUniversal(selector, { timeout: 2000 });

            if (button) {
              debugLog('Found working selector:', selector);
              return {
                button,
                workingSelector: selector,
                updatedSelectors
              };
            } else {
              retryCount++;
              debugLog(`Selector "${selector}" not found: attempt ${retryCount}/${MAX_RETRIES}`);

              if (retryCount < MAX_RETRIES) {
                await page.waitForTimeout(RETRY_DELAY);
              } else {
                debugLog(`Removing failed selector "${selector}" after ${MAX_RETRIES} attempts`);
                updatedSelectors = updatedSelectors.filter(s => s !== selector);
                selectorSuccess = true;
              }
            }
          } catch (error) {
            retryCount++;
            debugLog(`Selector "${selector}" error: attempt ${retryCount}/${MAX_RETRIES} - ${error.message}`);

            if (retryCount < MAX_RETRIES) {
              await page.waitForTimeout(RETRY_DELAY);
            } else {
              debugLog(`Removing failed selector "${selector}" after ${MAX_RETRIES} attempts`);
              updatedSelectors = updatedSelectors.filter(s => s !== selector);
              selectorSuccess = true;
            }
          }
        }
      }
    
      return { 
        button: null, 
        workingSelector: null,
        updatedSelectors 
      };
    };

    const retryOperation = async (operation: () => Promise<boolean>, retryCount = 0): Promise<boolean> => {
        try {
            return await operation();
        } catch (error) {
            if (retryCount < MAX_RETRIES) {
                debugLog(`Retrying operation. Attempt ${retryCount + 1} of ${MAX_RETRIES}`);
                await page.waitForTimeout(RETRY_DELAY);
                return retryOperation(operation, retryCount + 1);
            }
            debugLog(`Operation failed after ${MAX_RETRIES} retries`);
            return false;
        }
    };

    let availableSelectors = config.pagination.selector.split(',');
    let unchangedResultCounter = 0;

    try {
      while (true) {
        if (this.isAborted) {
          this.log('Workflow aborted during pagination loop', Level.WARN);
          return allResults;
        }
        
        switch (config.pagination.type) {
          case 'scrollDown': {
            let previousResultCount = allResults.length;

            await scrapeCurrentPage();
            
            if (checkLimit()) {
              return allResults;
            }

            await page.evaluate(() => {
              const scrollHeight = Math.max(
                document.body.scrollHeight,
                document.documentElement.scrollHeight
              );

              window.scrollTo(0, scrollHeight);
            });
            await page.waitForTimeout(2000);

            const currentHeight = await page.evaluate(() => {
              return Math.max(
                document.body.scrollHeight,
                document.documentElement.scrollHeight
              );
            });
            const currentResultCount = allResults.length;
            
            if (currentResultCount === previousResultCount) {
              unchangedResultCounter++;
              if (unchangedResultCounter >= MAX_UNCHANGED_RESULTS) {
                return allResults;
              }
            } else {
              unchangedResultCounter = 0;
            }
            
            if (currentHeight === previousHeight) {
              return allResults;
            }

            previousHeight = currentHeight;
            break;
          }

          case 'scrollUp': {
            let previousResultCount = allResults.length;

            await scrapeCurrentPage();
            
            if (checkLimit()) {
              return allResults;
            }

            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForTimeout(2000);

            const currentTopHeight = await page.evaluate(() => document.documentElement.scrollTop);
            const currentResultCount = allResults.length;
            
            if (currentResultCount === previousResultCount) {
              unchangedResultCounter++;              
              if (unchangedResultCounter >= MAX_UNCHANGED_RESULTS) {
                return allResults;
              }
            } else {
              unchangedResultCounter = 0;
            }

            if (currentTopHeight === 0) {
              return allResults;
            }

            previousHeight = currentTopHeight;
            break;
          }

          case 'clickNext': {
            const currentUrl = page.url();
            visitedUrls.add(currentUrl);
            
            await scrapeCurrentPage();
            if (checkLimit()) return allResults;
          
            const { button, workingSelector, updatedSelectors } = await findWorkingButton(availableSelectors);
            
            availableSelectors = updatedSelectors;
          
            if (!button || !workingSelector) {
              // Final retry for navigation when no selectors work
              const success = await retryOperation(async () => {
                try {
                  await page.evaluate(() => window.history.forward());
                  const newUrl = page.url();
                  return !visitedUrls.has(newUrl);
                } catch {
                  return false;
                }
              });
                
              if (!success) return allResults;
              break;
            }
          
            let retryCount = 0;
            let paginationSuccess = false;
            
            // Capture basic content signature before click - with XPath support
            const captureContentSignature = async () => {
              return await page.evaluate((listSelector) => {
                const isXPath = (selector: string) => {
                  return selector.startsWith('//') || selector.startsWith('./') || selector.includes('::');
                };
                
                let items: NodeListOf<Element> | Element[] = [];
                
                if (isXPath(listSelector)) {
                  try {
                    // Use XPath to find elements
                    const xpathResult = document.evaluate(
                      listSelector,
                      document,
                      null,
                      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                      null
                    );
                    
                    items = [];
                    for (let i = 0; i < xpathResult.snapshotLength; i++) {
                      const node = xpathResult.snapshotItem(i);
                      if (node && node.nodeType === Node.ELEMENT_NODE) {
                        items.push(node as Element);
                      }
                    }
                  } catch (xpathError) {
                    console.warn('XPath evaluation failed, trying CSS selector as fallback:', xpathError);
                    // Fallback to CSS selector
                    try {
                      items = document.querySelectorAll(listSelector);
                    } catch (cssError) {
                      console.warn('CSS selector fallback also failed:', cssError);
                      items = [];
                    }
                  }
                } else {
                  try {
                    // Use CSS selector
                    items = document.querySelectorAll(listSelector);
                  } catch (cssError) {
                    console.warn('CSS selector failed:', cssError);
                    items = [];
                  }
                }
                
                return {
                  url: window.location.href,
                  itemCount: items.length,
                  firstItems: Array.from(items).slice(0, 3).map(el => el.textContent || '').join('|')
                };
              }, config.listSelector);
            };
          
            const beforeSignature = await captureContentSignature();
            debugLog(`Before click: ${beforeSignature.itemCount} items`);
          
            while (retryCount < MAX_RETRIES && !paginationSuccess) {
              try {
                try {
                  await Promise.all([
                    page.waitForNavigation({ 
                      waitUntil: 'networkidle',
                      timeout: 15000 
                    }).catch(e => {
                      throw e; 
                    }),
                    page.locator(workingSelector).first().click()
                  ]);
                  debugLog("Navigation successful after regular click");
                  await page.waitForTimeout(2000);
                  paginationSuccess = true;
                } catch (navError) {
                  debugLog("Regular click with navigation failed, trying dispatch event with navigation");
                  try {
                    await Promise.all([
                      page.waitForNavigation({ 
                        waitUntil: 'networkidle',
                        timeout: 15000 
                      }).catch(e => {
                        throw e; 
                      }),
                      page.locator(workingSelector).first().dispatchEvent('click')
                    ]);
                    debugLog("Navigation successful after dispatch event");
                    await page.waitForTimeout(2000);
                    paginationSuccess = true;
                  } catch (dispatchNavError) {
                    try {
                      await page.locator(workingSelector).first().click();
                      await page.waitForTimeout(2000);
                    } catch (clickError) {
                      await page.locator(workingSelector).first().dispatchEvent('click');
                      await page.waitForTimeout(2000);
                    }
                  }
                }
                
                await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
                
                if (!paginationSuccess) {
                  const newUrl = page.url();
                  const afterSignature = await captureContentSignature();
                  
                  if (newUrl !== currentUrl) {
                    debugLog(`URL changed to ${newUrl}`);
                    visitedUrls.add(newUrl);
                    paginationSuccess = true;
                  } 
                  else if (afterSignature.firstItems !== beforeSignature.firstItems) {
                    debugLog("Content changed without URL change");
                    paginationSuccess = true;
                  }
                  else if (afterSignature.itemCount !== beforeSignature.itemCount) {
                    debugLog(`Item count changed from ${beforeSignature.itemCount} to ${afterSignature.itemCount}`);
                    paginationSuccess = true;
                  }
                }
              } catch (error) {
                debugLog(`Pagination attempt ${retryCount + 1} failed: ${error.message}`);
              }
              
              if (!paginationSuccess) {
                retryCount++;
                if (retryCount < MAX_RETRIES) {
                  debugLog(`Retrying pagination - attempt ${retryCount + 1} of ${MAX_RETRIES}`);
                  await page.waitForTimeout(RETRY_DELAY);
                }
              }
            }
          
            if (!paginationSuccess) {
              debugLog(`Pagination failed after ${MAX_RETRIES} attempts`);
              return allResults;
            }
            
            break;
          }

          case 'clickLoadMore': {
            await scrapeCurrentPage();
            if (checkLimit()) return allResults;
            
            let loadMoreCounter = 0;
            let previousResultCount = allResults.length;
            let noNewItemsCounter = 0;
            const MAX_NO_NEW_ITEMS = 5;
            
            while (true) {
              if (this.isAborted) {
                this.log('Workflow aborted during pagination loop', Level.WARN);
                return allResults;
              }

              // Find working button with retry mechanism
              const { button: loadMoreButton, workingSelector, updatedSelectors } = await findWorkingButton(availableSelectors);

              availableSelectors = updatedSelectors;
              
              if (!workingSelector || !loadMoreButton) {
                debugLog('No working Load More selector found after retries');
                return allResults;
              }
          
              // Implement retry mechanism for clicking the button
              let retryCount = 0;
              let clickSuccess = false;
          
              while (retryCount < MAX_RETRIES && !clickSuccess) {
                try {
                  try {
                    await loadMoreButton.click();
                    clickSuccess = true;
                  } catch (error) {
                    debugLog(`Regular click failed on attempt ${retryCount + 1}. Trying DispatchEvent`);
                    
                    // If regular click fails, try dispatchEvent
                    try {
                      await loadMoreButton.dispatchEvent('click');
                      clickSuccess = true;
                    } catch (dispatchError) {
                      debugLog(`DispatchEvent failed on attempt ${retryCount + 1}.`);
                      throw dispatchError; // Propagate error to trigger retry
                    }
                  }
          
                  if (clickSuccess) {
                    await page.waitForTimeout(1000);
                    loadMoreCounter++;
                    debugLog(`Successfully clicked Load More button (${loadMoreCounter} times)`);
                  }
                } catch (error) {
                  debugLog(`Click attempt ${retryCount + 1} failed completely.`);
                  retryCount++;
                  
                  if (retryCount < MAX_RETRIES) {
                    debugLog(`Retrying click - attempt ${retryCount + 1} of ${MAX_RETRIES}`);
                    await page.waitForTimeout(RETRY_DELAY);
                  }
                }
              }
          
              if (!clickSuccess) {
                debugLog(`Load More clicking failed after ${MAX_RETRIES} attempts`);
                return allResults;
              }
          
              // Wait for content to load and check scroll height
              await page.waitForTimeout(2000);
              await page.evaluate(() => {
                const scrollHeight = Math.max(
                  document.body.scrollHeight,
                  document.documentElement.scrollHeight
                );

                window.scrollTo(0, scrollHeight);
              });
              await page.waitForTimeout(2000);

              const currentHeight = await page.evaluate(() => {
                return Math.max(
                  document.body.scrollHeight,
                  document.documentElement.scrollHeight
                );
              });
              const heightChanged = currentHeight !== previousHeight;
              previousHeight = currentHeight;
              
              await scrapeCurrentPage();
              
              const currentResultCount = allResults.length;
              const newItemsAdded = currentResultCount > previousResultCount;
                          
              if (!newItemsAdded) {
                noNewItemsCounter++;
                debugLog(`No new items added after click (${noNewItemsCounter}/${MAX_NO_NEW_ITEMS})`);
                
                if (noNewItemsCounter >= MAX_NO_NEW_ITEMS) {
                  debugLog(`Stopping after ${MAX_NO_NEW_ITEMS} clicks with no new items`);
                  return allResults;
                }
              } else {
                noNewItemsCounter = 0;
                previousResultCount = currentResultCount;
              }
              
              if (checkLimit()) return allResults;     
              
              if (!heightChanged) {
                debugLog('No more items loaded after Load More');
                return allResults;
              }
            }
          }

          default: {
            await scrapeCurrentPage();
            return allResults;
          }
        }

        if (checkLimit()) break;
      }
    } catch (error) {
        debugLog(`Fatal error: ${error.message}`);
        return allResults;
    }

    return allResults;
  }

  private getMatchingActionId(workflow: Workflow, pageState: PageState, usedActions: string[]) {
    for (let actionId = workflow.length - 1; actionId >= 0; actionId--) {
      const step = workflow[actionId];
      const isApplicable = this.applicable(step.where, pageState, usedActions);
      console.log("-------------------------------------------------------------");
      console.log(`Where:`, step.where);
      console.log(`Page state:`, pageState);
      console.log(`Match result: ${isApplicable}`);
      console.log("-------------------------------------------------------------");
      
      if (isApplicable) {
          return actionId;
      }
    }
  }

  private removeShadowSelectors(workflow: Workflow) {
    for (let actionId = workflow.length - 1; actionId >= 0; actionId--) {
      const step = workflow[actionId];
      
      // Check if step has where and selectors
      if (step.where && Array.isArray(step.where.selectors)) {
          // Filter out selectors that contain ">>"
          step.where.selectors = step.where.selectors.filter(selector => !selector.includes('>>'));
      }
    }
  
    return workflow;
  }

  private removeSpecialSelectors(workflow: Workflow) {
    for (let actionId = workflow.length - 1; actionId >= 0; actionId--) {
        const step = workflow[actionId];
        
        if (step.where && Array.isArray(step.where.selectors)) {
            // Filter out if selector has EITHER ":>>" OR ">>"
            step.where.selectors = step.where.selectors.filter(selector => 
                !(selector.includes(':>>') || selector.includes('>>'))
            );
        }
    }

    return workflow;
  }

  private async runLoop(p: Page, workflow: Workflow) {
    if (this.isAborted) {
      this.log('Workflow aborted in runLoop', Level.WARN);
      return;
    }

    let workflowCopy: Workflow = JSON.parse(JSON.stringify(workflow));

    workflowCopy = this.removeSpecialSelectors(workflowCopy);

    const usedActions: string[] = [];
    let selectors: string[] = [];
    let lastAction = null;
    let actionId = -1
    let repeatCount = 0;

    /**
    *  Enables the interpreter functionality for popup windows.
    * User-requested concurrency should be entirely managed by the concurrency manager,
    * e.g. via `enqueueLinks`.
    */
    const popupHandler = (popup) => {
      this.concurrency.addJob(() => this.runLoop(popup, workflowCopy));
    };
    p.on('popup', popupHandler);

    /* eslint no-constant-condition: ["warn", { "checkLoops": false }] */
    let loopIterations = 0;
    const MAX_LOOP_ITERATIONS = 1000; // Circuit breaker

    // Cleanup function to remove popup listener
    const cleanup = () => {
      try {
        if (!p.isClosed()) {
          p.removeListener('popup', popupHandler);
        }
      } catch (cleanupError) {
      }
    };
    
    while (true) {
      if (this.isAborted) {
        this.log('Workflow aborted during step execution', Level.WARN);
        cleanup();
        return;
      }

      // Circuit breaker to prevent infinite loops
      if (++loopIterations > MAX_LOOP_ITERATIONS) {
        this.log('Maximum loop iterations reached, terminating to prevent infinite loop', Level.ERROR);
        cleanup();
        return;
      }
      
      // Checks whether the page was closed from outside,
      //  or the workflow execution has been stopped via `interpreter.stop()`
      if (p.isClosed() || !this.stopper) {
        cleanup();
        return;
      }

      try {
        await p.waitForLoadState();
      } catch (e) {
        cleanup();
        await p.close();
        return;
      }

      if (workflowCopy.length === 0) {
        this.log('All actions completed. Workflow finished.', Level.LOG);
        cleanup();
        return;
      }

      // let pageState = {};
      // try {
      //   // Check if page is still valid before accessing state
      //   if (p.isClosed()) {
      //     this.log('Page was closed during execution', Level.WARN);
      //     return;
      //   }
        
      //   pageState = await this.getState(p, workflowCopy, selectors);
      //   selectors = [];
      //   console.log("Empty selectors:", selectors)
      // } catch (e: any) {
      //   this.log(`Failed to get page state: ${e.message}`, Level.ERROR);
      //   // If state access fails, attempt graceful recovery
      //   if (p.isClosed()) {
      //     this.log('Browser has been closed, terminating workflow', Level.WARN);
      //     return;
      //   }
      //   // For other errors, continue with empty state to avoid complete failure
      //   pageState = { url: p.url(), selectors: [], cookies: {} };
      // }

      // if (this.options.debug) {
      //   this.log(`Current state is: \n${JSON.stringify(pageState, null, 2)}`, Level.WARN);
      // }

      // const actionId = workflow.findIndex((step) => {
      //   const isApplicable = this.applicable(step.where, pageState, usedActions);
      //   console.log("-------------------------------------------------------------");
      //   console.log(`Where:`, step.where);
      //   console.log(`Page state:`, pageState);
      //   console.log(`Match result: ${isApplicable}`);
      //   console.log("-------------------------------------------------------------");
      //   return isApplicable;
      // });

      // actionId = this.getMatchingActionId(workflowCopy, pageState, usedActions);

      const actionId = workflowCopy.length - 1;
      const action = workflowCopy[actionId];

      console.log("MATCHED ACTION:", action);
      console.log("MATCHED ACTION ID:", actionId);
      this.log(`Matched ${JSON.stringify(action?.where)}`, Level.LOG);

      if (action) { // action is matched
        if (this.options.debugChannel?.activeId) {
          this.options.debugChannel.activeId(actionId);
        }
        
        repeatCount = action === lastAction ? repeatCount + 1 : 0;
        
        console.log("REPEAT COUNT", repeatCount);
        if (this.options.maxRepeats && repeatCount > this.options.maxRepeats) {
          return;
        }
        lastAction = action;
        
        if (this.isAborted) {
          this.log('Workflow aborted before action execution', Level.WARN);
          return;
        }

        try {
          console.log("Carrying out:", action.what);
          await this.carryOutSteps(p, action.what);
          usedActions.push(action.id ?? 'undefined');

          workflowCopy.splice(actionId, 1);
          console.log(`Action with ID ${action.id} removed from the workflow copy.`);

          this.executedActions++;
          const percentage = Math.round((this.executedActions / this.totalActions) * 100);

          if (this.options.debugChannel?.progressUpdate) {
            this.options.debugChannel.progressUpdate(
              this.executedActions,
              this.totalActions,
              percentage
            );
          }
          
          // const newSelectors = this.getPreviousSelectors(workflow, actionId);
          // const newSelectors = this.getSelectors(workflowCopy);
          // newSelectors.forEach(selector => {
          //     if (!selectors.includes(selector)) {
          //         selectors.push(selector);
          //     }
          // });
          
          // Reset loop iteration counter on successful action
          loopIterations = 0;
        } catch (e) {
          this.log(<Error>e, Level.ERROR);
          // Don't crash on individual action failures - continue with next iteration
          continue;
        }
      } else {
        //await this.disableAdBlocker(p);
        cleanup();
        return;
      }
    }
  }

  private async ensureScriptsLoaded(page: Page) {
    try {
      const evaluationPromise = page.evaluate(() =>
        typeof window.scrape === 'function' &&
        typeof window.scrapeSchema === 'function' &&
        typeof window.scrapeList === 'function' &&
        typeof window.scrapeListAuto === 'function' &&
        typeof window.scrollDown === 'function' &&
        typeof window.scrollUp === 'function'
      );

      const timeoutPromise = new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('Script check timeout')), 3000)
      );

      const isScriptLoaded = await Promise.race([
        evaluationPromise,
        timeoutPromise
      ]);

      if (!isScriptLoaded) {
        await page.addInitScript({ path: path.join(__dirname, 'browserSide', 'scraper.js') });
      }
    } catch (error) {
      this.log(`Script check failed, adding script anyway: ${error.message}`, Level.WARN);
      try {
        await page.addInitScript({ path: path.join(__dirname, 'browserSide', 'scraper.js') });
      } catch (scriptError) {
        this.log(`Failed to add script: ${scriptError.message}`, Level.ERROR);
      }
    }
  }

  /**
   * Spawns a browser context and runs given workflow.
   * \
   * Resolves after the playback is finished.
   * @param {Page} [page] Page to run the workflow on.
   * @param {ParamType} params Workflow specific, set of parameters
   *  for the `{$param: nameofparam}` fields.
   */
  public async run(page: Page, params?: ParamType): Promise<void> {
    this.log('Starting the workflow.', Level.LOG);
    const context = page.context();

    page.setDefaultNavigationTimeout(100000);
    
    // Check proxy settings from context options
    const contextOptions = (context as any)._options;
    const hasProxy = !!contextOptions?.proxy;
    
    this.log(`Proxy settings: ${hasProxy ? `Proxy is configured...` : 'No proxy configured...'}`);
    
    if (hasProxy) {
        if (contextOptions.proxy.username) {
            this.log(`Proxy authenticated...`);
        }
    }
    if (this.stopper) {
      throw new Error('This Interpreter is already running a workflow. To run another workflow, please, spawn another Interpreter.');
    }
    /**
     * `this.workflow` with the parameters initialized.
     */
    this.initializedWorkflow = Preprocessor.initWorkflow(this.workflow, params);

    this.totalActions = this.initializedWorkflow.length;
    this.executedActions = 0;

    if (this.options.debugChannel?.progressUpdate) {
      this.options.debugChannel.progressUpdate(0, this.totalActions, 0);
    }

    await this.ensureScriptsLoaded(page);

    this.stopper = () => {
      this.stopper = null;
    };

    this.concurrency.addJob(() => this.runLoop(page, this.initializedWorkflow!));

    await this.concurrency.waitForCompletion();

    this.stopper = null;
  }

  public async stop(): Promise<void> {
    if (this.stopper) {
      await this.stopper();
      this.stopper = null;
    } else {
      throw new Error('Cannot stop, there is no running workflow!');
    }
  }
  /**
   * Cleanup method to release resources and prevent memory leaks
   * Call this when the interpreter is no longer needed
   */
  public async cleanup(): Promise<void> {
    try {
      // Stop any running workflows first
      if (this.stopper) {
        try {
          await this.stop();
        } catch (error: any) {
          this.log(`Error stopping workflow during cleanup: ${error.message}`, Level.WARN);
        }
      }

      // Clear accumulated data to free memory
      this.cumulativeResults = [];
      this.namedResults = {};
      this.serializableDataByType = { scrapeList: {}, scrapeSchema: {}, crawl: {}, search: {} };

      // Reset state
      this.isAborted = false;
      this.initializedWorkflow = null;

      this.log('Interpreter cleanup completed', Level.DEBUG);
    } catch (error: any) {
      this.log(`Error during interpreter cleanup: ${error.message}`, Level.ERROR);
      throw error;
    }
  }
}