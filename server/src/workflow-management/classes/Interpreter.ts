import Interpreter, { WorkflowFile } from "maxun-core";
import logger from "../../logger";
import { Socket } from "socket.io";
import { Page } from "playwright";
import { InterpreterSettings } from "../../types";
import { decrypt } from "../../utils/auth";

/**
 * Decrypts any encrypted inputs in the workflow.
 * @param workflow The workflow to decrypt.
 */
function decryptWorkflow(workflow: WorkflowFile): WorkflowFile {
  const decryptedWorkflow = JSON.parse(JSON.stringify(workflow)) as WorkflowFile;

  decryptedWorkflow.workflow.forEach((pair) => {
    pair.what.forEach((action) => {
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

  return decryptedWorkflow;
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
   * An array of all the serializable data extracted from the run.
   */
  public serializableData: string[] = [];

  /**
   * An array of all the binary data extracted from the run.
   */
  public binaryData: { mimetype: string, data: string }[] = [];

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
   * @constructor
   */
  constructor(socket: Socket) {
    this.socket = socket;
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

    const decryptedWorkflow = decryptWorkflow(workflow);

    const options = {
      ...settings,
      debugChannel: {
        activeId: (id: any) => {
          this.activeId = id;
          this.socket.emit('activePairId', id);
        },
        debugMessage: (msg: any) => {
          this.debugMessages.push(`[${new Date().toLocaleString()}] ` + msg);
          this.socket.emit('log', msg)
        },
      },
      serializableCallback: (data: any) => {
        this.socket.emit('serializableCallback', data);
      },
      binaryCallback: (data: string, mimetype: string) => {
        this.socket.emit('binaryCallback', { data, mimetype });
      }
    }

    const interpreter = new Interpreter(decryptedWorkflow, options);
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
      await this.interpreter.stop();
      this.socket.emit('log', '----- The interpretation has been stopped -----', false);
      this.clearState();
    } else {
      logger.log('error', 'Cannot stop: No active interpretation.');
    }
  };

  private clearState = () => {
    this.debugMessages = [];
    this.interpretationIsPaused = false;
    this.activeId = null;
    this.interpreter = null;
    this.breakpoints = [];
    this.interpretationResume = null;
    this.serializableData = [];
    this.binaryData = [];
  }

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

    const decryptedWorkflow = decryptWorkflow(workflow);

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
      },
      serializableCallback: (data: any) => {
        this.serializableData.push(data);
        this.socket.emit('serializableCallback', data);
      },
      binaryCallback: async (data: string, mimetype: string) => {
        this.binaryData.push({ mimetype, data: JSON.stringify(data) });
        this.socket.emit('binaryCallback', { data, mimetype });
      }
    }

    const interpreter = new Interpreter(decryptedWorkflow, options);
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

    const lastArray = this.serializableData.length > 1
    ? [this.serializableData[this.serializableData.length - 1]]
    : this.serializableData;

    const result = {
      log: this.debugMessages,
      result: status,
      serializableOutput: lastArray.reduce((reducedObject, item, index) => {
        return {
          [`item-${index}`]: item,
          ...reducedObject,
        }
      }, {}),
      binaryOutput: this.binaryData.reduce((reducedObject, item, index) => {
        return {
          [`item-${index}`]: item,
          ...reducedObject,
        }
      }, {})
    }

    logger.log('debug', `Interpretation finished`);
    this.clearState();
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
}
