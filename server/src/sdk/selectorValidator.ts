/**
 * Selector Validator
 * Validates and enriches selectors with metadata using Playwright page instance
 */

import { Page } from 'playwright-core';
import logger from '../logger';

interface SelectorInput {
  selector: string;
  attribute?: string;
}

interface EnrichedSelector {
  tag: string;
  isShadow: boolean;
  selector: string;
  attribute: string;
}

interface ValidationResult {
  valid: boolean;
  enriched?: EnrichedSelector;
  error?: string;
}

export class SelectorValidator {
  private page: Page | null = null;

  /**
   * Initialize with an existing Page instance and navigate to URL
   * @param page Page instance from RemoteBrowser
   * @param url URL to navigate to
   */
  async initialize(page: Page, url: string): Promise<void> {
    this.page = page;
    try {
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 100000,
      });
    } catch (err) {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 100000,
      });
    }
    logger.info(`Navigated to ${url} using RemoteBrowser page`);
  }

  /**
   * Validate and enrich a single selector
   */
  async validateSelector(input: SelectorInput): Promise<ValidationResult> {
    if (!this.page) {
      return { valid: false, error: 'Browser not initialized' };
    }

    const { selector, attribute = 'innerText' } = input;

    try {
      const isXPath = selector.startsWith('//') || selector.startsWith('(//');

      let element;
      if (isXPath) {
        element = await this.page.locator(`xpath=${selector}`).first();
      } else {
        element = await this.page.locator(selector).first();
      }

      const count = await element.count();
      if (count === 0) {
        return {
          valid: false,
          error: `Selector "${selector}" did not match any elements`
        };
      }

      const tagName = await element.evaluate((el) => el.tagName);

      const isShadow = await element.evaluate((el) => {
        let parent = el.parentNode;
        while (parent) {
          if (parent instanceof ShadowRoot) {
            return true;
          }
          parent = parent.parentNode;
        }
        return false;
      });

      return {
        valid: true,
        enriched: {
          tag: tagName,
          isShadow,
          selector,
          attribute
        }
      };
    } catch (error: any) {
      logger.error(`Error validating selector "${selector}":`, error.message);
      return {
        valid: false,
        error: `Invalid selector: ${error.message}`
      };
    }
  }

  /**
   * Validate and enrich multiple selectors
   */
  async validateSchemaFields(
    fields: Record<string, string | SelectorInput>
  ): Promise<{ valid: boolean; enriched?: Record<string, EnrichedSelector>; errors?: string[] }> {
    const enriched: Record<string, EnrichedSelector> = {};
    const errors: string[] = [];

    for (const [fieldName, fieldInput] of Object.entries(fields)) {
      const input: SelectorInput = typeof fieldInput === 'string'
        ? { selector: fieldInput }
        : fieldInput;

      const result = await this.validateSelector(input);

      if (result.valid && result.enriched) {
        enriched[fieldName] = result.enriched;
      } else {
        errors.push(`Field "${fieldName}": ${result.error}`);
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, enriched };
  }

  /**
   * Validate list selector and fields
   */
  async validateListFields(config: {
    itemSelector: string;
    fields: Record<string, string | SelectorInput>;
  }): Promise<{
    valid: boolean;
    enriched?: {
      listSelector: string;
      listTag: string;
      fields: Record<string, EnrichedSelector>;
    };
    errors?: string[]
  }> {
    const errors: string[] = [];

    const listResult = await this.validateSelector({
      selector: config.itemSelector,
      attribute: 'innerText'
    });

    if (!listResult.valid || !listResult.enriched) {
      errors.push(`List selector: ${listResult.error}`);
      return { valid: false, errors };
    }

    const fieldsResult = await this.validateSchemaFields(config.fields);

    if (!fieldsResult.valid) {
      errors.push(...(fieldsResult.errors || []));
      return { valid: false, errors };
    }

    return {
      valid: true,
      enriched: {
        listSelector: config.itemSelector,
        listTag: listResult.enriched.tag,
        fields: fieldsResult.enriched!
      }
    };
  }

  /**
   * Detect input type for a given selector
   */
  async detectInputType(selector: string): Promise<string> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    try {
      const isXPath = selector.startsWith('//') || selector.startsWith('(//');

      let element;
      if (isXPath) {
        element = await this.page.locator(`xpath=${selector}`).first();
      } else {
        element = await this.page.locator(selector).first();
      }

      const count = await element.count();
      if (count === 0) {
        throw new Error(`Selector "${selector}" did not match any elements`);
      }

      const inputType = await element.evaluate((el) => {
        if (el instanceof HTMLInputElement) {
          return el.type || 'text';
        }
        if (el instanceof HTMLTextAreaElement) {
          return 'textarea';
        }
        if (el instanceof HTMLSelectElement) {
          return 'select';
        }
        return 'text';
      });

      return inputType;
    } catch (error: any) {
      throw new Error(`Failed to detect input type: ${error.message}`);
    }
  }

  /**
   * Auto-detect fields from list selector
   */
  async autoDetectListFields(listSelector: string): Promise<{
    success: boolean;
    fields?: Record<string, any>;
    listSelector?: string;
    error?: string;
  }> {
    if (!this.page) {
      return { success: false, error: 'Browser not initialized' };
    }

    try {
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(__dirname, 'browserSide/pageAnalyzer.js');
      const scriptContent = fs.readFileSync(scriptPath, 'utf8');

      await this.page.evaluate((script) => {
        eval(script);
      }, scriptContent);

      const result = await this.page.evaluate((selector) => {
        const win = window as any;
        if (typeof win.autoDetectListFields === 'function') {
          return win.autoDetectListFields(selector);
        } else {
          return {
            fields: {},
            error: 'Auto-detection function not loaded'
          };
        }
      }, listSelector);

      // Log debug information
      if (result.debug) {
        logger.info(`Debug info: ${JSON.stringify(result.debug)}`);
      }

      if (result.error || !result.fields || Object.keys(result.fields).length === 0) {
        return {
          success: false,
          error: result.error || 'No fields detected from list selector'
        };
      }

      const convertedListSelector = result.listSelector || listSelector;

      logger.info(`Auto-detected ${Object.keys(result.fields).length} fields from list`);

      return {
        success: true,
        fields: result.fields,
        listSelector: convertedListSelector,
      };
    } catch (error: any) {
      logger.error('Field auto-detection error:', error);
      return {
        success: false,
        error: `Field auto-detection failed: ${error.message}`
      };
    }
  }

  /**
   * Auto-detect pagination type and selector from list selector
   */
  async autoDetectPagination(listSelector: string): Promise<{
    success: boolean;
    type?: string;
    selector?: string | null;
    error?: string;
  }> {
    if (!this.page) {
      return { success: false, error: 'Browser not initialized' };
    }

    try {
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(__dirname, 'browserSide/pageAnalyzer.js');
      const scriptContent = fs.readFileSync(scriptPath, 'utf8');

      await this.page.evaluate((script) => {
        eval(script);
      }, scriptContent);

      const buttonResult = await this.page.evaluate((selector) => {
        const win = window as any;

        if (typeof win.autoDetectPagination === 'function') {
          const result = win.autoDetectPagination(selector);
          return result;
        } else {
          console.error('autoDetectPagination function not found!');
          return {
            type: '',
            selector: null,
            error: 'Pagination auto-detection function not loaded'
          };
        }
      }, listSelector);

      if (buttonResult.debug) {
        logger.info(`Pagination debug info: ${JSON.stringify(buttonResult.debug)}`);
      }

      if (buttonResult.error) {
        logger.error(`Button detection error: ${buttonResult.error}`);
        return {
          success: false,
          error: buttonResult.error
        };
      }

      if (buttonResult.type && buttonResult.type !== '') {
        if (buttonResult.type === 'clickLoadMore' && buttonResult.selector) {
          logger.info('Testing Load More button by clicking...');
          const loadMoreVerified = await this.testLoadMoreButton(buttonResult.selector, listSelector);

          if (!loadMoreVerified) {
            logger.warn('Load More button did not load content, falling back to scroll detection');
            const scrollTestResult = await this.testInfiniteScrollByScrolling(listSelector);

            if (scrollTestResult.detected) {
              return {
                success: true,
                type: 'scrollDown',
                selector: null
              };
            }
          } else {
            logger.info(`Verified Load More button works`);
            return {
              success: true,
              type: buttonResult.type,
              selector: buttonResult.selector
            };
          }
        } else {
          logger.info(`Detected pagination type: ${buttonResult.type}${buttonResult.selector ? ` with selector: ${buttonResult.selector}` : ''}`);
          return {
            success: true,
            type: buttonResult.type,
            selector: buttonResult.selector
          };
        }
      }

      return {
        success: true,
        type: '',
        selector: null
      };

    } catch (error: any) {
      logger.error('Pagination auto-detection error:', error);
      return {
        success: false,
        error: `Pagination auto-detection failed: ${error.message}`
      };
    }
  }

  /**
   * Test Load More button by clicking it and checking if content loads
   */
  private async testLoadMoreButton(buttonSelector: string, listSelector: string): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    try {
      const initialState = await this.page.evaluate((selector) => {
        function evaluateSelector(sel: string, doc: Document) {
          const isXPath = sel.startsWith('//') || sel.startsWith('(//');
          if (isXPath) {
            const result = doc.evaluate(sel, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            const elements = [];
            for (let i = 0; i < result.snapshotLength; i++) {
              elements.push(result.snapshotItem(i));
            }
            return elements;
          } else {
            return Array.from(doc.querySelectorAll(sel));
          }
        }

        const listElements = evaluateSelector(selector, document);
        return {
          itemCount: listElements.length,
          scrollHeight: document.documentElement.scrollHeight
        };
      }, listSelector);

      try {
        const selectors = buttonSelector.split(',').map(s => s.trim());
        let clicked = false;

        for (const sel of selectors) {
          try {
            await this.page.click(sel, { timeout: 1000 });
            clicked = true;
            break;
          } catch (e) {
            continue;
          }
        }

        if (!clicked) {
          return false;
        }

        await this.page.waitForTimeout(2000);

      } catch (clickError: any) {
        logger.warn(`Failed to click button: ${clickError.message}`);
        return false;
      }

      const afterClickState = await this.page.evaluate((selector) => {
        function evaluateSelector(sel: string, doc: Document) {
          const isXPath = sel.startsWith('//') || sel.startsWith('(//');
          if (isXPath) {
            const result = doc.evaluate(sel, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            const elements = [];
            for (let i = 0; i < result.snapshotLength; i++) {
              elements.push(result.snapshotItem(i));
            }
            return elements;
          } else {
            return Array.from(doc.querySelectorAll(sel));
          }
        }

        const listElements = evaluateSelector(selector, document);
        return {
          itemCount: listElements.length,
          scrollHeight: document.documentElement.scrollHeight
        };
      }, listSelector);

      logger.info(`After click: ${afterClickState.itemCount} items, scrollHeight: ${afterClickState.scrollHeight}`);

      const itemsAdded = afterClickState.itemCount > initialState.itemCount;
      const heightIncreased = afterClickState.scrollHeight > initialState.scrollHeight + 100;

      if (itemsAdded || heightIncreased) {
        const details = `Items: ${initialState.itemCount} → ${afterClickState.itemCount}, Height: ${initialState.scrollHeight} → ${afterClickState.scrollHeight}`;
        logger.info(`Content loaded after click: ${details}`);
        return true;
      }

      logger.info('No content change detected after clicking');
      return false;

    } catch (error: any) {
      logger.error('Error during Load More test:', error.message);
      return false;
    }
  }

  /**
   * Test for infinite scroll by actually scrolling and checking if content loads
   */
  private async testInfiniteScrollByScrolling(listSelector: string): Promise<{
    detected: boolean;
    details?: string;
  }> {
    if (!this.page) {
      return { detected: false };
    }

    try {
      const initialState = await this.page.evaluate((selector) => {
        function evaluateSelector(sel: string, doc: Document) {
          const isXPath = sel.startsWith('//') || sel.startsWith('(//');
          if (isXPath) {
            const result = doc.evaluate(sel, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            const elements = [];
            for (let i = 0; i < result.snapshotLength; i++) {
              elements.push(result.snapshotItem(i));
            }
            return elements;
          } else {
            return Array.from(doc.querySelectorAll(sel));
          }
        }

        const listElements = evaluateSelector(selector, document);
        return {
          itemCount: listElements.length,
          scrollHeight: document.documentElement.scrollHeight,
          scrollY: window.scrollY
        };
      }, listSelector);

      logger.info(`Initial state: ${initialState.itemCount} items, scrollHeight: ${initialState.scrollHeight}`);

      await this.page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
      });

      await this.page.waitForTimeout(2000);

      const afterScrollState = await this.page.evaluate((selector) => {
        function evaluateSelector(sel: string, doc: Document) {
          const isXPath = sel.startsWith('//') || sel.startsWith('(//');
          if (isXPath) {
            const result = doc.evaluate(sel, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            const elements = [];
            for (let i = 0; i < result.snapshotLength; i++) {
              elements.push(result.snapshotItem(i));
            }
            return elements;
          } else {
            return Array.from(doc.querySelectorAll(sel));
          }
        }

        const listElements = evaluateSelector(selector, document);
        return {
          itemCount: listElements.length,
          scrollHeight: document.documentElement.scrollHeight,
          scrollY: window.scrollY
        };
      }, listSelector);

      await this.page.evaluate((originalY) => {
        window.scrollTo(0, originalY);
      }, initialState.scrollY);

  
      const itemsAdded = afterScrollState.itemCount > initialState.itemCount;
      const heightIncreased = afterScrollState.scrollHeight > initialState.scrollHeight + 100;

      if (itemsAdded || heightIncreased) {
        const details = `Items: ${initialState.itemCount} → ${afterScrollState.itemCount}, Height: ${initialState.scrollHeight} → ${afterScrollState.scrollHeight}`;
        logger.info(`Content changed: ${details}`);
        return { detected: true, details };
      }

      logger.info('No content change detected');
      return { detected: false };

    } catch (error: any) {
      logger.error('Error during scroll test:', error.message);
      return { detected: false };
    }
  }

  /**
   * Clear page reference
   */
  async close(): Promise<void> {
    this.page = null;
    logger.info('Page reference cleared');
  }
}
