import { Action, ActionType, Coordinates, TagName, DatePickerEventData } from "../../types";
import { WhereWhatPair, WorkflowFile } from 'maxun-core';
import logger from "../../logger";
import { Socket } from "socket.io";
import { Page } from "playwright";
import {
  getElementInformation,
  getRect,
  getSelectors,
  getChildSelectors,
  getNonUniqueSelectors,
  isRuleOvershadowing,
  selectorAlreadyInWorkflow
} from "../selector";
import { CustomActions } from "../../../../src/shared/types";
import { workflow } from "../../routes";
import Robot from "../../models/Robot";
import Run from "../../models/Run";
import { saveFile } from "../storage";
import fs from "fs";
import { getBestSelectorForAction } from "../utils";
import { browserPool } from "../../server";
import { uuid } from "uuidv4";
import { capture } from "../../utils/analytics"
import { decrypt, encrypt } from "../../utils/auth";

interface PersistedGeneratedData {
  lastUsedSelector: string;
  lastIndex: number | null;
  lastAction: string;
  lastUsedSelectorTagName: string;
  lastUsedSelectorInnerText: string;
}

interface MetaData {
  name: string;
  id: string;
  createdAt: string;
  pairs: number;
  updatedAt: string;
  params: string[],
  isLogin?: boolean;
}

/**
 * Workflow generator is used to transform the user's interactions into an automatically
 * generated correct workflows, using the ability of internal state persistence and
 * heuristic generative algorithms.
 * This class also takes care of the selector generation.
 * @category WorkflowManagement
 */
export class WorkflowGenerator {

  /**
   * The socket used to communicate with the client.
   * @private
   */
  private socket: Socket;

  /**
   * getList is one of the custom actions from maxun-core.
   * Used to provide appropriate selectors for the getList action.
   */
  private getList: boolean = false;

  private listSelector: string = '';

  private paginationMode: boolean = false;

  /**
   * The public constructor of the WorkflowGenerator.
   * Takes socket for communication as a parameter and registers some important events on it.
   * @param socket The socket used to communicate with the client.
   * @constructor
   */
  public constructor(socket: Socket) {
    this.socket = socket;
    this.registerEventHandlers(socket);
    this.initializeSocketListeners();
  }

  /**
   * The current workflow being recorded.
   * @private
   */
  private workflowRecord: WorkflowFile = {
    workflow: [],
  };

  /**
   * Metadata of the currently recorded workflow.
   * @private
   */
  private recordingMeta: MetaData = {
    name: '',
    id: '',
    createdAt: '',
    pairs: 0,
    updatedAt: '',
    params: [],
    isLogin: false,
  }

  /**
   * The persistent data from the whole workflow generation process.
   * Used for correct generation of other user inputs.
   * @private
   */
  private generatedData: PersistedGeneratedData = {
    lastUsedSelector: '',
    lastIndex: null,
    lastAction: '',
    lastUsedSelectorTagName: '',
    lastUsedSelectorInnerText: '',
  }

  /**
   * Initializes the socket listeners for the generator.
   */
  private initializeSocketListeners() {
    this.socket.on('setGetList', (data: { getList: boolean }) => {
      this.getList = data.getList;
    });
    this.socket.on('listSelector', (data: { selector: string }) => {
      this.listSelector = data.selector;
    })
    this.socket.on('setPaginationMode', (data: { pagination: boolean }) => {
      this.paginationMode = data.pagination;
    })
  }

  /**
   * Registers the event handlers for all generator-related events on the socket.
   * @param socket The socket used to communicate with the client.
   * @private
   */
  private registerEventHandlers = (socket: Socket) => {
    socket.on('save', (data) => {
      const { fileName, userId, isLogin } = data;
      logger.log('debug', `Saving workflow ${fileName} for user ID ${userId}`);
      this.saveNewWorkflow(fileName, userId, isLogin);
  });
    socket.on('new-recording', () => this.workflowRecord = {
      workflow: [],
    });
    socket.on('activeIndex', (data) => this.generatedData.lastIndex = parseInt(data));
    socket.on('decision', async ({ pair, actionType, decision }) => {
      const id = browserPool.getActiveBrowserId();
      if (id) {
        // const activeBrowser = browserPool.getRemoteBrowser(id);
        // const currentPage = activeBrowser?.getCurrentPage();
        if (!decision) {
          switch (actionType) {
            case 'customAction':
              // pair.where.selectors = [this.generatedData.lastUsedSelector];
              pair.where.selectors = pair.where.selectors.filter(
                (selector: string) => selector !== this.generatedData.lastUsedSelector
              );
              break;
            default: break;
          }
        }
        // if (currentPage) {
        //   await this.addPairToWorkflowAndNotifyClient(pair, currentPage);
        // }
      }
    })
    socket.on('updatePair', (data) => {
      this.updatePairInWorkflow(data.index, data.pair);
    })
  };

  private async getSelectorsForSchema(page: Page, schema: Record<string, { selector: string }>): Promise<string[]> {
    const selectors = Object.values(schema).map((field) => field.selector);
    
    // Verify if the selectors are present and actionable on the current page
    const actionableSelectors: string[] = [];
    for (const selector of selectors) {
      const isActionable = await page.isVisible(selector).catch(() => false);
      if (isActionable) {
        actionableSelectors.push(selector);
      }
    }
    return actionableSelectors;
  }

  /**
   * Adds a newly generated pair to the workflow and notifies the client about it by
   * sending the updated workflow through socket.
   *
   * Checks some conditions for the correct addition of the pair.
   * 1. The pair's action selector is already in the workflow as a different pair's where selector
   *    If so, the what part of the pair is added to the pair with the same where selector.
   * 2. The pair's where selector is located on the page at the same time as another pair's where selector,
   * having the same url. This state is called over-shadowing an already existing pair.
   *   If so, the pair is merged with the previous over-shadowed pair - what part is attached and
   *   new selector added to the where selectors. In case the over-shadowed pair is further down the
   *   workflow array, the new pair is added to the beginning of the workflow array.
   *
   * This function also makes sure to add a waitForLoadState and a generated flag
   * action after every new action or pair added. The [waitForLoadState](https://playwright.dev/docs/api/class-frame#frame-wait-for-load-state)
   * action waits for the networkidle event to be fired,
   * and the generated flag action is used for making pausing the interpretation possible.
   *
   * @param pair The pair to add to the workflow.
   * @param page The page to use for the state checking.
   * @private
   * @returns {Promise<void>}
   */
  private addPairToWorkflowAndNotifyClient = async (pair: WhereWhatPair, page: Page) => {
    let matched = false;
  
    // Check for scrapeSchema actions and enhance the where condition
    if (pair.what[0].action === 'scrapeSchema') {
      const schema = pair.what[0]?.args?.[0];
      if (schema) {
        const additionalSelectors = await this.getSelectorsForSchema(page, schema);
        pair.where.selectors = [...(pair.where.selectors || []), ...additionalSelectors];
      }
    }
  
    // Validate if the pair is already in the workflow
    if (pair.where.selectors && pair.where.selectors[0]) {
      const match = selectorAlreadyInWorkflow(pair.where.selectors[0], this.workflowRecord.workflow);
      if (match) {
        const matchedIndex = this.workflowRecord.workflow.indexOf(match);
        if (pair.what[0].action !== 'waitForLoadState' && pair.what[0].action !== 'press') {
          pair.what.push({
            action: 'waitForLoadState',
            args: ['networkidle'],
          });
        }
        this.workflowRecord.workflow[matchedIndex].what = this.workflowRecord.workflow[matchedIndex].what.concat(pair.what);
        matched = true;
      }
    }
  
    // Handle cases where the where condition isn't already present
    if (!matched) {
      const handled = await this.handleOverShadowing(pair, page, this.generatedData.lastIndex || 0);
      if (!handled) {
        if (pair.what[0].action !== 'waitForLoadState' && pair.what[0].action !== 'press') {
          pair.what.push({
            action: 'waitForLoadState',
            args: ['networkidle'],
          });
        }
        if (this.generatedData.lastIndex === 0) {
          this.generatedData.lastIndex = null;
          this.workflowRecord.workflow.unshift(pair);
        } else {
          this.workflowRecord.workflow.splice(this.generatedData.lastIndex || 0, 0, pair);
          if (this.generatedData.lastIndex) {
            this.generatedData.lastIndex -= 1;
          }
        }
      }
    }
  
    // Emit the updated workflow to the client
    this.socket.emit('workflow', this.workflowRecord);
    logger.log('info', `Workflow emitted`);
  };
  
  public onDateSelection = async (page: Page, data: DatePickerEventData) => {
    const { selector, value } = data;

    try {
      await page.fill(selector, value);
    } catch (error) {
        console.error("Failed to fill date value:", error);
    }
    
    const pair: WhereWhatPair = {
        where: { url: this.getBestUrl(page.url()) },
        what: [{
            action: 'fill',
            args: [selector, value],
        }],
    };

    await this.addPairToWorkflowAndNotifyClient(pair, page);
  };

  public onDropdownSelection = async (page: Page, data: { selector: string, value: string }) => {
    const { selector, value } = data;

    try {
      await page.selectOption(selector, value);
    } catch (error) {
        console.error("Failed to fill date value:", error);
    }
    
    const pair: WhereWhatPair = {
        where: { url: this.getBestUrl(page.url()) },
        what: [{
            action: 'selectOption',
            args: [selector, value],
        }],
    };

    await this.addPairToWorkflowAndNotifyClient(pair, page);
  };

  public onTimeSelection = async (page: Page, data: { selector: string, value: string }) => {
    const { selector, value } = data;

    try {
        await page.fill(selector, value);
    } catch (error) {
        console.error("Failed to set time value:", error);
    }
    
    const pair: WhereWhatPair = {
        where: { url: this.getBestUrl(page.url()) },
        what: [{
            action: 'fill',
            args: [selector, value],
        }],
    };

    await this.addPairToWorkflowAndNotifyClient(pair, page);
  };

  public onDateTimeLocalSelection = async (page: Page, data: { selector: string, value: string }) => {
    const { selector, value } = data;
    
    try {
        await page.fill(selector, value);
    } catch (error) {
        console.error("Failed to fill datetime-local value:", error);
    }
    
    const pair: WhereWhatPair = {
        where: { url: this.getBestUrl(page.url()) },
        what: [{
            action: 'fill',
            args: [selector, value],
        }],
    };

    await this.addPairToWorkflowAndNotifyClient(pair, page);
  };

  /**
   * Generates a pair for the click event.
   * @param coordinates The coordinates of the click event.
   * @param page The page to use for obtaining the needed data.
   * @returns {Promise<void>}
   */
  public onClick = async (coordinates: Coordinates, page: Page) => {
    let where: WhereWhatPair["where"] = { url: this.getBestUrl(page.url()) };
    const selector = await this.generateSelector(page, coordinates, ActionType.Click);
    logger.log('debug', `Element's selector: ${selector}`);

    const elementInfo = await getElementInformation(page, coordinates, '', false);
    console.log("Element info: ", elementInfo);

    // Check if clicked element is a select dropdown
    const isDropdown = elementInfo?.tagName === 'SELECT';
    
    if (isDropdown && elementInfo.innerHTML) {
      // Parse options from innerHTML
      const options = elementInfo.innerHTML
        .split('<option')
        .slice(1) // Remove first empty element
        .map(optionHtml => {
          const valueMatch = optionHtml.match(/value="([^"]*)"/);
          const disabledMatch = optionHtml.includes('disabled="disabled"');
          const selectedMatch = optionHtml.includes('selected="selected"');
          
          // Extract text content between > and </option>
          const textMatch = optionHtml.match(/>([^<]*)</);
          const text = textMatch 
            ? textMatch[1]
                .replace(/\n/g, '') // Remove all newlines
                .replace(/\s+/g, ' ') // Replace multiple spaces with single space
                .trim()
            : '';
          
          return {
              value: valueMatch ? valueMatch[1] : '',
              text,
              disabled: disabledMatch,
              selected: selectedMatch
          };
        });

      // Notify client to show dropdown overlay
      this.socket.emit('showDropdown', {
          coordinates,
          selector,
          options
      });
      return;
    }

    // Check if clicked element is a date input
    const isDateInput = elementInfo?.tagName === 'INPUT' && elementInfo?.attributes?.type === 'date';

    if (isDateInput) {
      // Notify client to show datepicker overlay
      this.socket.emit('showDatePicker', {
          coordinates,
          selector
      });
      return; 
    }

    const isTimeInput = elementInfo?.tagName === 'INPUT' && elementInfo?.attributes?.type === 'time';

    if (isTimeInput) {
      this.socket.emit('showTimePicker', {
          coordinates,
          selector
      });
      return;
    }

    const isDateTimeLocal = elementInfo?.tagName === 'INPUT' && elementInfo?.attributes?.type === 'datetime-local';

    if (isDateTimeLocal) {
      this.socket.emit('showDateTimePicker', {
          coordinates,
          selector
      });
      return;
    }

    if ((elementInfo?.tagName === 'INPUT' || elementInfo?.tagName === 'TEXTAREA') && selector) {
      // Calculate the exact position within the element
      const positionAndCursor = await page.evaluate(
        ({ selector, coords }) => {
            const element = document.querySelector(selector);
            if (!element) return null;
            
            const getCursorPosition = (inputElement: HTMLInputElement | HTMLTextAreaElement, clickCoords: Coordinates) => {
                const position = inputElement.selectionStart || 0;
                return position;
            };
    
            const rect = element.getBoundingClientRect();
            const cursorIndex = getCursorPosition(element as HTMLInputElement | HTMLTextAreaElement, coords);
            
            return {
                rect: {
                    x: rect.left,
                    y: rect.top
                },
                cursorIndex
            };
        },
        { selector, coords: coordinates } 
    );

      if (positionAndCursor) {
        const relativeX = coordinates.x - positionAndCursor.rect.x;
        const relativeY = coordinates.y - positionAndCursor.rect.y;

        const pair: WhereWhatPair = {
            where,
            what: [{
                action: 'click',
                args: [selector, { position: { x: relativeX, y: relativeY } }, { cursorIndex: positionAndCursor.cursorIndex }],
            }]
        };

        if (selector) {
            this.generatedData.lastUsedSelector = selector;
            this.generatedData.lastAction = 'click';
        }

        await this.addPairToWorkflowAndNotifyClient(pair, page);
        return;
      }
    }

    //const element = await getElementMouseIsOver(page, coordinates);
    //logger.log('debug', `Element: ${JSON.stringify(element, null, 2)}`);
    if (selector) {
      where.selectors = [selector];
    }
    const pair: WhereWhatPair = {
      where,
      what: [{
        action: 'click',
        args: [selector],
      }],
    }
    if (selector) {
      this.generatedData.lastUsedSelector = selector;
      this.generatedData.lastAction = 'click';
    }
    await this.addPairToWorkflowAndNotifyClient(pair, page);
  };

  /**
   * Generates a pair for the change url event.
   * @param newUrl The new url to be changed to.
   * @param page The page to use for obtaining the needed data.
   * @returns {Promise<void>}
   */
  public onChangeUrl = async (newUrl: string, page: Page) => {
    this.generatedData.lastUsedSelector = '';
    const pair: WhereWhatPair = {
      where: { url: this.getBestUrl(page.url()) },
      what: [
        {
          action: 'goto',
          args: [newUrl],
        }
      ],
    }
    await this.addPairToWorkflowAndNotifyClient(pair, page);
  };

  /**
   * Generates a pair for the keypress event.
   * @param key The key to be pressed.
   * @param coordinates The coordinates of the keypress event.
   * @param page The page to use for obtaining the needed data.
   * @returns {Promise<void>}
   */
  public onKeyboardInput = async (key: string, coordinates: Coordinates, page: Page) => {
    let where: WhereWhatPair["where"] = { url: this.getBestUrl(page.url()) };
    const selector = await this.generateSelector(page, coordinates, ActionType.Keydown);

    const elementInfo = await getElementInformation(page, coordinates, '', false);
    const inputType = elementInfo?.attributes?.type || "text";

    if (selector) {
      where.selectors = [selector];
    }
    const pair: WhereWhatPair = {
      where,
      what: [{
        action: 'press',
        args: [selector, encrypt(key), inputType],
      }],
    }
    if (selector) {
      this.generatedData.lastUsedSelector = selector;
      this.generatedData.lastAction = 'press';
    }
    await this.addPairToWorkflowAndNotifyClient(pair, page);
  };

  /**
   * Returns tag name and text content for the specified selector
   * used in customAction for decision modal
   */
  private async getLastUsedSelectorInfo(page: Page, selector: string) {
    const elementHandle = await page.$(selector);
    if (elementHandle) {
      const tagName = await elementHandle.evaluate(el => (el as HTMLElement).tagName);
      // TODO: based on tagName, send data. Always innerText won't hold true. For now, can roll. 
      const innerText = await elementHandle.evaluate(el => (el as HTMLElement).innerText);

      return { tagName, innerText };
    }
    return { tagName: '', innerText: '' };
  }

  /**
   * Generates a pair for the custom action event.
   * @param action The type of the custom action.
   * @param settings The settings of the custom action.
   * @param page The page to use for obtaining the needed data.
   */
  public customAction = async (action: CustomActions, settings: any, page: Page) => {
    const pair: WhereWhatPair = {
      where: { url: this.getBestUrl(page.url()) },
      what: [{
        action,
        args: settings ? Array.isArray(settings) ? settings : [settings] : [],
      }],
    }

    await this.addPairToWorkflowAndNotifyClient(pair, page);

    if (this.generatedData.lastUsedSelector) {
      const elementInfo = await this.getLastUsedSelectorInfo(page, this.generatedData.lastUsedSelector);

      this.socket.emit('decision', {
        pair, actionType: 'customAction',
        lastData: {
          selector: this.generatedData.lastUsedSelector,
          action: this.generatedData.lastAction,
          tagName: elementInfo.tagName,
          innerText: elementInfo.innerText,
        }
      });
    } 
  };

  /**
   * Returns the currently generated workflow.
   * @returns {WorkflowFile}
   */
  public getWorkflowFile = () => {
    return this.workflowRecord;
  };

  /**
   * Removes a pair from the currently generated workflow.
   * @param index The index of the pair to be removed.
   * @returns void
   */
  public removePairFromWorkflow = (index: number) => {
    if (index <= this.workflowRecord.workflow.length && index >= 0) {
      this.workflowRecord.workflow.splice(this.workflowRecord.workflow.length - (index + 1), 1);
      logger.log('debug', `pair ${index}: Removed from workflow file.`);
    } else {
      logger.log('error', `Delete pair ${index}: Index out of range.`);
    }
  };

  /**
   * Adds a new pair to the currently generated workflow.
   * @param index The index on which the pair should be added.
   * @param pair The pair to be added.
   * @returns void
   */
  public addPairToWorkflow = (index: number, pair: WhereWhatPair) => {
    if (index === this.workflowRecord.workflow.length) {
      this.workflowRecord.workflow.unshift(pair);
      logger.log('debug', `pair ${index}: Added to workflow file.`);
    } else if (index < this.workflowRecord.workflow.length && index >= 0) {
      this.workflowRecord.workflow.splice(
        this.workflowRecord.workflow.length - index, 0, pair);
    } else {
      logger.log('error', `Add pair ${index}: Index out of range.`);
    }
  };

  /**
   * Updates a pair in the currently generated workflow.
   * @param index The index of the pair to be updated.
   * @param pair The pair to be used as a replacement.
   * @returns void
   */
  public updatePairInWorkflow = (index: number, pair: WhereWhatPair) => {
    if (index <= this.workflowRecord.workflow.length && index >= 0) {
      this.workflowRecord.workflow[this.workflowRecord.workflow.length - (index + 1)] = pair;
    } else {
      logger.log('error', `Update pair ${index}: Index out of range.`);
    }
  };

  /**
   * Updates the socket used for communication with the client.
   * @param socket The socket to be used for communication.
   * @returns void
   */
  public updateSocket = (socket: Socket): void => {
    this.socket = socket;
    this.registerEventHandlers(socket);
  };

  /**
   * Returns the currently generated workflow without all the generated flag actions.
   * @param workflow The workflow for removing the generated flag actions from.
   * @private
   * @returns {WorkflowFile}
   */
  private removeAllGeneratedFlags = (workflow: WorkflowFile): WorkflowFile => {
    for (let i = 0; i < workflow.workflow.length; i++) {
      if (
        workflow.workflow[i].what[0] &&
        workflow.workflow[i].what[0].action === 'flag' &&
        workflow.workflow[i].what[0].args?.includes('generated')) {
        workflow.workflow[i].what.splice(0, 1);
      }
    }
    return workflow;
  };

  /**
   * Adds generated flag actions to the workflow's pairs' what conditions.
   * @param workflow The workflow for adding the generated flag actions from.
   * @private
   * @returns {WorkflowFile}
   */
  public AddGeneratedFlags = (workflow: WorkflowFile): WorkflowFile => {
    const copy = JSON.parse(JSON.stringify(workflow));
    for (let i = 0; i < workflow.workflow.length; i++) {
      copy.workflow[i].what.unshift({
        action: 'flag',
        args: ['generated'],
      });
    }
    return copy;
  };

  /**
   * Enables to update the generated workflow file.
   * Adds a generated flag action for possible pausing during the interpretation.
   * Used for loading a recorded workflow to already initialized Generator.
   * @param workflowFile The workflow file to be used as a replacement for the current generated workflow.
   * @returns void
   */
  public updateWorkflowFile = (workflowFile: WorkflowFile, meta: MetaData) => {
    this.recordingMeta = meta;
    const params = this.checkWorkflowForParams(workflowFile);
    if (params) {
      this.recordingMeta.params = params;
    }
    this.workflowRecord = workflowFile;
  }

  /**
   * Creates a recording metadata and stores the curren workflow
   * with the metadata to the file system.
   * @param fileName The name of the file.
   * @returns {Promise<void>}
   */
  public saveNewWorkflow = async (fileName: string, userId: number, isLogin: boolean) => {
    for (const pair of this.workflowRecord.workflow) {
      for (let i = 0; i < pair.what.length; i++) {
        const condition = pair.what[i];

        if (condition.action === 'press' && condition.args) {
          const [selector, encryptedKey, type] = condition.args;
          const key = decrypt(encryptedKey);

          console.log(`Selector: ${selector}, Key: ${key}`);
        }

        if (condition.action === 'click' && condition.args) {
          console.log("Click args: ", condition.args);
        }
      }
    }

    const recording = this.optimizeWorkflow(this.workflowRecord);
    try {
      this.recordingMeta = {
        name: fileName,
        id: uuid(),
        createdAt: this.recordingMeta.createdAt || new Date().toLocaleString(),
        pairs: recording.workflow.length,
        updatedAt: new Date().toLocaleString(),
        params: this.getParams() || [],
        isLogin: isLogin,
      }
      const robot = await Robot.create({
        userId,
        recording_meta: this.recordingMeta,
        recording: recording,
      });
      capture(
        'maxun-oss-robot-created',
        {
          robot_meta: robot.recording_meta,
          recording: robot.recording,
        }
      )

      logger.log('info', `Robot saved with id: ${robot.id}`);
    }
    catch (e) {
      const { message } = e as Error;
      logger.log('warn', `Cannot save the file to the local file system ${e}`)
    }
    this.socket.emit('fileSaved');
  }

  /**
   * Uses a system of functions to generate a correct and unique css selector
   * according to the action being performed.
   * @param page The page to be used for obtaining the information and selector.
   * @param coordinates The coordinates of the element.
   * @param action The action for which the selector is being generated.
   * @private
   * @returns {Promise<string|null>}
   */
  private generateSelector = async (page: Page, coordinates: Coordinates, action: ActionType) => {
    const elementInfo = await getElementInformation(page, coordinates, this.listSelector, this.getList);
    const selectorBasedOnCustomAction = (this.getList === true)
      ? await getNonUniqueSelectors(page, coordinates, this.listSelector)
      : await getSelectors(page, coordinates);
    
    if (this.paginationMode && selectorBasedOnCustomAction) {
      // Chain selectors in specific priority order
      const selectors = selectorBasedOnCustomAction;
      const selectorChain = [
        selectors?.iframeSelector?.full,
        selectors?.shadowSelector?.full,
        selectors?.testIdSelector,
        selectors?.id,
        selectors?.hrefSelector,
        selectors?.accessibilitySelector,
        selectors?.attrSelector,
        selectors?.generalSelector
      ]
        .filter(selector => selector !== null && selector !== undefined)
        .join(',');
  
      return selectorChain;
    }

    const bestSelector = getBestSelectorForAction(
      {
        type: action,
        tagName: elementInfo?.tagName as TagName || '',
        inputType: undefined,
        value: undefined,
        selectors: selectorBasedOnCustomAction || {},
        timestamp: 0,
        isPassword: false,
        hasOnlyText: elementInfo?.hasOnlyText || false,
      } as Action,
    );
    return bestSelector;
  }

  /**
   * Generates data for highlighting the element on client side and emits the
   * highlighter event to the client.
   * @param page The page to be used for obtaining data.
   * @param coordinates The coordinates of the element.
   * @returns {Promise<void>}
   */
  public generateDataForHighlighter = async (page: Page, coordinates: Coordinates) => {
    const rect = await getRect(page, coordinates, this.listSelector, this.getList);
    const displaySelector = await this.generateSelector(page, coordinates, ActionType.Click);
    const elementInfo = await getElementInformation(page, coordinates, this.listSelector, this.getList);
    if (rect) {
      const highlighterData = {
        rect,
        selector: displaySelector,
        elementInfo,
        // Include shadow DOM specific information
        shadowInfo: elementInfo?.isShadowRoot ? {
          mode: elementInfo.shadowRootMode,
          content: elementInfo.shadowRootContent
        } : null
      };

      if (this.getList === true) {
        if (this.listSelector !== '') {
          const childSelectors = await getChildSelectors(page, this.listSelector || '');
          this.socket.emit('highlighter', { ...highlighterData, childSelectors })
        } else {
          this.socket.emit('highlighter', { ...highlighterData });
        }
      } else {
        this.socket.emit('highlighter', { ...highlighterData });
      }
    }
  }

  /**
   * Notifies the client about the change of the url if navigation
   * happens after some performed action.
   * @param url The new url.
   * @param fromNavBar Whether the navigation is from the simulated browser's navbar or not.
   * @returns void
   */
  public notifyUrlChange = (url: string) => {
    if (this.socket) {
      this.socket.emit('urlChanged', url);
    }
  }

  /**
   * Notifies the client about the new tab if popped-up
   * @param page The page to be used for obtaining data.
   * @param pageIndex The index of the page.
   * @returns void
   */
  public notifyOnNewTab = (page: Page, pageIndex: number) => {
    if (this.socket) {
      page.on('close', () => {
        this.socket.emit('tabHasBeenClosed', pageIndex);
      })
      const parsedUrl = new URL(page.url());
      const host = parsedUrl.hostname?.match(/\b(?!www\.)[a-zA-Z0-9]+/g)?.join('.');
      this.socket.emit('newTab', host ? host : 'new tab')
    }
  }

  /**
   * Generates a pair for navigating to the previous page.
   * This function alone adds the pair to the workflow and notifies the client.
   * It's safe to always add a go back action to the first rule in the workflow and do not check
   * general conditions for adding a pair to the workflow.
   * @param newUrl The previous page's url.
   * @returns void
   */
  public onGoBack = (newUrl: string) => {
    //it's safe to always add a go back action to the first rule in the workflow
    this.workflowRecord.workflow[0].what.push({
      action: 'goBack',
      args: [{ waitUntil: 'commit' }],
    });
    this.notifyUrlChange(newUrl);
    this.socket.emit('workflow', this.workflowRecord);
  }

  /**
   * Generates a pair for navigating to the next page.
   * This function alone adds the pair to the workflow and notifies the client.
   * It's safe to always add a go forward action to the first rule in the workflow and do not check
   * general conditions for adding a pair to the workflow.
   * @param newUrl The next page's url.
   * @returns void
   */
  public onGoForward = (newUrl: string) => {
    //it's safe to always add a go forward action to the first rule in the workflow
    this.workflowRecord.workflow[0].what.push({
      action: 'goForward',
      args: [{ waitUntil: 'commit' }],
    });
    this.notifyUrlChange(newUrl);
    this.socket.emit('workflow', this.workflowRecord);
  }

  /**
   * Checks and returns possible pairs that would get over-shadowed by the pair
   * from the current workflow.
   * @param pair The pair that could be over-shadowing.
   * @param page The page to be used for checking the visibility and accessibility of the selectors.
   * @private
   * @returns {Promise<PossibleOverShadow[]>}
   */
  private IsOverShadowingAction = async (pair: WhereWhatPair, page: Page) => {
    type possibleOverShadow = {
      index: number;
      isOverShadowing: boolean;
    }

    const possibleOverShadow: possibleOverShadow[] = [];
    const haveSameUrl = this.workflowRecord.workflow
      .filter((p, index) => {
        if (p.where.url === pair.where.url) {
          possibleOverShadow.push({ index: index, isOverShadowing: false });
          return true;
        } else {
          return false;
        }
      });

    if (haveSameUrl.length !== 0) {
      for (let i = 0; i < haveSameUrl.length; i++) {
        //@ts-ignore
        if (haveSameUrl[i].where.selectors && haveSameUrl[i].where.selectors.length > 0) {
          //@ts-ignore
          const isOverShadowing = await isRuleOvershadowing(haveSameUrl[i].where.selectors, page);
          if (isOverShadowing) {
            possibleOverShadow[i].isOverShadowing = true;
          }
        }
      }
    }
    return possibleOverShadow;
  }


  /**
   * General over-shadowing handler.
   * Checks for possible over-shadowed pairs and if found,
   * adds the pair to the workflow in the correct way.
   * @param pair The pair that could be over-shadowing.
   * @param page The page to be used for checking the visibility and accessibility of the selectors.
   * @private
   * @returns {Promise<boolean>}
   */
  private handleOverShadowing = async (pair: WhereWhatPair, page: Page, index: number): Promise<boolean> => {
    const overShadowing = (await this.IsOverShadowingAction(pair, page))
      .filter((p) => p.isOverShadowing);
    if (overShadowing.length !== 0) {
      for (const overShadowedAction of overShadowing) {
        if (overShadowedAction.index === index) {
          if (pair.where.selectors) {
            for (const selector of pair.where.selectors) {
              if (this.workflowRecord.workflow[index].where.selectors?.includes(selector)) {
                break;
              } else {
                // add new selector to the where part of the overshadowing pair
                this.workflowRecord.workflow[index].where.selectors?.push(selector);
              }
            }
          }
          // push the action automatically to the first/the closest rule which would be overShadowed
          this.workflowRecord.workflow[index].what =
            this.workflowRecord.workflow[index].what.concat(pair.what);
          return true;
        } else {
          // notify client about overshadowing a further rule
          return false;
        }
      }
    }
    return false;
  }

  /**
   * Returns the best possible url representation for a where condition according to the heuristics.
   * @param url The url to be checked and possibly replaced.
   * @private
   * @returns {string | {$regex: string}}
   */
  private getBestUrl = (url: string) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:' ? `${parsedUrl.protocol}//` : parsedUrl.protocol;
    const regex = new RegExp(/(?=.*[A-Z])/g)
    // remove all params with uppercase letters, they are most likely dynamically generated
    // also escapes all regex characters from the params
    const search = parsedUrl.search
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .split('&').map((param, index) => {
        if (!regex.test(param)) {
          return param;
        } else {
          return '.*';
        }
      })
      .join('&');
    let bestUrl;
    if (search) {
      bestUrl = {
        $regex: `^${protocol}${parsedUrl.host}${parsedUrl.pathname}${search}${parsedUrl.hash}`
      }
    } else {
      bestUrl = `${protocol}${parsedUrl.host}${parsedUrl.pathname}${parsedUrl.hash}`;
    }
    return bestUrl;
  }

  /**
   * Returns parameters if present in the workflow or null.
   * @param workflow The workflow to be checked.
   */
  private checkWorkflowForParams = (workflow: WorkflowFile): string[] | null => {
    // for now the where condition cannot have any params, so we're checking only what part of the pair
    // where only the args part of what condition can have a parameter
    for (const pair of workflow.workflow) {
      for (const condition of pair.what) {
        if (condition.args) {
          const params: any[] = [];
          condition.args.forEach((arg) => {
            if (arg.$param) {
              params.push(arg.$param);
            }
          })
          if (params.length !== 0) {
            return params;
          }
        }
      }
    }
    return null;
  }

  /**
   * A function for workflow optimization once finished.
   * @param workflow The workflow to be optimized.
   */
  private optimizeWorkflow = (workflow: WorkflowFile) => {
    // Enhanced input state to include cursor position
    let input = {
      selector: '',
      value: '',
      type: '',
      actionCounter: 0,
      cursorPosition: -1  // Track cursor position, -1 means end of text
    };
  
    const pushTheOptimizedAction = (pair: WhereWhatPair, index: number) => {
      if (input.value.length === 1) {
        // Single character - keep as is with waitForLoadState
        pair.what.splice(index + 1, 0, {
          action: 'waitForLoadState',
          args: ['networkidle'],
        });
      } else {
        // Multiple characters - optimize to type action
        pair.what.splice(index - input.actionCounter, input.actionCounter, {
          action: 'type',
          args: [input.selector, encrypt(input.value), input.type],
        }, {
          action: 'waitForLoadState',
          args: ['networkidle'],
        });
      }
    };
  
    for (const pair of workflow.workflow) {
      for (let i = 0; i < pair.what.length; i++) {
        const condition = pair.what[i];
  
        // Handle click actions that set cursor position
        if (condition.action === 'click' && condition.args?.[1]) {
          const cursorIndex = condition.args[1].cursorIndex;
  
          // If we have pending input, commit it before processing the click
          if (input.value.length > 0) {
            pushTheOptimizedAction(pair, i);
            input = {
              selector: '',
              value: '',
              type: '',
              actionCounter: 0,
              cursorPosition: -1
            };
          }
  
          // Update cursor position for next operations
          input.cursorPosition = cursorIndex;
          continue;
        }
  
        // Handle text input and editing
        if (condition.action === 'press' && condition.args?.[1]) {
          const [selector, encryptedKey, type] = condition.args;
          const key = decrypt(encryptedKey);
  
          // Initialize new input state if selector changes
          if (!input.selector || input.selector !== selector) {
            if (input.value.length > 0) {
              pushTheOptimizedAction(pair, i);
            }
            input = {
              selector,
              value: '',
              type: type || 'text',
              actionCounter: 0,
              cursorPosition: -1
            };
          }
  
          input.actionCounter++;
  
          // Handle different key types with cursor awareness
          if (key.length === 1) {
            // Insert character at cursor position or append if no cursor set
            if (input.cursorPosition === -1) {
              // No cursor position set, append to end
              input.value += key;
            } else {
              // Insert at cursor position
              input.value = 
                input.value.slice(0, input.cursorPosition) +
                key +
                input.value.slice(input.cursorPosition);
              input.cursorPosition++;
            }
          } else if (key === 'Backspace') {
            if (input.cursorPosition > 0) {
              // Delete character before cursor
              input.value = 
                input.value.slice(0, input.cursorPosition - 1) +
                input.value.slice(input.cursorPosition);
              input.cursorPosition--;
            } else if (input.cursorPosition === -1 && input.value.length > 0) {
              // No cursor position set, delete from end
              input.value = input.value.slice(0, -1);
            }
          } else if (key !== 'Shift') {
            // Handle other special keys
            if (input.value.length > 0) {
              pushTheOptimizedAction(pair, i);
              input = {
                selector: '',
                value: '',
                type: '',
                actionCounter: 0,
                cursorPosition: -1
              };
            }
          }
        } else {
          // Handle non-text actions
          if (input.value.length > 0) {
            pushTheOptimizedAction(pair, i);
            input = {
              selector: '',
              value: '',
              type: '',
              actionCounter: 0,
              cursorPosition: -1
            };
          }
        }
      }
  
      // Clean up any remaining input state
      if (input.value.length > 0) {
        pushTheOptimizedAction(pair, pair.what.length);
        input = {
          selector: '',
          value: '',
          type: '',
          actionCounter: 0,
          cursorPosition: -1
        };
      }
    }
  
    return workflow;
  };

  /**
   * Returns workflow params from the stored metadata.
   */
  public getParams = (): string[] | null => {
    return this.checkWorkflowForParams(this.workflowRecord);
  }

  /**
   * Clears the last generated data index.
   */
  public clearLastIndex = () => {
    this.generatedData.lastIndex = null;
  }
}