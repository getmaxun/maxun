import { v4 as uuid } from "uuid";
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { io, Socket } from "socket.io-client";
import { createRemoteBrowserForRun, destroyRemoteBrowser } from '../../browser-management/controller';
import logger from '../../logger';
import { browserPool, io as serverIo } from "../../server";
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
import { convertPageToMarkdown, convertPageToHTML } from "../../markdownify/scrape";
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

    const browserId = createRemoteBrowserForRun(userId);
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
      retryCount: 0
    });

    const plainRun = run.toJSON();

    try {
      const runScheduledData = {
        runId: plainRun.runId,
        robotMetaId: plainRun.robotMetaId,
        robotName: plainRun.name,
        status: 'scheduled',
        startedAt: plainRun.startedAt,
        runByUserId: plainRun.runByUserId,
        runByScheduleId: plainRun.runByScheduleId,
        runByAPI: plainRun.runByAPI || false,
        browserId: plainRun.browserId
      };
      
      serverIo.of('/queued-run').to(`user-${userId}`).emit('run-scheduled', runScheduledData);
      logger.log('info', `Scheduled run notification sent for run: ${plainRun.runId} to user-${userId}`);
    } catch (socketError: any) {
      logger.log('warn', `Failed to send run-scheduled notification for run ${plainRun.runId}: ${socketError.message}`);
    }

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

async function triggerIntegrationUpdates(runId: string, robotMetaId: string): Promise<void> {
  try {
    googleSheetUpdateTasks[runId] = {
      robotId: robotMetaId,
      runId: runId,
      status: 'pending',
      retries: 5,
    };

    airtableUpdateTasks[runId] = {
      robotId: robotMetaId,
      runId: runId,
      status: 'pending',
      retries: 5,
    };

    processAirtableUpdates().catch(err => logger.log('error', `Airtable update error: ${err.message}`));
    processGoogleSheetUpdates().catch(err => logger.log('error', `Google Sheets update error: ${err.message}`));
  } catch (err: any) {
    logger.log('error', `Failed to update integrations for run: ${runId}: ${err.message}`);
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
  let browser: any = null;

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

      try {
        const failureSocketData = {
          runId: plainRun.runId,
          robotMetaId: plainRun.robotMetaId,
          robotName: recording ? recording.recording_meta.name : 'Unknown Robot',
          status: 'failed',
          finishedAt: new Date().toLocaleString()
        };

        serverIo.of(run.browserId).emit('run-completed', failureSocketData);
        serverIo.of('/queued-run').to(`user-${userId}`).emit('run-completed', failureSocketData);
      } catch (socketError: any) {
        logger.log('warn', `Failed to emit failure event in main catch: ${socketError.message}`);
      }

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

    browser = browserPool.getRemoteBrowser(plainRun.browserId);
    if (!browser) {
      throw new Error('Could not access browser');
    }

    let currentPage = await browser.getCurrentPage();
    if (!currentPage) {
      throw new Error('Could not create a new page');
    }

    if (recording.recording_meta.type === 'scrape') {
      logger.log('info', `Executing scrape robot for scheduled run ${id}`);

      const formats = recording.recording_meta.formats || ['markdown'];

      await run.update({
        status: 'running',
        log: `Converting page to: ${formats.join(', ')}`
      });

      try {
        const runStartedData = {
          runId: plainRun.runId,
          robotMetaId: plainRun.robotMetaId,
          robotName: recording.recording_meta.name,
          status: 'running',
          startedAt: plainRun.startedAt
        };

        serverIo.of('/queued-run').to(`user-${userId}`).emit('run-started', runStartedData);
        logger.log(
          'info',
          `Markdown robot run started notification sent for run: ${plainRun.runId} to user-${userId}`
        );
      } catch (socketError: any) {
        logger.log(
          'warn',
          `Failed to send run-started notification for markdown robot run ${plainRun.runId}: ${socketError.message}`
        );
      }

      try {
        const url = recording.recording_meta.url;

        if (!url) {
          throw new Error('No URL specified for markdown robot');
        }

        let markdown = '';
        let html = '';
        const serializableOutput: any = {};

        // Markdown conversion
        if (formats.includes('markdown')) {
          markdown = await convertPageToMarkdown(url, currentPage);
          serializableOutput.markdown = [{ content: markdown }];
        }

        // HTML conversion
        if (formats.includes('html')) {
          html = await convertPageToHTML(url, currentPage);
          serializableOutput.html = [{ content: html }];
        }

        await run.update({
          status: 'success',
          finishedAt: new Date().toLocaleString(),
          log: `${formats.join(', ')} conversion completed successfully`,
          serializableOutput,
          binaryOutput: {},
        });

        logger.log('info', `Markdown robot execution completed for scheduled run ${id}`);

        // Run-completed socket notifications
        try {
          const completionData = {
            runId: plainRun.runId,
            robotMetaId: plainRun.robotMetaId,
            robotName: recording.recording_meta.name,
            status: 'success',
            finishedAt: new Date().toLocaleString()
          };

          serverIo.of(plainRun.browserId).emit('run-completed', completionData);
          serverIo.of('/queued-run').to(`user-${userId}`).emit('run-completed', completionData);
        } catch (socketError: any) {
          logger.log(
            'warn',
            `Failed to send run-completed notification for markdown robot run ${id}: ${socketError.message}`
          );
        }

        // Webhook payload
        const webhookPayload: any = {
          robot_id: plainRun.robotMetaId,
          run_id: plainRun.runId,
          robot_name: recording.recording_meta.name,
          status: 'success',
          started_at: plainRun.startedAt,
          finished_at: new Date().toLocaleString(),
          metadata: {
            browser_id: plainRun.browserId,
            user_id: userId,
          }
        };

        if (formats.includes('markdown')) webhookPayload.markdown = markdown;
        if (formats.includes('html')) webhookPayload.html = html;

        try {
          await sendWebhook(plainRun.robotMetaId, 'run_completed', webhookPayload);
          logger.log(
            'info',
            `Webhooks sent successfully for markdown robot scheduled run ${plainRun.runId}`
          );
        } catch (webhookError: any) {
          logger.log(
            'warn',
            `Failed to send webhooks for markdown robot run ${plainRun.runId}: ${webhookError.message}`
          );
        }

        capture("maxun-oss-run-created-scheduled", {
          runId: plainRun.runId,
          user_id: userId,
          status: "success",
          robot_type: "scrape",
          formats
        });

        await destroyRemoteBrowser(plainRun.browserId, userId);

        return true;

      } catch (error: any) {
        logger.log('error', `${formats.join(', ')} conversion failed for scheduled run ${id}: ${error.message}`);

        await run.update({
          status: 'failed',
          finishedAt: new Date().toLocaleString(),
          log: `${formats.join(', ')} conversion failed: ${error.message}`,
        });

        try {
          const failureData = {
            runId: plainRun.runId,
            robotMetaId: plainRun.robotMetaId,
            robotName: recording.recording_meta.name,
            status: 'failed',
            finishedAt: new Date().toLocaleString()
          };

          serverIo.of(plainRun.browserId).emit('run-completed', failureData);
          serverIo.of('/queued-run').to(`user-${userId}`).emit('run-completed', failureData);
        } catch (socketError: any) {
          logger.log(
            'warn',
            `Failed to send run-failed notification for markdown robot run ${id}: ${socketError.message}`
          );
        }

        capture("maxun-oss-run-created-scheduled", {
          runId: plainRun.runId,
          user_id: userId,
          status: "failed",
          robot_type: "scrape",
          formats
        });

        await destroyRemoteBrowser(plainRun.browserId, userId);

        throw error;
      }
    }

    plainRun.status = 'running';

    try {
      const runStartedData = {
        runId: plainRun.runId,
        robotMetaId: plainRun.robotMetaId,
        robotName: recording ? recording.recording_meta.name : 'Unknown Robot',
        status: 'running',
        startedAt: plainRun.startedAt
      };

      serverIo.of('/queued-run').to(`user-${userId}`).emit('run-started', runStartedData);
      logger.log('info', `Run started notification sent for run: ${plainRun.runId} to user-${userId}`);
    } catch (socketError: any) {
      logger.log('warn', `Failed to send run-started notification for run ${plainRun.runId}: ${socketError.message}`);
    }

    const workflow = AddGeneratedFlags(recording.recording);
    
    // Set run ID for real-time data persistence
    browser.interpreter.setRunId(id);
    
    const interpretationInfo = await browser.interpreter.InterpretRecording(
      workflow, currentPage, (newPage: Page) => currentPage = newPage, plainRun.interpreterSettings
    );

    const binaryOutputService = new BinaryOutputService('maxun-run-screenshots');
    const uploadedBinaryOutput = await binaryOutputService.uploadAndStoreBinaryOutput(run, interpretationInfo.binaryOutput);

    const finalRun = await Run.findByPk(run.id);
    const categorizedOutput = {
      scrapeSchema: finalRun?.serializableOutput?.scrapeSchema || {},
      scrapeList: finalRun?.serializableOutput?.scrapeList || {},
    };

    await destroyRemoteBrowser(plainRun.browserId, userId);

    await run.update({
      status: 'success',
      finishedAt: new Date().toLocaleString(),
      log: interpretationInfo.log.join('\n'),
      binaryOutput: uploadedBinaryOutput
    });

    // Get metrics from persisted data for analytics and webhooks
    let totalSchemaItemsExtracted = 0;
    let totalListItemsExtracted = 0;
    let extractedScreenshotsCount = 0;
    
    if (categorizedOutput) {
      if (categorizedOutput.scrapeSchema) {
        Object.values(categorizedOutput.scrapeSchema).forEach((schemaResult: any) => {
          if (Array.isArray(schemaResult)) {
            totalSchemaItemsExtracted += schemaResult.length;
          } else if (schemaResult && typeof schemaResult === 'object') {
            totalSchemaItemsExtracted += 1;
          }
        });
      }
      
      if (categorizedOutput.scrapeList) {
        Object.values(categorizedOutput.scrapeList).forEach((listResult: any) => {
          if (Array.isArray(listResult)) {
            totalListItemsExtracted += listResult.length;
          }
        });
      }
    }

    if (run.binaryOutput) {
      extractedScreenshotsCount = Object.keys(run.binaryOutput).length;
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

    try {
      const completionData = {
        runId: plainRun.runId,
        robotMetaId: plainRun.robotMetaId,
        robotName: recording.recording_meta.name,
        status: 'success',
        finishedAt: new Date().toLocaleString()
      };

      serverIo.of(plainRun.browserId).emit('run-completed', completionData);
      serverIo.of('/queued-run').to(`user-${userId}`).emit('run-completed', completionData);
    } catch (emitError: any) {
      logger.log('warn', `Failed to emit success event: ${emitError.message}`);
    }

    const webhookPayload = {
      robot_id: plainRun.robotMetaId,
      run_id: plainRun.runId,
      robot_name: recording.recording_meta.name,
      status: 'success',
      started_at: plainRun.startedAt,
      finished_at: new Date().toLocaleString(),
      extracted_data: {
        captured_texts: Object.keys(categorizedOutput.scrapeSchema || {}).length > 0
          ? Object.entries(categorizedOutput.scrapeSchema).reduce((acc, [name, value]) => {
              acc[name] = Array.isArray(value) ? value : [value];
              return acc;
            }, {} as Record<string, any[]>)
          : {},
        captured_lists: categorizedOutput.scrapeList,
        captured_texts_count: totalSchemaItemsExtracted,
        captured_lists_count: totalListItemsExtracted,
        screenshots_count: extractedScreenshotsCount
      },
      metadata: {
        browser_id: plainRun.browserId,
        user_id: userId,
      }
    };

    try {
      await sendWebhook(plainRun.robotMetaId, 'run_completed', webhookPayload);
      logger.log('info', `Webhooks sent successfully for completed run ${plainRun.runId}`);
    } catch (webhookError: any) {
      logger.log('error', `Failed to send webhooks for run ${plainRun.runId}: ${webhookError.message}`);
    }

    await triggerIntegrationUpdates(plainRun.runId, plainRun.robotMetaId);
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

      try {
        const failureSocketData = {
          runId: run.runId,
          robotMetaId: run.robotMetaId,
          robotName: recording ? recording.recording_meta.name : 'Unknown Robot',
          status: 'failed',
          finishedAt: new Date().toLocaleString()
        };

        serverIo.of(run.browserId).emit('run-completed', failureSocketData);
        serverIo.of('/queued-run').to(`user-${userId}`).emit('run-completed', failureSocketData);
      } catch (socketError: any) {
        logger.log('warn', `Failed to emit failure event in main catch: ${socketError.message}`);
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