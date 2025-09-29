import Interpreter, { WorkflowFile } from "maxun-core";
import logger from "../../logger";
import { Socket } from "socket.io";
import { Page } from "playwright";
import { InterpreterSettings } from "../../types";
import { decrypt } from "../../utils/auth";
import Run from "../../models/Run";

/**
 * Decrypts any encrypted inputs in the workflow. If checkLimit is true, it will also handle the limit validation for scrapeList action.
 * @param workflow The workflow to decrypt.
 * @param checkLimit If true, it will handle the limit validation for scrapeList action.
 */
function processWorkflow(workflow: WorkflowFile, checkLimit: boolean = false): WorkflowFile {
  const processedWorkflow = JSON.parse(JSON.stringify(workflow)) as WorkflowFile;

  processedWorkflow.workflow.forEach((pair) => {
    pair.what.forEach((action) => {
      // Handle limit validation for scrapeList action
      if (action.action === 'scrapeList' && checkLimit && Array.isArray(action.args) && action.args.length > 0) {
        const scrapeConfig = action.args[0];
        if (scrapeConfig && typeof scrapeConfig === 'object' && 'limit' in scrapeConfig) {
          if (typeof scrapeConfig.limit === 'number' && scrapeConfig.limit > 5) {
            scrapeConfig.limit = 5;
          }
        }
      }

      // Handle decryption for type and press actions
      if ((action.action === 'type' || action.action === 'press') && Array.isArray(action.args) && action.args.length > 1) {
        try {
          const encryptedValue = action.args[1];
          if (typeof encryptedValue === 'string') {
            const decryptedValue = decrypt(encryptedValue);
            action.args[1] = decryptedValue;
          } else {
            logger.log('error', 'Encrypted value is not a string');
            action.args[1] = '';
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.log('error', `Failed to decrypt input value: ${errorMessage}`);
          action.args[1] = '';
        }
      }
    });
  });

  return processedWorkflow;
}

/**
 * This class implements the main interpretation functions.
 * It holds some information about the current interpretation process and
 * registers to some events to allow the client (frontend) to interact with the interpreter.
 * It uses the [maxun-core](https://www.npmjs.com/package/maxun-core)
 * library to interpret the workflow.
 * @category WorkflowManagement
 */
export class WorkflowInterpreter {
  /**
   * Socket.io socket instance enabling communication with the client (frontend) side.
   * @private
   */
  private socket: Socket;

  /**
   * True if the interpretation is paused.
   */
  public interpretationIsPaused: boolean = false;

  /**
   * The instance of the {@link Interpreter} class used to interpret the workflow.
   * From maxun-core.
   * @private
   */
  private interpreter: Interpreter | null = null;

  /**
   * An id of the currently interpreted pair in the workflow.
   * @private
   */
  private activeId: number | null = null;

  /**
   * An array of debug messages emitted by the {@link Interpreter}.
   */
  public debugMessages: string[] = [];

  /**
   * Storage for different types of serializable data
   */
  public serializableDataByType: {
    scrapeSchema: any[],
    scrapeList: any[],
  } = {
    scrapeSchema: [],
    scrapeList: [],
  };

  /**
   * Track the current action type being processed
   */
  private currentActionType: string | null = null;

  /**
   * An array of all the binary data extracted from the run.
   */
  public binaryData: { mimetype: string, data: string }[] = [];

  /**
   * Track current scrapeList index
   */
  private currentScrapeListIndex: number = 0;

  /**
   * Current run ID for real-time persistence
   */
  private currentRunId: string | null = null;

  /**
   * Batched persistence system for performance optimization
   */
  private persistenceBuffer: Array<{
    actionType: string;
    data: any;
    listIndex?: number;
    timestamp: number;
    creditValidated: boolean;
  }> = [];

  private persistenceTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 5;
  private readonly BATCH_TIMEOUT = 3000;
  private persistenceInProgress = false;
  private persistenceRetryCount = 0;

  /**
   * An array of id's of the pairs from the workflow that are about to be paused.
   * As "breakpoints".
   * @private
   */
  private breakpoints: boolean[] = [];

  /**
   * Callback to resume the interpretation after a pause.
   * @private
   */
  private interpretationResume: (() => void) | null = null;

  /**
   * A public constructor taking a socket instance for communication with the client.
   * @param socket Socket.io socket instance enabling communication with the client (frontend) side.
   * @param runId Optional run ID for real-time data persistence
   * @constructor
   */
  constructor(socket: Socket, runId?: string) {
    this.socket = socket;
    this.currentRunId = runId || null;
  }

  /**
   * Subscribes to the events that are used to control the interpretation.
   * The events are pause, resume, step and breakpoints.
   * Step is used to interpret a single pair and pause on the other matched pair.
   * @returns void
   */
  public subscribeToPausing = () => {
    this.socket.on('pause', () => {
      this.interpretationIsPaused = true;
    });
    this.socket.on('resume', () => {
      this.interpretationIsPaused = false;
      if (this.interpretationResume) {
        this.interpretationResume();
        this.socket.emit('log', '----- The interpretation has been resumed -----', false);
      } else {
        logger.log('debug', "Resume called but no resume function is set");
      }
    });
    this.socket.on('step', () => {
      if (this.interpretationResume) {
        this.interpretationResume();
      } else {
        logger.log('debug', "Step called but no resume function is set");
      }
    });
    this.socket.on('breakpoints', (data: boolean[]) => {
      logger.log('debug', "Setting breakpoints: " + data);
      this.breakpoints = data
    });
  }

  /**
   * Sets up the instance of {@link Interpreter} and interprets
   * the workflow inside the recording editor.
   * Cleans up this interpreter instance after the interpretation is finished.
   * @param workflow The workflow to interpret.
   * @param page The page instance used to interact with the browser.
   * @param updatePageOnPause A callback to update the page after a pause.
   * @returns {Promise<void>}
   */
  public interpretRecordingInEditor = async (
    workflow: WorkflowFile,
    page: Page,
    updatePageOnPause: (page: Page) => void,
    settings: InterpreterSettings,
  ) => {
    const params = settings.params ? settings.params : null;
    delete settings.params;
    
    const processedWorkflow = processWorkflow(workflow, true);
  
    const options = {
      ...settings,
      mode: 'editor',
      debugChannel: {
        activeId: (id: any) => {
          this.activeId = id;
          this.socket.emit('activePairId', id);
        },
        debugMessage: (msg: any) => {
          this.debugMessages.push(`[${new Date().toLocaleString()}] ` + msg);
          this.socket.emit('log', msg)
        },
        setActionType: (type: string) => {
          this.currentActionType = type;
        }
      },
      serializableCallback: async (data: any) => {
        if (this.currentActionType === 'scrapeSchema') {
          const cumulativeScrapeSchemaData = Array.isArray(data) && data.length > 0 ? data : [data];
          
          if (cumulativeScrapeSchemaData.length > 0) {
            await this.persistDataToDatabase('scrapeSchema', cumulativeScrapeSchemaData);
          }

          if (Array.isArray(data) && data.length > 0) {
            this.socket.emit('serializableCallback', { 
              type: 'captureText', 
              data 
            });
          } else {
            this.socket.emit('serializableCallback', { 
              type: 'captureText', 
              data : [data]
            });
          }
        } else if (this.currentActionType === 'scrapeList') {
          if (data && Array.isArray(data) && data.length > 0) {
            // Use the current index for persistence
            await this.persistDataToDatabase('scrapeList', data, this.currentScrapeListIndex);
          }

          this.socket.emit('serializableCallback', { 
            type: 'captureList', 
            data 
          });
        } 
      },
      binaryCallback: async (data: string, mimetype: string) => {
        const binaryItem = { mimetype, data: JSON.stringify(data) };
        this.binaryData.push(binaryItem);
        
        // Persist binary data to database
        await this.persistBinaryDataToDatabase(binaryItem);
        
        this.socket.emit('binaryCallback', { 
          data, 
          mimetype,
          type: 'captureScreenshot'
        });
      }
    }
  
    const interpreter = new Interpreter(processedWorkflow, options);
    this.interpreter = interpreter;
  
    interpreter.on('flag', async (page, resume) => {
      if (this.activeId !== null && this.breakpoints[this.activeId]) {
        logger.log('debug', `breakpoint hit id: ${this.activeId}`);
        this.socket.emit('breakpointHit');
        this.interpretationIsPaused = true;
      }
  
      if (this.interpretationIsPaused) {
        this.interpretationResume = resume;
        logger.log('debug', `Paused inside of flag: ${page.url()}`);
        updatePageOnPause(page);
        this.socket.emit('log', '----- The interpretation has been paused -----', false);
      } else {
        resume();
      }
    });
  
    this.socket.emit('log', '----- Starting the interpretation -----', false);
  
    const status = await interpreter.run(page, params);
  
    this.socket.emit('log', `----- The interpretation finished with status: ${status} -----`, false);
  
    logger.log('debug', `Interpretation finished`);
    this.interpreter = null;
    this.socket.emit('activePairId', -1);
    this.interpretationIsPaused = false;
    this.interpretationResume = null;
    this.socket.emit('finished');
  };

  /**
   * Stops the current process of the interpretation of the workflow.
   * @returns {Promise<void>}
   */
  public stopInterpretation = async () => {
    if (this.interpreter) {
      logger.log('info', 'Stopping the interpretation.');
      
      this.interpreter.abort();
      logger.log('info', 'maxun-core interpreter aborted - data collection stopped immediately');
      
      await this.interpreter.stop();
      this.socket.emit('log', '----- The interpretation has been stopped -----', false);
      await this.clearState();
    } else {
      logger.log('error', 'Cannot stop: No active interpretation.');
    }
  };

  public clearState = async (): Promise<void> => {
    if (this.persistenceBuffer.length > 0) {
      try {
        await this.flushPersistenceBuffer();
        logger.log('debug', 'Successfully flushed final persistence buffer during cleanup');
      } catch (error: any) {
        logger.log('error', `Failed to flush final persistence buffer: ${error.message}`);
      }
    }

    if (this.persistenceTimer) {
      clearTimeout(this.persistenceTimer);
      this.persistenceTimer = null;
    }

    if (this.interpreter) {
      try {
        if (!this.interpreter.getIsAborted()) {
          this.interpreter.abort();
        }
        await this.interpreter.stop();
        logger.log('debug', 'mx-cloud interpreter properly stopped during cleanup');
      } catch (error: any) {
        logger.log('warn', `Error stopping mx-cloud interpreter during cleanup: ${error.message}`);
      }
    }

    this.debugMessages = [];
    this.interpretationIsPaused = false;
    this.activeId = null;
    this.interpreter = null;
    this.breakpoints = [];
    this.interpretationResume = null;
    this.currentActionType = null;
    this.serializableDataByType = {
      scrapeSchema: [],
      scrapeList: [],
    };
    this.binaryData = [];
    this.currentScrapeListIndex = 0;
    this.currentRunId = null;
    this.persistenceBuffer = [];
    this.persistenceInProgress = false;
    this.persistenceRetryCount = 0;
  }

  /**
   * Sets the current run ID for real-time persistence.
   * @param runId The run ID to set
   */
  public setRunId = (runId: string): void => {
    this.currentRunId = runId;
    logger.log('debug', `Set run ID for real-time persistence: ${runId}`);
  };

  /**
   * Persists extracted data to database with intelligent batching for performance
   * Falls back to immediate persistence for critical operations
   * @private
   */
  private persistDataToDatabase = async (actionType: string, data: any, listIndex?: number): Promise<void> => {
    if (!this.currentRunId) {
      logger.log('debug', 'No run ID available for persistence');
      return;
    }

    this.addToPersistenceBatch(actionType, data, listIndex, true);

    if (actionType === 'scrapeSchema' || this.persistenceBuffer.length >= this.BATCH_SIZE) {
      await this.flushPersistenceBuffer();
    } else {
      this.scheduleBatchFlush();
    }
  };

  /**
   * Persists binary data to database in real-time
   * @private
   */
  private persistBinaryDataToDatabase = async (binaryItem: { mimetype: string, data: string }): Promise<void> => {
    if (!this.currentRunId) {
      logger.log('debug', 'No run ID available for binary data persistence');
      return;
    }

    try {
      const run = await Run.findOne({ where: { runId: this.currentRunId } });
      if (!run) {
        logger.log('warn', `Run not found for binary data persistence: ${this.currentRunId}`);
        return;
      }

      const currentBinaryOutput = run.binaryOutput ? 
        JSON.parse(JSON.stringify(run.binaryOutput)) : 
        {};
      
      const uniqueKey = `item-${Date.now()}-${Object.keys(currentBinaryOutput).length}`;
      
      const updatedBinaryOutput = {
        ...currentBinaryOutput,
        [uniqueKey]: binaryItem
      };

      await run.update({
        binaryOutput: updatedBinaryOutput
      });
      
      logger.log('debug', `Persisted binary data for run ${this.currentRunId}: ${binaryItem.mimetype}`);
    } catch (error: any) {
      logger.log('error', `Failed to persist binary data in real-time for run ${this.currentRunId}: ${error.message}`);
    }
  };

  /**
   * Interprets the recording as a run.
   * @param workflow The workflow to interpret.
   * @param page The page instance used to interact with the browser.
   * @param settings The settings to use for the interpretation.
   */
  public InterpretRecording = async (
    workflow: WorkflowFile, 
    page: Page, 
    updatePageOnPause: (page: Page) => void,
    settings: InterpreterSettings
  ) => {
    const params = settings.params ? settings.params : null;
    delete settings.params;

    const processedWorkflow = processWorkflow(workflow);

    let mergedScrapeSchema = {};

    const options = {
      ...settings,
      debugChannel: {
        activeId: (id: any) => {
          this.activeId = id;
          this.socket.emit('activePairId', id);
        },
        debugMessage: (msg: any) => {
          this.debugMessages.push(`[${new Date().toLocaleString()}] ` + msg);
          this.socket.emit('debugMessage', msg)
        },
        setActionType: (type: string) => {
          this.currentActionType = type;
        },
        incrementScrapeListIndex: () => {
          this.currentScrapeListIndex++;
        }
      },
      serializableCallback: async (data: any) => {
        if (this.currentActionType === 'scrapeSchema') {
          if (Array.isArray(data) && data.length > 0) {
            mergedScrapeSchema = { ...mergedScrapeSchema, ...data[0] };
            this.serializableDataByType.scrapeSchema.push(data);
          } else {
            mergedScrapeSchema = { ...mergedScrapeSchema, ...data };
            this.serializableDataByType.scrapeSchema.push([data]);
          }
          
          // Persist the cumulative scrapeSchema data
          const cumulativeScrapeSchemaData = Object.keys(mergedScrapeSchema).length > 0 ? [mergedScrapeSchema] : [];
          if (cumulativeScrapeSchemaData.length > 0) {
            await this.persistDataToDatabase('scrapeSchema', cumulativeScrapeSchemaData);
          }
        } else if (this.currentActionType === 'scrapeList') {
          if (data && Array.isArray(data) && data.length > 0) {
            // Use the current index for persistence
            await this.persistDataToDatabase('scrapeList', data, this.currentScrapeListIndex);
          }
          this.serializableDataByType.scrapeList[this.currentScrapeListIndex] = data;
        } 
        
        this.socket.emit('serializableCallback', data);
      },
      binaryCallback: async (data: string, mimetype: string) => {
        const binaryItem = { mimetype, data: JSON.stringify(data) };
        this.binaryData.push(binaryItem);
        
        // Persist binary data to database
        await this.persistBinaryDataToDatabase(binaryItem);
        
        this.socket.emit('binaryCallback', { data, mimetype });
      }
    }

    const interpreter = new Interpreter(processedWorkflow, options);
    this.interpreter = interpreter;

    interpreter.on('flag', async (page, resume) => {
      if (this.activeId !== null && this.breakpoints[this.activeId]) {
        logger.log('debug', `breakpoint hit id: ${this.activeId}`);
        this.socket.emit('breakpointHit');
        this.interpretationIsPaused = true;
      }

      if (this.interpretationIsPaused) {
        this.interpretationResume = resume;
        logger.log('debug', `Paused inside of flag: ${page.url()}`);
        updatePageOnPause(page);
        this.socket.emit('log', '----- The interpretation has been paused -----', false);
      } else {
        resume();
      }
    });

    const status = await interpreter.run(page, params);

    // Structure the output to maintain separate data for each action type
    const result = {
      log: this.debugMessages,
      result: status,
      scrapeSchemaOutput: Object.keys(mergedScrapeSchema).length > 0 
      ? { "schema_merged": [mergedScrapeSchema] }
      : this.serializableDataByType.scrapeSchema.reduce((reducedObject, item, index) => {
        reducedObject[`schema_${index}`] = item;
        return reducedObject;
      }, {} as Record<string, any>),
      scrapeListOutput: this.serializableDataByType.scrapeList.reduce((reducedObject, item, index) => {
        reducedObject[`list_${index}`] = item;
        return reducedObject;
      }, {} as Record<string, any>),
      binaryOutput: this.binaryData.reduce((reducedObject, item, index) => {
        reducedObject[`item_${index}`] = item;
        return reducedObject;
      }, {} as Record<string, any>)
    }

    logger.log('debug', `Interpretation finished`);
    return result;
  }

  /**
   * Returns true if an interpretation is currently running.
   * @returns {boolean}
   */
  public interpretationInProgress = () => {
    return this.interpreter !== null;
  };

  /**
   * Updates the socket used for communication with the client (frontend).
   * @param socket Socket.io socket instance enabling communication with the client (frontend) side.
   * @returns void
   */
  public updateSocket = (socket: Socket): void => {
    this.socket = socket;
    this.subscribeToPausing();
  };

  /**
   * Adds data to persistence buffer for batched processing
   * @private
   */
  private addToPersistenceBatch(actionType: string, data: any, listIndex?: number, creditValidated: boolean = false): void {
    this.persistenceBuffer.push({
      actionType,
      data,
      listIndex,
      timestamp: Date.now(),
      creditValidated
    });

    logger.log('debug', `Added ${actionType} to persistence buffer (${this.persistenceBuffer.length} items)`);
  }

  /**
   * Schedules a batched flush if not already scheduled
   * @private
   */
  private scheduleBatchFlush(): void {
    if (!this.persistenceTimer && !this.persistenceInProgress) {
      this.persistenceTimer = setTimeout(async () => {
        await this.flushPersistenceBuffer();
      }, this.BATCH_TIMEOUT);
    }
  }

  /**
   * Flushes persistence buffer to database in a single transaction
   * @private
   */
  private async flushPersistenceBuffer(): Promise<void> {
    if (this.persistenceBuffer.length === 0 || this.persistenceInProgress || !this.currentRunId) {
      return;
    }

    if (this.persistenceTimer) {
      clearTimeout(this.persistenceTimer);
      this.persistenceTimer = null;
    }

    this.persistenceInProgress = true;
    const batchToProcess = [...this.persistenceBuffer];
    this.persistenceBuffer = [];

    try {
      const sequelize = require('../../storage/db').default;
      await sequelize.transaction(async (transaction: any) => {
        const run = await Run.findOne({
          where: { runId: this.currentRunId! },
          transaction
        });

        if (!run) {
          logger.log('warn', `Run not found for batched persistence: ${this.currentRunId}`);
          return;
        }

        const currentSerializableOutput = run.serializableOutput ?
          JSON.parse(JSON.stringify(run.serializableOutput)) :
          { scrapeSchema: [], scrapeList: [] };

        let hasUpdates = false;

        for (const item of batchToProcess) {
          if (item.actionType === 'scrapeSchema') {
            const newSchemaData = Array.isArray(item.data) ? item.data : [item.data];
            currentSerializableOutput.scrapeSchema = newSchemaData;
            hasUpdates = true;
          } else if (item.actionType === 'scrapeList' && typeof item.listIndex === 'number') {
            if (!Array.isArray(currentSerializableOutput.scrapeList)) {
              currentSerializableOutput.scrapeList = [];
            }
            currentSerializableOutput.scrapeList[item.listIndex] = item.data;
            hasUpdates = true;
          }
        }

        if (hasUpdates) {
          await run.update({
            serializableOutput: currentSerializableOutput
          }, { transaction });

          logger.log('debug', `Batched persistence: Updated run ${this.currentRunId} with ${batchToProcess.length} items`);
        }
      });

      this.persistenceRetryCount = 0;

    } catch (error: any) {
      logger.log('error', `Failed to flush persistence buffer for run ${this.currentRunId}: ${error.message}`);

      if (!this.persistenceRetryCount) {
        this.persistenceRetryCount = 0;
      }

      if (this.persistenceRetryCount < 3) {
        this.persistenceBuffer.unshift(...batchToProcess);
        this.persistenceRetryCount++;

        const backoffDelay = Math.min(5000 * Math.pow(2, this.persistenceRetryCount), 30000);
        setTimeout(async () => {
          await this.flushPersistenceBuffer();
        }, backoffDelay);

        logger.log('warn', `Scheduling persistence retry ${this.persistenceRetryCount}/3 in ${backoffDelay}ms`);
      } else {
        logger.log('error', `Max persistence retries exceeded for run ${this.currentRunId}, dropping ${batchToProcess.length} items`);
        this.persistenceRetryCount = 0;
      }
    } finally {
      this.persistenceInProgress = false;

      if (this.persistenceBuffer.length > 0 && !this.persistenceTimer) {
        this.scheduleBatchFlush();
      }
    }
  };
}
