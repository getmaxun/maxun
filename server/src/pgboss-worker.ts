/**
 * Recording worker using PgBoss for asynchronous browser recording operations
 */
import PgBoss, { Job } from 'pg-boss';
import logger from './logger';
import {
  initializeRemoteBrowserForRecording,
  destroyRemoteBrowser,
  interpretWholeWorkflow,
  stopRunningInterpretation,
} from './browser-management/controller';
import { WorkflowFile } from 'maxun-core';
import Run from './models/Run';
import Robot from './models/Robot';
import { browserPool } from './server';
import { Page } from 'playwright';
import { capture } from './utils/analytics';
import { googleSheetUpdateTasks, processGoogleSheetUpdates } from './workflow-management/integrations/gsheet';
import { airtableUpdateTasks, processAirtableUpdates } from './workflow-management/integrations/airtable';
import { io as serverIo } from "./server";
import { sendWebhook } from './routes/webhook';

if (!process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_HOST || !process.env.DB_PORT || !process.env.DB_NAME) {
    throw new Error('Failed to start pgboss worker: one or more required environment variables are missing.');
}

const pgBossConnectionString = `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD)}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

interface InitializeBrowserData {
  userId: string;
}

interface InterpretWorkflow {
  userId: string;
}

interface StopInterpretWorkflow {
  userId: string;
}

interface DestroyBrowserData {
  browserId: string;
  userId: string;
}

interface ExecuteRunData {
  userId: string;
  runId: string;
  browserId: string;
}

interface AbortRunData {
  userId: string;
  runId: string;
}

const pgBoss = new PgBoss({
  connectionString: pgBossConnectionString,
  expireInHours: 23
});

/**
 * Extract data safely from a job (single job or job array)
 */
function extractJobData<T>(job: Job<T> | Job<T>[]): T {
  if (Array.isArray(job)) {
    if (job.length === 0) {
      throw new Error('Empty job array received');
    }
    return job[0].data;
  }
  return job.data;
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


// Helper function to handle integration updates
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

    processAirtableUpdates();
    processGoogleSheetUpdates();
  } catch (err: any) {
    logger.log('error', `Failed to update integrations for run: ${runId}: ${err.message}`);
  }
}

/**
 * Modified processRunExecution function - only add browser reset
 */
async function processRunExecution(job: Job<ExecuteRunData>) {
  const BROWSER_INIT_TIMEOUT = 60000;
  const BROWSER_PAGE_TIMEOUT = 45000;

  const data = job.data;
  logger.log('info', `Processing run execution job for runId: ${data.runId}, browserId: ${data.browserId}`);
  
  try { 
    // Find the run
    const run = await Run.findOne({ where: { runId: data.runId } });
    if (!run) {
      logger.log('error', `Run ${data.runId} not found in database`);
      return { success: false };
    }

    if (run.status === 'aborted' || run.status === 'aborting') {
      logger.log('info', `Run ${data.runId} has status ${run.status}, skipping execution`);
      return { success: true }; 
    }

    if (run.status === 'queued') {
      logger.log('info', `Run ${data.runId} has status 'queued', skipping stale execution job - processQueuedRuns will handle it`);
      return { success: true };
    }

    const plainRun = run.toJSON();
    const browserId = data.browserId || plainRun.browserId;

    if (!browserId) {
      throw new Error(`No browser ID available for run ${data.runId}`);
    }

    logger.log('info', `Looking for browser ${browserId} for run ${data.runId}`);

    let browser = browserPool.getRemoteBrowser(browserId);
    const browserWaitStart = Date.now();
    let lastLogTime = 0;
    
    while (!browser && (Date.now() - browserWaitStart) < BROWSER_INIT_TIMEOUT) {
      const currentTime = Date.now();
      
      const browserStatus = browserPool.getBrowserStatus(browserId);
      if (browserStatus === null) {
        throw new Error(`Browser slot ${browserId} does not exist in pool`);
      }
      
      if (currentTime - lastLogTime > 10000) {
        logger.log('info', `Browser ${browserId} not ready yet (status: ${browserStatus}), waiting... (${Math.round((currentTime - browserWaitStart) / 1000)}s elapsed)`);
        lastLogTime = currentTime;
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      browser = browserPool.getRemoteBrowser(browserId);
    }

    if (!browser) {
      const finalStatus = browserPool.getBrowserStatus(browserId);
      throw new Error(`Browser ${browserId} not found in pool after ${BROWSER_INIT_TIMEOUT/1000}s timeout (final status: ${finalStatus})`);
    }

    logger.log('info', `Browser ${browserId} found and ready for execution`);

    try {  
      // Find the recording
      const recording = await Robot.findOne({ where: { 'recording_meta.id': plainRun.robotMetaId }, raw: true });
      
      if (!recording) {
        throw new Error(`Recording for run ${data.runId} not found`);
      }
      
      const isRunAborted = async (): Promise<boolean> => {
        const currentRun = await Run.findOne({ where: { runId: data.runId } });
        return currentRun ? (currentRun.status === 'aborted' || currentRun.status === 'aborting') : false;
      };

      let currentPage = browser.getCurrentPage();
      
      const pageWaitStart = Date.now();
      let lastPageLogTime = 0;
      
      while (!currentPage && (Date.now() - pageWaitStart) < BROWSER_PAGE_TIMEOUT) {
        const currentTime = Date.now();
        
        if (currentTime - lastPageLogTime > 5000) {
          logger.log('info', `Page not ready for browser ${browserId}, waiting... (${Math.round((currentTime - pageWaitStart) / 1000)}s elapsed)`);
          lastPageLogTime = currentTime;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        currentPage = browser.getCurrentPage();
      }

      if (!currentPage) {
        throw new Error(`No current page available for browser ${browserId} after ${BROWSER_PAGE_TIMEOUT/1000}s timeout`);
      }

      logger.log('info', `Starting workflow execution for run ${data.runId}`);
      
      // Execute the workflow
      const workflow = AddGeneratedFlags(recording.recording);
      
      browser.interpreter.setRunId(data.runId);
      
      const interpretationInfo = await browser.interpreter.InterpretRecording(
        workflow, 
        currentPage, 
        (newPage: Page) => currentPage = newPage, 
        plainRun.interpreterSettings
      );
      
      if (await isRunAborted()) {
        logger.log('info', `Run ${data.runId} was aborted during execution, not updating status`);

        await destroyRemoteBrowser(plainRun.browserId, data.userId);
        
        return { success: true };
      }

      logger.log('info', `Workflow execution completed for run ${data.runId}`);
      
      if (await isRunAborted()) {
        logger.log('info', `Run ${data.runId} was aborted while processing results, not updating status`);
        return { success: true };
      }

      await run.update({
        status: 'success',
        finishedAt: new Date().toLocaleString(),
        log: interpretationInfo.log.join('\n')
      });

      let totalSchemaItemsExtracted = 0;
      let totalListItemsExtracted = 0;
      let extractedScreenshotsCount = 0;
      
      const updatedRun = await Run.findOne({ where: { runId: data.runId } });
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

      // Capture metrics
      capture(
        'maxun-oss-run-created-manual',
        {
          runId: data.runId,
          user_id: data.userId,
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
        run_id: data.runId,
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
          screenshots_count: extractedScreenshotsCount,
        },
        metadata: {
          browser_id: plainRun.browserId,
          user_id: data.userId,
        }
      };

      try {
        await sendWebhook(plainRun.robotMetaId, 'run_completed', webhookPayload);
        logger.log('info', `Webhooks sent successfully for completed run ${data.runId}`);
      } catch (webhookError: any) {
        logger.log('error', `Failed to send webhooks for run ${data.runId}: ${webhookError.message}`);
      }

      // Schedule updates for Google Sheets and Airtable
      await triggerIntegrationUpdates(plainRun.runId, plainRun.robotMetaId);

      const completionData = {
        runId: data.runId,
        robotMetaId: plainRun.robotMetaId,
        robotName: recording.recording_meta.name,
        status: 'success',
        finishedAt: new Date().toLocaleString()
      };

      serverIo.of(browserId).emit('run-completed', completionData);
      serverIo.of('/queued-run').to(`user-${data.userId}`).emit('run-completed', completionData);

      await destroyRemoteBrowser(browserId, data.userId);
      logger.log('info', `Browser ${browserId} destroyed after successful run ${data.runId}`);
      
      return { success: true };
    } catch (executionError: any) {
      logger.log('error', `Run execution failed for run ${data.runId}: ${executionError.message}`);
      
      let partialDataExtracted = false;
      let partialData: any = null;
      let partialUpdateData: any = {
        status: 'failed',
        finishedAt: new Date().toLocaleString(),
        log: `Failed: ${executionError.message}`,
      };

      try {
        const hasData = (run.serializableOutput && 
          ((run.serializableOutput.scrapeSchema && run.serializableOutput.scrapeSchema.length > 0) ||
           (run.serializableOutput.scrapeList && run.serializableOutput.scrapeList.length > 0))) ||
          (run.binaryOutput && Object.keys(run.binaryOutput).length > 0);

        if (hasData) {
          logger.log('info', `Partial data found in failed run ${data.runId}, triggering integration updates`);
          await triggerIntegrationUpdates(plainRun.runId, plainRun.robotMetaId);
          partialDataExtracted = true;
        }
      } catch (dataCheckError: any) {
        logger.log('warn', `Failed to check for partial data in run ${data.runId}: ${dataCheckError.message}`);
      }

      await run.update(partialUpdateData);

      try {
        const recording = await Robot.findOne({ where: { 'recording_meta.id': run.robotMetaId }, raw: true });

        const failureData = {
          runId: data.runId,
          robotMetaId: plainRun.robotMetaId,
          robotName: recording ? recording.recording_meta.name : 'Unknown Robot',
          status: 'failed',
          finishedAt: new Date().toLocaleString(),
          hasPartialData: partialDataExtracted
        };

        serverIo.of(browserId).emit('run-completed', failureData);
        serverIo.of('/queued-run').to(`user-${data.userId}`).emit('run-completed', failureData);
      } catch (emitError: any) {
        logger.log('warn', `Failed to emit failure event: ${emitError.message}`);
      }

      const recording = await Robot.findOne({ where: { 'recording_meta.id': run.robotMetaId }, raw: true });

      const failedWebhookPayload = {
        robot_id: plainRun.robotMetaId,
        run_id: data.runId,
        robot_name: recording ? recording.recording_meta.name : 'Unknown Robot',
        status: 'failed',
        started_at: plainRun.startedAt,
        finished_at: new Date().toLocaleString(),
        error: {
          message: executionError.message,
          stack: executionError.stack,
          type: 'ExecutionError',
        },
        partial_data_extracted: partialDataExtracted,
        extracted_data: partialDataExtracted ? {
          captured_texts: Object.values(partialUpdateData.serializableOutput?.scrapeSchema || []).flat() || [],
          captured_lists: partialUpdateData.serializableOutput?.scrapeList || {},
          total_data_points_extracted: partialData?.totalDataPointsExtracted || 0,
          captured_texts_count: partialData?.totalSchemaItemsExtracted || 0,
          captured_lists_count: partialData?.totalListItemsExtracted || 0,
          screenshots_count: partialData?.extractedScreenshotsCount || 0
        } : null,
        metadata: {
          browser_id: plainRun.browserId,
          user_id: data.userId,
        }
      };

      try {
        await sendWebhook(plainRun.robotMetaId, 'run_failed', failedWebhookPayload);
        logger.log('info', `Failure webhooks sent successfully for run ${data.runId}`);
      } catch (webhookError: any) {
        logger.log('error', `Failed to send failure webhooks for run ${data.runId}: ${webhookError.message}`);
      }

      try {
        const failureSocketData = {
          runId: data.runId,
          robotMetaId: run.robotMetaId,
          robotName: recording ? recording.recording_meta.name : 'Unknown Robot',
          status: 'failed',
          finishedAt: new Date().toLocaleString()
        };

        serverIo.of(run.browserId).emit('run-completed', failureSocketData);
        serverIo.of('/queued-run').to(`user-${data.userId}`).emit('run-completed', failureSocketData);
      } catch (socketError: any) {
        logger.log('warn', `Failed to emit failure event in main catch: ${socketError.message}`);
      }

      capture('maxun-oss-run-created-manual', {
        runId: data.runId,
        user_id: data.userId,
        created_at: new Date().toISOString(),
        status: 'failed',
        error_message: executionError.message,
        partial_data_extracted: partialDataExtracted,
        totalRowsExtracted: partialData?.totalSchemaItemsExtracted + partialData?.totalListItemsExtracted + partialData?.extractedScreenshotsCount || 0,
      });

      await destroyRemoteBrowser(browserId, data.userId);
      logger.log('info', `Browser ${browserId} destroyed after failed run`);

      return { success: false, partialDataExtracted };
    }
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to process run execution job: ${errorMessage}`);
    
    try {
      const run = await Run.findOne({ where: { runId: data.runId }});
      
      if (run) {
        await run.update({
          status: 'failed',
          finishedAt: new Date().toLocaleString(),
          log: `Failed: ${errorMessage}`,
        });

        const recording = await Robot.findOne({ where: { 'recording_meta.id': run.robotMetaId }, raw: true });

        const failedWebhookPayload = {
          robot_id: run.robotMetaId,
          run_id: data.runId,
          robot_name: recording ? recording.recording_meta.name : 'Unknown Robot',
          status: 'failed',
          started_at: run.startedAt,
          finished_at: new Date().toLocaleString(),
          error: {
            message: errorMessage,
          },
          metadata: {
            browser_id: run.browserId,
            user_id: data.userId,
          }
        };

        try {
          await sendWebhook(run.robotMetaId, 'run_failed', failedWebhookPayload);
          logger.log('info', `Failure webhooks sent successfully for run ${data.runId}`);
        } catch (webhookError: any) {
          logger.log('error', `Failed to send failure webhooks for run ${data.runId}: ${webhookError.message}`);
        }

        try {
          const failureSocketData = {
            runId: data.runId,
            robotMetaId: run.robotMetaId,
            robotName: recording ? recording.recording_meta.name : 'Unknown Robot',
            status: 'failed',
            finishedAt: new Date().toLocaleString()
          };

          serverIo.of(run.browserId).emit('run-completed', failureSocketData);
          serverIo.of('/queued-run').to(`user-${data.userId}`).emit('run-completed', failureSocketData);
        } catch (socketError: any) {
          logger.log('warn', `Failed to emit failure event in main catch: ${socketError.message}`);
        }
      }
    } catch (updateError: any) {
      logger.log('error', `Failed to update run status: ${updateError.message}`);
    }
    
    return { success: false };
  }
}

async function abortRun(runId: string, userId: string): Promise<boolean> {
  try {
    const run = await Run.findOne({ 
      where: { runId: runId }
    });

    if (!run) {
      logger.log('warn', `Run ${runId} not found or does not belong to user ${userId}`);
      return false;
    }

    await run.update({
      status: 'aborting'
    });

    const plainRun = run.toJSON();

    const recording = await Robot.findOne({ 
      where: { 'recording_meta.id': plainRun.robotMetaId }, 
      raw: true 
    });
    
    const robotName = recording?.recording_meta?.name || 'Unknown Robot';
    
    let browser;
    try {
      browser = browserPool.getRemoteBrowser(plainRun.browserId);
    } catch (browserError) {
      logger.log('warn', `Could not get browser for run ${runId}: ${browserError}`);
      browser = null;
    }

    if (!browser) {
      await run.update({
        status: 'aborted',
        finishedAt: new Date().toLocaleString(),
        log: 'Aborted: Browser not found or already closed'
      });
      
      try {
        serverIo.of(plainRun.browserId).emit('run-aborted', {
          runId,
          robotName: robotName,
          status: 'aborted',
          finishedAt: new Date().toLocaleString()
        });
      } catch (socketError) {
        logger.log('warn', `Failed to emit run-aborted event: ${socketError}`);
      }
      
      logger.log('warn', `Browser not found for run ${runId}`);
      return true;
    }

    await run.update({
      status: 'aborted',
      finishedAt: new Date().toLocaleString(),
      log: 'Run aborted by user'
    });

    const hasData = (run.serializableOutput && 
      ((run.serializableOutput.scrapeSchema && run.serializableOutput.scrapeSchema.length > 0) ||
       (run.serializableOutput.scrapeList && run.serializableOutput.scrapeList.length > 0))) ||
      (run.binaryOutput && Object.keys(run.binaryOutput).length > 0);

    if (hasData) {
      await triggerIntegrationUpdates(runId, plainRun.robotMetaId);
    }

    try {
      serverIo.of(plainRun.browserId).emit('run-aborted', {
        runId,
        robotName: robotName,
        status: 'aborted',
        finishedAt: new Date().toLocaleString()
      });
    } catch (socketError) {
      logger.log('warn', `Failed to emit run-aborted event: ${socketError}`);
    }

    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      await destroyRemoteBrowser(plainRun.browserId, userId);
      logger.log('info', `Browser ${plainRun.browserId} destroyed successfully after abort`);
    } catch (cleanupError) {
      logger.log('warn', `Failed to clean up browser for aborted run ${runId}: ${cleanupError}`);
    }

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to abort run ${runId}: ${errorMessage}`);
    return false;
  }
}

async function registerRunExecutionWorker() {
  try {
    const registeredUserQueues = new Map();

    // Worker for executing runs (Legacy)
    await pgBoss.work('execute-run', async (job: Job<ExecuteRunData> | Job<ExecuteRunData>[]) => {
      try {
        const singleJob = Array.isArray(job) ? job[0] : job;
        return await processRunExecution(singleJob);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Run execution job failed: ${errorMessage}`);
        throw error;
      }
    });

    const checkForNewUserQueues = async () => {
      try {
        const activeQueues = await pgBoss.getQueues();
        
        const userQueues = activeQueues.filter(q => q.name.startsWith('execute-run-user-'));
        
        for (const queue of userQueues) {
          if (!registeredUserQueues.has(queue.name)) {
            await pgBoss.work(queue.name, async (job: Job<ExecuteRunData> | Job<ExecuteRunData>[]) => {
              try {
                const singleJob = Array.isArray(job) ? job[0] : job;
                return await processRunExecution(singleJob);
              } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.log('error', `Run execution job failed in ${queue.name}: ${errorMessage}`);
                throw error;
              }
            });
            
            registeredUserQueues.set(queue.name, true);
            logger.log('info', `Registered worker for queue: ${queue.name}`);
          }
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Failed to check for new user queues: ${errorMessage}`);
      }
    };

    await checkForNewUserQueues();

    setInterval(async () => {
      await checkForNewUserQueues();
    }, 10000);
    
    logger.log('info', 'Run execution worker registered successfully');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to register run execution worker: ${errorMessage}`);
  }
}

async function registerAbortRunWorker() {
  try {
    const registeredAbortQueues = new Map();

    const checkForNewAbortQueues = async () => {
      try {
        const activeQueues = await pgBoss.getQueues();
        
        const abortQueues = activeQueues.filter(q => q.name.startsWith('abort-run-user-'));
        
        for (const queue of abortQueues) {
          if (!registeredAbortQueues.has(queue.name)) {
            await pgBoss.work(queue.name, async (job: Job<AbortRunData> | Job<AbortRunData>[]) => {
              try {
                const data = extractJobData(job);
                const { userId, runId } = data;
                
                logger.log('info', `Processing abort request for run ${runId} by user ${userId}`);
                const success = await abortRun(runId, userId);
                return { success };
              } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.log('error', `Abort run job failed in ${queue.name}: ${errorMessage}`);
                throw error;
              }
            });
            
            registeredAbortQueues.set(queue.name, true);
            logger.log('info', `Registered abort worker for queue: ${queue.name}`);
          }
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Failed to check for new abort queues: ${errorMessage}`);
      }
    };

    await checkForNewAbortQueues();

    setInterval(async () => {
      await checkForNewAbortQueues();
    }, 10000);
    
    logger.log('info', 'Abort run worker registration system initialized');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to initialize abort run worker system: ${errorMessage}`);
  }
}


/**
 * Initialize PgBoss and register all workers
 */
async function startWorkers() {
  try {
    logger.log('info', 'Starting PgBoss worker...');
    await pgBoss.start();
    logger.log('info', 'PgBoss worker started successfully');

    // Worker for initializing browser recording
    await pgBoss.work('initialize-browser-recording', async (job: Job<InitializeBrowserData> | Job<InitializeBrowserData>[]) => {
      try {
        const data = extractJobData(job);
        const userId = data.userId;
        
        logger.log('info', `Starting browser initialization job for user: ${userId}`);
        const browserId = initializeRemoteBrowserForRecording(userId);
        logger.log('info', `Browser recording job completed with browserId: ${browserId}`);
        return { browserId };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Browser recording job failed: ${errorMessage}`);
        throw error;
      }
    });

    // Worker for stopping a browser
    await pgBoss.work('destroy-browser', async (job: Job<DestroyBrowserData> | Job<DestroyBrowserData>[]) => {
      try {
        const data = extractJobData(job);
        const { browserId, userId } = data;
        
        logger.log('info', `Starting browser destruction job for browser: ${browserId}`);
        const success = await destroyRemoteBrowser(browserId, userId);
        logger.log('info', `Browser destruction job completed with result: ${success}`);
        return { success };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Destroy browser job failed: ${errorMessage}`);
        throw error;
      }
    });

    // Worker for interpreting workflow
    await pgBoss.work('interpret-workflow', async (job: Job<InterpretWorkflow> | Job<InterpretWorkflow>[]) => {
      try {
        const data = extractJobData(job);
        const userId = data.userId;

        logger.log('info', 'Starting workflow interpretation job');
        await interpretWholeWorkflow(userId);
        logger.log('info', 'Workflow interpretation job completed');
        return { success: true };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Interpret workflow job failed: ${errorMessage}`);
        throw error;
      }
    });

    // Worker for stopping workflow interpretation
    await pgBoss.work('stop-interpretation', async (job: Job<StopInterpretWorkflow> | Job<StopInterpretWorkflow>[]) => {
      try {
        const data = extractJobData(job);
        const userId = data.userId;

        logger.log('info', 'Starting stop interpretation job');
        await stopRunningInterpretation(userId);
        logger.log('info', 'Stop interpretation job completed');
        return { success: true };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Stop interpretation job failed: ${errorMessage}`);
        throw error;
      }
    });
    
    // Register the run execution worker
    await registerRunExecutionWorker();

    // Register the abort run worker
    await registerAbortRunWorker();

    logger.log('info', 'All recording workers registered successfully');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to start PgBoss workers: ${errorMessage}`);
    process.exit(1);
  }
}

// Start all workers
startWorkers();

pgBoss.on('error', (error) => {
  logger.log('error', `PgBoss error: ${error.message}`);
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.log('info', 'SIGTERM received, shutting down PgBoss...');
  await pgBoss.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.log('info', 'SIGINT received, shutting down PgBoss...');
  await pgBoss.stop();
  process.exit(0);
});

// For use in other files
export { pgBoss };
