import { v4 as uuid } from "uuid";
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { io, Socket } from "socket.io-client";
import { createRemoteBrowserForRun, destroyRemoteBrowser } from '../../browser-management/controller';
import logger from '../../logger';
import { browserPool } from "../../server";
import { googleSheetUpdateTasks, processGoogleSheetUpdates } from "../integrations/gsheet";
import Robot from "../../models/Robot";
import Run from "../../models/Run";
import { getDecryptedProxyConfig } from "../../routes/proxy";
import { BinaryOutputService } from "../../storage/mino";
import { capture } from "../../utils/analytics";
import { WorkflowFile } from "maxun-core";
import { Page } from "playwright";
import { sendWebhook } from "../../routes/webhook";
import { airtableUpdateTasks, processAirtableUpdates } from "../integrations/airtable";
chromium.use(stealthPlugin());

async function createWorkflowAndStoreMetadata(id: string, userId: string) {
  try {
    const recording = await Robot.findOne({
      where: {
        'recording_meta.id': id
      },
      raw: true
    });

    if (!recording || !recording.recording_meta || !recording.recording_meta.id) {
      return {
        success: false,
        error: 'Recording not found'
      };
    }

    const proxyConfig = await getDecryptedProxyConfig(userId);
    let proxyOptions: any = {};

    if (proxyConfig.proxy_url) {
      proxyOptions = {
        server: proxyConfig.proxy_url,
        ...(proxyConfig.proxy_username && proxyConfig.proxy_password && {
          username: proxyConfig.proxy_username,
          password: proxyConfig.proxy_password,
        }),
      };
    }

    const browserId = createRemoteBrowserForRun( userId);
    const runId = uuid();

    const run = await Run.create({
      status: 'scheduled',
      name: recording.recording_meta.name,
      robotId: recording.id,
      robotMetaId: recording.recording_meta.id,
      startedAt: new Date().toLocaleString(),
      finishedAt: '',
      browserId,
      interpreterSettings: { maxConcurrency: 1, maxRepeats: 1, debug: true },
      log: '',
      runId,
      runByScheduleId: uuid(),
      serializableOutput: {},
      binaryOutput: {},
    });

    const plainRun = run.toJSON();

    return {
      browserId,
      runId: plainRun.runId,
    }

  } catch (e) {
    const { message } = e as Error;
    logger.log('info', `Error while scheduling a run with id: ${id}`);
    console.log(`Error while scheduling a run with id: ${id}:`, message);
    return {
      success: false,
      error: message,
    };
  }
}

function AddGeneratedFlags(workflow: WorkflowFile) {
  const copy = JSON.parse(JSON.stringify(workflow));
  for (let i = 0; i < workflow.workflow.length; i++) {
    copy.workflow[i].what.unshift({
      action: 'flag',
      args: ['generated'],
    });
  }
  return copy;
};

async function executeRun(id: string, userId: string) {
  try {
    const run = await Run.findOne({ where: { runId: id } });
    if (!run) {
      return {
        success: false,
        error: 'Run not found'
      }
    }

    const plainRun = run.toJSON();

    if (run.status === 'aborted' || run.status === 'aborting') {
      logger.log('info', `Scheduled Run ${id} has status ${run.status}, skipping execution`);
      return {
        success: false,
        error: `Run has status ${run.status}`
      }
    }

    if (run.status === 'queued') {
      logger.log('info', `Scheduled Run ${id} has status 'queued', skipping stale execution - will be handled by recovery`);
      return {
        success: false,
        error: 'Run is queued and will be handled by recovery'
      }
    }

    const retryCount = plainRun.retryCount || 0;
    if (retryCount >= 3) {
      logger.log('warn', `Scheduled Run ${id} has exceeded max retries (${retryCount}/3), marking as failed`);
      const recording = await Robot.findOne({ where: { 'recording_meta.id': plainRun.robotMetaId, userId }, raw: true });

      await run.update({
        status: 'failed',
        finishedAt: new Date().toLocaleString(),
        log: plainRun.log ? `${plainRun.log}\nMax retries exceeded (3/3) - Run failed after multiple attempts.` : `Max retries exceeded (3/3) - Run failed after multiple attempts.`
      });

      return {
        success: false,
        error: 'Max retries exceeded'
      }
    }

    const recording = await Robot.findOne({ where: { 'recording_meta.id': plainRun.robotMetaId }, raw: true });
    if (!recording) {
      return {
        success: false,
        error: 'Recording not found'
      }
    }

    plainRun.status = 'running';

    const browser = browserPool.getRemoteBrowser(plainRun.browserId);
    if (!browser) {
      throw new Error('Could not access browser');
    }

    let currentPage = await browser.getCurrentPage();
    if (!currentPage) {
      throw new Error('Could not create a new page');
    }

    const workflow = AddGeneratedFlags(recording.recording);
    
    // Set run ID for real-time data persistence
    browser.interpreter.setRunId(id);
    
    const interpretationInfo = await browser.interpreter.InterpretRecording(
      workflow, currentPage, (newPage: Page) => currentPage = newPage, plainRun.interpreterSettings
    );

    await destroyRemoteBrowser(plainRun.browserId, userId);

    await run.update({
      status: 'success',
      finishedAt: new Date().toLocaleString(),
      log: interpretationInfo.log.join('\n'),
    });

    // Get metrics from persisted data for analytics and webhooks
    let totalSchemaItemsExtracted = 0;
    let totalListItemsExtracted = 0;
    let extractedScreenshotsCount = 0;
    
    const updatedRun = await Run.findOne({ where: { runId: id } });
    if (updatedRun) {
      if (updatedRun.serializableOutput) {
        if (updatedRun.serializableOutput.scrapeSchema) {
          Object.values(updatedRun.serializableOutput.scrapeSchema).forEach((schemaResult: any) => {
            if (Array.isArray(schemaResult)) {
              totalSchemaItemsExtracted += schemaResult.length;
            } else if (schemaResult && typeof schemaResult === 'object') {
              totalSchemaItemsExtracted += 1;
            }
          });
        }
        
        if (updatedRun.serializableOutput.scrapeList) {
          Object.values(updatedRun.serializableOutput.scrapeList).forEach((listResult: any) => {
            if (Array.isArray(listResult)) {
              totalListItemsExtracted += listResult.length;
            }
          });
        }
      }
      
      if (updatedRun.binaryOutput) {
        extractedScreenshotsCount = Object.keys(updatedRun.binaryOutput).length;
      }
    }
    
    const totalRowsExtracted = totalSchemaItemsExtracted + totalListItemsExtracted;

    capture(
      'maxun-oss-run-created-scheduled',
      {
        runId: id,
        created_at: new Date().toISOString(),
        status: 'success',
        totalRowsExtracted,
        schemaItemsExtracted: totalSchemaItemsExtracted,
        listItemsExtracted: totalListItemsExtracted,
        extractedScreenshotsCount,
      }
    );

    const webhookPayload = {
      robot_id: plainRun.robotMetaId,
      run_id: plainRun.runId,
      robot_name: recording.recording_meta.name,
      status: 'success',
      started_at: plainRun.startedAt,
      finished_at: new Date().toLocaleString(),
      extracted_data: {
        captured_texts: updatedRun?.serializableOutput?.scrapeSchema ? Object.values(updatedRun.serializableOutput.scrapeSchema).flat() : [],
        captured_lists: updatedRun?.serializableOutput?.scrapeList || {},
        total_rows: totalRowsExtracted,
        captured_texts_count: totalSchemaItemsExtracted,
        captured_lists_count: totalListItemsExtracted,
        screenshots_count: extractedScreenshotsCount
      },
      metadata: {
        browser_id: plainRun.browserId,
        user_id: userId
      }
    };

    try {
      await sendWebhook(plainRun.robotMetaId, 'run_completed', webhookPayload);
      logger.log('info', `Webhooks sent successfully for completed run ${plainRun.runId}`);
    } catch (webhookError: any) {
      logger.log('error', `Failed to send webhooks for run ${plainRun.runId}: ${webhookError.message}`);
    }

    try {
      googleSheetUpdateTasks[plainRun.runId] = {
        robotId: plainRun.robotMetaId,
        runId: plainRun.runId,
        status: 'pending',
        retries: 5,
      };

      airtableUpdateTasks[plainRun.runId] = {
        robotId: plainRun.robotMetaId,
        runId: plainRun.runId,
        status: 'pending',
        retries: 5,
      };

      processAirtableUpdates();
      processGoogleSheetUpdates();
    } catch (err: any) {
      logger.log('error', `Failed to update Google Sheet for run: ${plainRun.runId}: ${err.message}`);
    }
    return true;
  } catch (error: any) {
    logger.log('info', `Error while running a robot with id: ${id} - ${error.message}`);
    console.log(error.message);
    const run = await Run.findOne({ where: { runId: id } });
    if (run) {
      await run.update({
        status: 'failed',
        finishedAt: new Date().toLocaleString(),
      });

      const recording = await Robot.findOne({ where: { 'recording_meta.id': run.robotMetaId }, raw: true });

      // Trigger webhooks for run failure
      const failedWebhookPayload = {
        robot_id: run.robotMetaId,
        run_id: run.runId,
        robot_name: recording ? recording.recording_meta.name : 'Unknown Robot',
        status: 'failed',
        started_at: run.startedAt,
        finished_at: new Date().toLocaleString(),
        error: {
          message: error.message,
          stack: error.stack,
          type: error.name || 'ExecutionError'
        },
        metadata: {
          browser_id: run.browserId,
          user_id: userId,
        }
      };

      try {
        await sendWebhook(run.robotMetaId, 'run_failed', failedWebhookPayload);
        logger.log('info', `Failure webhooks sent successfully for run ${run.runId}`);
      } catch (webhookError: any) {
        logger.log('error', `Failed to send failure webhooks for run ${run.runId}: ${webhookError.message}`);
      }
    }
    capture(
      'maxun-oss-run-created-scheduled',
      {
        runId: id,
        created_at: new Date().toISOString(),
        status: 'failed',
      }
    );
    return false;
  }
}

async function readyForRunHandler(browserId: string, id: string, userId: string) {
  try {
    const interpretation = await executeRun(id, userId);

    if (interpretation) {
      logger.log('info', `Interpretation of ${id} succeeded`);
    } else {
      logger.log('error', `Interpretation of ${id} failed`);
      await destroyRemoteBrowser(browserId, userId);
    }

    resetRecordingState(browserId, id);

  } catch (error: any) {
    logger.error(`Error during readyForRunHandler: ${error.message}`);
    await destroyRemoteBrowser(browserId, userId);
  }
}

function resetRecordingState(browserId: string, id: string) {
  browserId = '';
  id = '';
}

export async function handleRunRecording(id: string, userId: string) {
  try {
    const result = await createWorkflowAndStoreMetadata(id, userId);
    const { browserId, runId: newRunId } = result;

    if (!browserId || !newRunId || !userId) {
      throw new Error('browserId or runId or userId is undefined');
    }

    const socket = io(`${process.env.BACKEND_URL ? process.env.BACKEND_URL : 'http://localhost:8080'}/${browserId}`, {
      transports: ['websocket'],
      rejectUnauthorized: false
    });

    socket.on('ready-for-run', () => readyForRunHandler(browserId, newRunId, userId));

    logger.log('info', `Running robot: ${id}`);

    socket.on('disconnect', () => {
      cleanupSocketListeners(socket, browserId, newRunId, userId);
    });

  } catch (error: any) {
    logger.error('Error running recording:', error);
  }
}

function cleanupSocketListeners(socket: Socket, browserId: string, id: string, userId: string) {
  socket.off('ready-for-run', () => readyForRunHandler(browserId, id, userId));
  logger.log('info', `Cleaned up listeners for browserId: ${browserId}, runId: ${id}`);
}

export { createWorkflowAndStoreMetadata };