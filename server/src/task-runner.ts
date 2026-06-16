import { run, Runner, TaskList } from 'graphile-worker';
import { Pool } from 'pg';
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
import { Page } from 'playwright-core';
import { capture } from './utils/analytics';
import { addGoogleSheetUpdateTask, processGoogleSheetUpdates } from './workflow-management/integrations/gsheet';
import { addAirtableUpdateTask, processAirtableUpdates } from './workflow-management/integrations/airtable';
import { io as serverIo } from './server';
import { sendWebhook } from './routes/webhook';
import { BinaryOutputService } from './storage/mino';
import { convertPageToMarkdown, convertPageToHTML, convertPageToLinks, convertPageToScreenshot, convertPageToText } from './markdownify/scrape';
import { executeBrowserAgent } from './sdk/browserAgent';
import { processRobotOutputFormats } from './utils/output-post-processor';
import { getInterpretationFailureReason, hasExpectedRobotOutput } from './utils/output-validation';
import { handleRunRecording } from './workflow-management/scheduler';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_HOST || !process.env.DB_PORT || !process.env.DB_NAME) {
  throw new Error('Failed to start task runner: one or more required environment variables are missing.');
}

const connectionString = `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD!)}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
const useSSL = process.env.DB_SSL === 'true';

export const QUEUE_NAMES = {
  INITIALIZE_BROWSER_RECORDING: 'initialize-browser-recording',
  DESTROY_BROWSER: 'destroy-browser',
  INTERPRET_WORKFLOW: 'interpret-workflow',
  STOP_INTERPRETATION: 'stop-interpretation',
  EXECUTE_RUN: 'execute-run',
  ABORT_RUN: 'abort-run',
  SCHEDULED_WORKFLOW: 'scheduled-workflow',
} as const;

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

interface ScheduledWorkflowData {
  robotMetaId: string;
  userId: string;
}

const TOTAL_CONCURRENCY = Math.max(1, parseInt(process.env.WORKER_CONCURRENCY || '10', 10));

function AddGeneratedFlags(workflow: WorkflowFile) {
  const copy = JSON.parse(JSON.stringify(workflow));
  for (let i = 0; i < workflow.workflow.length; i++) {
    copy.workflow[i].what.unshift({
      action: 'flag',
      args: ['generated'],
    });
  }
  return copy;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

async function triggerIntegrationUpdates(runId: string, robotMetaId: string): Promise<void> {
  try {
    addGoogleSheetUpdateTask(runId, { robotId: robotMetaId, runId, status: 'pending', retries: 5 });
    addAirtableUpdateTask(runId, { robotId: robotMetaId, runId, status: 'pending', retries: 5 });

    withTimeout(processAirtableUpdates(), 65000, 'Airtable update')
      .catch(err => logger.log('error', `Airtable update error: ${err.message}`));
    withTimeout(processGoogleSheetUpdates(), 65000, 'Google Sheets update')
      .catch(err => logger.log('error', `Google Sheets update error: ${err.message}`));
  } catch (err: any) {
    logger.log('error', `Failed to update integrations for run: ${runId}: ${err.message}`);
  }
}

const getRobotTargetUrl = (recording: any): string => {
  const metaUrl = recording?.recording_meta?.url?.trim();
  if (metaUrl) return metaUrl;

  const workflow = recording?.recording?.workflow || [];
  const entryPair = [...workflow].reverse().find((pair: any) =>
    pair?.what?.some((action: any) => action.action === 'goto' && typeof action.args?.[0] === 'string' && action.args[0] !== 'about:blank'),
  );
  const gotoUrl = entryPair?.what?.find((action: any) => action.action === 'goto' && typeof action.args?.[0] === 'string')?.args?.[0]?.trim();
  if (gotoUrl) return gotoUrl;

  return workflow.find((pair: any) => typeof pair?.where?.url === 'string' && pair.where.url !== 'about:blank')?.where?.url?.trim() || '';
};

async function processRunExecution(data: ExecuteRunData): Promise<void> {
  const BROWSER_INIT_TIMEOUT = 60000;
  const BROWSER_PAGE_TIMEOUT = 15000;

  logger.log('info', `Processing run execution job for runId: ${data.runId}, browserId: ${data.browserId}`);

  try {
    const run = await Run.findOne({ where: { runId: data.runId } });
    if (!run) {
      logger.log('error', `Run ${data.runId} not found in database`);
      return;
    }

    if (run.status === 'aborted' || run.status === 'aborting') {
      logger.log('info', `Run ${data.runId} has status ${run.status}, skipping execution`);
      return;
    }

    if (run.status === 'queued') {
      logger.log('info', `Run ${data.runId} has status 'queued', skipping stale execution job`);
      return;
    }

    const plainRun = run.toJSON();

    if ((plainRun.interpreterSettings as any)?.robotType === 'doc-extract') {
      logger.log('info', `Run ${data.runId} is a document robot — skipping browser, running document extraction`);
      const recording = await Robot.findOne({ where: { 'recording_meta.id': plainRun.robotMetaId }, raw: true });
      if (!recording) {
        logger.log('error', `Robot not found for document run ${data.runId}`);
        await run.update({ status: 'failed', finishedAt: new Date().toLocaleString(), log: 'Robot not found' });
        return;
      }
      const { executeDocumentRun } = await import('./utils/document/executeDocumentRun');
      await executeDocumentRun(recording, run, data.userId, serverIo);
      return;
    }

    if ((plainRun.interpreterSettings as any)?.robotType === 'doc-parse') {
      logger.log('info', `Run ${data.runId} is a document-parse robot — skipping browser, running document parsing`);
      const recording = await Robot.findOne({ where: { 'recording_meta.id': plainRun.robotMetaId }, raw: true });
      if (!recording) {
        logger.log('error', `Robot not found for document-parse run ${data.runId}`);
        await run.update({ status: 'failed', finishedAt: new Date().toLocaleString(), log: 'Robot not found' });
        return;
      }
      const { executeDocumentParseRun } = await import('./utils/document/executeDocumentParseRun');
      await executeDocumentParseRun(recording, run, data.userId, serverIo);
      return;
    }

    const browserId = data.browserId || plainRun.browserId;

    if (!browserId) throw new Error(`No browser ID available for run ${data.runId}`);

    logger.log('info', `Looking for browser ${browserId} for run ${data.runId}`);

    let browser = browserPool.getRemoteBrowser(browserId);
    const browserWaitStart = Date.now();
    let lastLogTime = 0;
    let pollAttempts = 0;
    const MAX_POLL_ATTEMPTS = Math.ceil(BROWSER_INIT_TIMEOUT / 2000);

    while (!browser && (Date.now() - browserWaitStart) < BROWSER_INIT_TIMEOUT && pollAttempts < MAX_POLL_ATTEMPTS) {
      const currentTime = Date.now();
      pollAttempts++;

      const browserStatus = browserPool.getBrowserStatus(browserId);
      if (browserStatus === null) throw new Error(`Browser slot ${browserId} does not exist in pool`);
      if (browserStatus === 'failed') throw new Error(`Browser ${browserId} initialization failed`);

      if (currentTime - lastLogTime > 10000) {
        logger.log('info', `Browser ${browserId} not ready yet (status: ${browserStatus}), waiting... (${Math.round((currentTime - browserWaitStart) / 1000)}s elapsed)`);
        lastLogTime = currentTime;
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
      browser = browserPool.getRemoteBrowser(browserId);
    }

    if (!browser) {
      const finalStatus = browserPool.getBrowserStatus(browserId);
      throw new Error(`Browser ${browserId} not found in pool after ${BROWSER_INIT_TIMEOUT / 1000}s timeout (final status: ${finalStatus})`);
    }

    logger.log('info', `Browser ${browserId} found and ready for execution`);

    try {
      const recording = await Robot.findOne({ where: { 'recording_meta.id': plainRun.robotMetaId }, raw: true });
      if (!recording) throw new Error(`Recording for run ${data.runId} not found`);

      let currentPage = browser.getCurrentPage();
      const pageWaitStart = Date.now();
      let lastPageLogTime = 0;
      let pageAttempts = 0;

      while (!currentPage && (Date.now() - pageWaitStart) < BROWSER_PAGE_TIMEOUT && pageAttempts < 15) {
        const currentTime = Date.now();
        pageAttempts++;
        if (currentTime - lastPageLogTime > 5000) {
          logger.log('info', `Page not ready for browser ${browserId}, waiting...`);
          lastPageLogTime = currentTime;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        currentPage = browser.getCurrentPage();
      }

      if (!currentPage) throw new Error(`No current page available for browser ${browserId} after ${BROWSER_PAGE_TIMEOUT / 1000}s timeout`);

      if (recording.recording_meta.type === 'scrape') {
        logger.log('info', `Executing scrape robot for run ${data.runId}`);

        const rawFormats = run.interpreterSettings?.formats || recording.recording_meta.formats;
        const formats = rawFormats && rawFormats.length > 0 ? rawFormats : ['markdown'];

        await run.update({ status: 'running', log: `Converting page to ${formats.join(', ')}` });

        try {
          const url = getRobotTargetUrl(recording);
          if (!url) throw new Error('No URL specified for scrape robot');

          const serializableOutput: any = {};
          const binaryOutput: any = {};
          const SCRAPE_TIMEOUT = 120000;

          if (formats.includes('screenshot-visible')) {
            const buf = await Promise.race([convertPageToScreenshot(url, currentPage, false), new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), SCRAPE_TIMEOUT))]);
            if (!binaryOutput['screenshot-visible']) binaryOutput['screenshot-visible'] = { data: buf.toString('base64'), mimeType: 'image/png' };
          }

          if (formats.includes('screenshot-fullpage')) {
            const buf = await Promise.race([convertPageToScreenshot(url, currentPage, true), new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), SCRAPE_TIMEOUT))]);
            if (!binaryOutput['screenshot-fullpage']) binaryOutput['screenshot-fullpage'] = { data: buf.toString('base64'), mimeType: 'image/png' };
          }

          if (formats.includes('text')) {
            const text = await Promise.race([convertPageToText(url, currentPage), new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), SCRAPE_TIMEOUT))]);
            if (text) serializableOutput.text = [{ content: text }];
          }

          let markdown = '';
          if (formats.includes('markdown') || formats.includes('summary')) {
            try {
              markdown = await Promise.race([convertPageToMarkdown(url, currentPage), new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), SCRAPE_TIMEOUT))]);
              if (markdown && markdown.trim().length > 0 && formats.includes('markdown')) {
                serializableOutput.markdown = [{ content: markdown }];
              }
            } catch (error: any) {
              logger.log('warn', `Markdown conversion failed for run ${data.runId}: ${error.message}`);
            }
          }

          if (formats.includes('summary')) {
            try {
              if (!markdown) {
                markdown = await Promise.race([convertPageToMarkdown(url, currentPage), new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), SCRAPE_TIMEOUT))]);
              }
              if (markdown && markdown.trim().length > 0) {
                const { summarizeMarkdown } = require('./utils/summarizer');
                const llmConfig = {
                  provider: ((recording.recording_meta as any).promptLlmProvider || 'ollama') as 'anthropic' | 'openai' | 'ollama',
                  model: (recording.recording_meta as any).promptLlmModel as string | undefined,
                  apiKey: (recording.recording_meta as any).promptLlmApiKey as string | undefined,
                  baseUrl: (recording.recording_meta as any).promptLlmBaseUrl as string | undefined,
                };
                const summaryText = await summarizeMarkdown(markdown, llmConfig);
                serializableOutput.summary = [{ content: summaryText }];
              }
            } catch (error: any) {
              logger.log('warn', `Summary generation failed for run ${data.runId}: ${error.message}`);
            }
          }

          if (formats.includes('html')) {
            const html = await Promise.race([convertPageToHTML(url, currentPage), new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), SCRAPE_TIMEOUT))]);
            serializableOutput.html = [{ content: html }];
          }

          if (formats.includes('links')) {
            try {
              const links = await Promise.race([convertPageToLinks(url, currentPage), new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), SCRAPE_TIMEOUT))]);
              if (links && links.length > 0) serializableOutput.links = links.map((link: string) => ({ url: link }));
            } catch (error: any) {
              logger.log('warn', `Links extraction failed for run ${data.runId}: ${error.message}`);
            }
          }

          const promptInstructions = run.interpreterSettings?.promptInstructions || (recording.recording_meta as any).promptInstructions as string | undefined;
          if (promptInstructions) {
            try {
              const llmConfig = {
                provider: ((recording.recording_meta as any).promptLlmProvider || 'ollama') as 'anthropic' | 'openai' | 'ollama',
                model: (recording.recording_meta as any).promptLlmModel as string | undefined,
                apiKey: (recording.recording_meta as any).promptLlmApiKey as string | undefined,
                baseUrl: (recording.recording_meta as any).promptLlmBaseUrl as string | undefined,
              };
              await run.update({ log: 'Running smart query...' });
              const agentResult = await executeBrowserAgent(currentPage, promptInstructions, llmConfig);
              serializableOutput.promptResult = [{ content: agentResult.result, steps: agentResult.steps }];
            } catch (agentError: any) {
              logger.log('warn', `Smart query failed for run ${data.runId}: ${agentError.message}`);
              serializableOutput.promptResult = [{ content: `Smart query failed: ${agentError.message}`, steps: [] }];
            }
          }

          await run.update({ status: 'success', finishedAt: new Date().toLocaleString(), log: `${formats.join(', ').toUpperCase()} conversion completed successfully`, serializableOutput, binaryOutput });

          let uploadedBinaryOutput: Record<string, string> = {};
          if (Object.keys(binaryOutput).length > 0) {
            const svc = new BinaryOutputService('maxun-run-screenshots');
            uploadedBinaryOutput = await svc.uploadAndStoreBinaryOutput(run, binaryOutput);
            await run.update({ binaryOutput: uploadedBinaryOutput });
          }

          try {
            const completionData = { runId: data.runId, robotMetaId: plainRun.robotMetaId, robotName: recording.recording_meta.name, status: 'success', finishedAt: new Date().toLocaleString() };
            serverIo.of(browserId).emit('run-completed', completionData);
            serverIo.of('/queued-run').to(`user-${data.userId}`).emit('run-completed', completionData);
          } catch (socketError: any) {
            logger.log('warn', `Failed to send run-completed notification for run ${data.runId}: ${socketError.message}`);
          }

          try {
            const webhookPayload: any = { runId: data.runId, robotId: plainRun.robotMetaId, robotName: recording.recording_meta.name, status: 'success', finishedAt: new Date().toLocaleString() };
            if (serializableOutput.markdown) webhookPayload.markdown = serializableOutput.markdown[0]?.content || '';
            if (serializableOutput.html) webhookPayload.html = serializableOutput.html[0]?.content || '';
            if (serializableOutput.links) webhookPayload.links = serializableOutput.links;
            if (serializableOutput.summary) webhookPayload.summary = serializableOutput.summary[0]?.content || '';
            await sendWebhook(plainRun.robotMetaId, 'run_completed', webhookPayload);
          } catch (webhookError: any) {
            logger.log('warn', `Failed to send webhooks for run ${data.runId}: ${webhookError.message}`);
          }

          capture('maxun-oss-run-created', { runId: data.runId, user_id: data.userId, status: 'success', robot_type: 'scrape', formats, source: 'manual' });
          await destroyRemoteBrowser(browserId, data.userId);
          return;

        } catch (error: any) {
          logger.log('error', `Scrape conversion failed for run ${data.runId}: ${error.message}`);
          await run.update({ status: 'failed', finishedAt: new Date().toLocaleString(), log: `Conversion failed: ${error.message}` });
          try {
            const failureData = { runId: data.runId, robotMetaId: plainRun.robotMetaId, robotName: recording.recording_meta.name, status: 'failed', finishedAt: new Date().toLocaleString() };
            serverIo.of(browserId).emit('run-completed', failureData);
            serverIo.of('/queued-run').to(`user-${data.userId}`).emit('run-completed', failureData);
          } catch (_) {}
          capture('maxun-oss-run-created', { runId: data.runId, user_id: data.userId, status: 'failed', robot_type: 'scrape', source: 'manual' });
          await destroyRemoteBrowser(browserId, data.userId);
          throw error;
        }
      }

      const isRunAborted = async (): Promise<boolean> => {
        try {
          const currentRun = await Run.findOne({ where: { runId: data.runId } });
          return currentRun ? (currentRun.status === 'aborted' || currentRun.status === 'aborting') : false;
        } catch { return false; }
      };

      logger.log('info', `Starting workflow execution for run ${data.runId}`);
      await run.update({ status: 'running', log: 'Workflow execution started' });

      try {
        const startedData = { runId: data.runId, robotMetaId: plainRun.robotMetaId, robotName: recording.recording_meta.name, status: 'running', startedAt: new Date().toLocaleString() };
        serverIo.of(browserId).emit('run-started', startedData);
        serverIo.of('/queued-run').to(`user-${data.userId}`).emit('run-started', startedData);
      } catch (socketError: any) {
        logger.log('warn', `Failed to send run-started notification for run ${data.runId}: ${socketError.message}`);
      }

      browser.interpreter.setRunId(data.runId);

      const INTERPRETATION_TIMEOUT = 600000;
      const interpretationPromise = browser.interpreter.InterpretRecording(
        AddGeneratedFlags(recording.recording),
        currentPage,
        (newPage: Page) => currentPage = newPage,
        plainRun.interpreterSettings,
      );

      const interpretationInfo = await Promise.race([
        interpretationPromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Workflow interpretation timed out after ${INTERPRETATION_TIMEOUT / 1000}s`)), INTERPRETATION_TIMEOUT))
      ]);

      if (await isRunAborted()) {
        logger.log('info', `Run ${data.runId} was aborted during execution, not updating status`);
        try { await browser.interpreter.clearState(); } catch (_) {}
        await destroyRemoteBrowser(plainRun.browserId, data.userId);
        return;
      }

      logger.log('info', `Workflow execution completed for run ${data.runId}`);

      const finalRun = await Run.findByPk(run.id);
      const categorizedOutput = {
        scrapeSchema: finalRun?.serializableOutput?.scrapeSchema || {},
        scrapeList: finalRun?.serializableOutput?.scrapeList || {},
        crawl: finalRun?.serializableOutput?.crawl || {},
        search: finalRun?.serializableOutput?.search || {}
      };

      let binaryOutput: Record<string, any> = { ...(interpretationInfo.binaryOutput || {}) };

      const robotType = recording.recording_meta.type;
      const outputFormats = (recording.recording_meta as any).formats as string[] | undefined;
      if (robotType === 'crawl' || robotType === 'search') {
        const processedOutput = await processRobotOutputFormats({
          robotType,
          outputFormats,
          categorizedOutput: { crawl: categorizedOutput.crawl as Record<string, any>, search: categorizedOutput.search as Record<string, any> },
          currentPage,
          initialBinaryOutput: binaryOutput,
          llmConfig: {
            provider: ((recording.recording_meta as any).promptLlmProvider || 'ollama') as 'anthropic' | 'openai' | 'ollama',
            model: (recording.recording_meta as any).promptLlmModel as string | undefined,
            apiKey: (recording.recording_meta as any).promptLlmApiKey as string | undefined,
            baseUrl: (recording.recording_meta as any).promptLlmBaseUrl as string | undefined,
          },
        });

        categorizedOutput.crawl = processedOutput.categorizedOutput.crawl;
        categorizedOutput.search = processedOutput.categorizedOutput.search;
        binaryOutput = processedOutput.binaryOutput;

        const hasOutput = hasExpectedRobotOutput(robotType, { crawl: categorizedOutput.crawl as Record<string, any>, search: categorizedOutput.search as Record<string, any> }, outputFormats, binaryOutput);
        if (!hasOutput) {
          const humanRobotType = robotType.charAt(0).toUpperCase() + robotType.slice(1);
          throw new Error(getInterpretationFailureReason(interpretationInfo.log, `${humanRobotType} run completed without producing output data`));
        }
      }

      const binarySvc = new BinaryOutputService('maxun-run-screenshots');
      const uploadedBinaryOutput = Object.keys(binaryOutput).length > 0 ? await binarySvc.uploadAndStoreBinaryOutput(run, binaryOutput) : {};

      if (await isRunAborted()) {
        logger.log('info', `Run ${data.runId} was aborted while processing results, not updating status`);
        return;
      }

      await run.update({
        status: 'success',
        finishedAt: new Date().toLocaleString(),
        log: interpretationInfo.log.join('\n'),
        binaryOutput: uploadedBinaryOutput,
        serializableOutput: { ...(finalRun?.serializableOutput || {}), crawl: categorizedOutput.crawl, search: categorizedOutput.search }
      });

      let totalSchemaItemsExtracted = 0;
      let totalListItemsExtracted = 0;
      if (categorizedOutput.scrapeSchema) Object.values(categorizedOutput.scrapeSchema).forEach((v: any) => { totalSchemaItemsExtracted += Array.isArray(v) ? v.length : (v ? 1 : 0); });
      if (categorizedOutput.scrapeList) Object.values(categorizedOutput.scrapeList).forEach((v: any) => { totalListItemsExtracted += Array.isArray(v) ? v.length : 0; });

      capture('maxun-oss-run-created', { runId: data.runId, user_id: data.userId, created_at: new Date().toISOString(), status: 'success', totalRowsExtracted: totalSchemaItemsExtracted + totalListItemsExtracted, schemaItemsExtracted: totalSchemaItemsExtracted, listItemsExtracted: totalListItemsExtracted, extractedScreenshotsCount: Object.keys(uploadedBinaryOutput).length, is_llm: (recording.recording_meta as any).isLLM, source: 'manual' });

      try {
        const completionData = { runId: data.runId, robotMetaId: plainRun.robotMetaId, robotName: recording.recording_meta.name, status: 'success', finishedAt: new Date().toLocaleString() };
        serverIo.of(browserId).emit('run-completed', completionData);
        serverIo.of('/queued-run').to(`user-${data.userId}`).emit('run-completed', completionData);
      } catch (socketError: any) {
        logger.log('warn', `Failed to send run-completed notification for run ${data.runId}: ${socketError.message}`);
      }

      try {
        await sendWebhook(plainRun.robotMetaId, 'run_completed', {
          robot_id: plainRun.robotMetaId, run_id: data.runId, robot_name: recording.recording_meta.name, status: 'success',
          started_at: plainRun.startedAt, finished_at: new Date().toLocaleString(),
          extracted_data: {
            captured_texts: Object.keys(categorizedOutput.scrapeSchema || {}).length > 0 ? Object.entries(categorizedOutput.scrapeSchema).reduce((acc, [name, value]) => { acc[name] = Array.isArray(value) ? value : [value]; return acc; }, {} as Record<string, any[]>) : {},
            captured_lists: categorizedOutput.scrapeList,
            crawl_data: categorizedOutput.crawl, search_data: categorizedOutput.search,
            captured_texts_count: totalSchemaItemsExtracted, captured_lists_count: totalListItemsExtracted, screenshots_count: Object.keys(uploadedBinaryOutput).length
          },
          metadata: { browser_id: plainRun.browserId, user_id: data.userId }
        });
      } catch (webhookError: any) {
        logger.log('error', `Failed to send webhooks for run ${data.runId}: ${webhookError.message}`);
      }

      await triggerIntegrationUpdates(plainRun.runId, plainRun.robotMetaId);
      await destroyRemoteBrowser(browserId, data.userId);
      logger.log('info', `Browser ${browserId} destroyed after successful run ${data.runId}`);

    } catch (executionError: any) {
      logger.log('error', `Run execution failed for run ${data.runId}: ${executionError.message}`);

      const browserId = data.browserId || (run as any).toJSON().browserId;
      let partialDataExtracted = false;

      try {
        const hasData = (run.serializableOutput && (
          (run.serializableOutput.scrapeSchema && run.serializableOutput.scrapeSchema.length > 0) ||
          (run.serializableOutput.scrapeList && run.serializableOutput.scrapeList.length > 0) ||
          (run.serializableOutput.crawl && Object.keys(run.serializableOutput.crawl).length > 0) ||
          (run.serializableOutput.search && Object.keys(run.serializableOutput.search).length > 0))) ||
          (run.binaryOutput && Object.keys(run.binaryOutput).length > 0);
        if (hasData) {
          await triggerIntegrationUpdates((run as any).toJSON().runId, (run as any).toJSON().robotMetaId);
          partialDataExtracted = true;
        }
      } catch (_) {}

      await run.update({ status: 'failed', finishedAt: new Date().toLocaleString(), log: `Failed: ${executionError.message}` });

      const plainRun = (run as any).toJSON();
      const recording = await Robot.findOne({ where: { 'recording_meta.id': run.robotMetaId }, raw: true });

      try {
        const failureData = { runId: data.runId, robotMetaId: plainRun.robotMetaId, robotName: recording ? recording.recording_meta.name : 'Unknown Robot', status: 'failed', finishedAt: new Date().toLocaleString(), hasPartialData: partialDataExtracted };
        serverIo.of(browserId).emit('run-completed', failureData);
        serverIo.of('/queued-run').to(`user-${data.userId}`).emit('run-completed', failureData);
      } catch (_) {}

      try {
        await sendWebhook(plainRun.robotMetaId, 'run_failed', {
          robot_id: plainRun.robotMetaId, run_id: data.runId, robot_name: recording ? recording.recording_meta.name : 'Unknown Robot',
          status: 'failed', started_at: plainRun.startedAt, finished_at: new Date().toLocaleString(),
          error: { message: executionError.message, stack: executionError.stack, type: 'ExecutionError' },
          partial_data_extracted: partialDataExtracted, metadata: { browser_id: plainRun.browserId, user_id: data.userId }
        });
      } catch (_) {}

      capture('maxun-oss-run-created', { runId: data.runId, user_id: data.userId, created_at: new Date().toISOString(), status: 'failed', error_message: executionError.message, partial_data_extracted: partialDataExtracted, source: 'manual' });

      try { if (browser && browser.interpreter) await browser.interpreter.clearState(); } catch (_) {}
      await destroyRemoteBrowser(browserId, data.userId);
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to process run execution job: ${errorMessage}`);

    try {
      const run = await Run.findOne({ where: { runId: data.runId } });
      if (run) {
        await run.update({ status: 'failed', finishedAt: new Date().toLocaleString(), log: `Failed: ${errorMessage}` });
        const recording = await Robot.findOne({ where: { 'recording_meta.id': run.robotMetaId }, raw: true });
        try {
          await sendWebhook(run.robotMetaId, 'run_failed', {
            robot_id: run.robotMetaId, run_id: data.runId, robot_name: recording ? recording.recording_meta.name : 'Unknown Robot',
            status: 'failed', started_at: run.startedAt, finished_at: new Date().toLocaleString(),
            error: { message: errorMessage }, metadata: { browser_id: run.browserId, user_id: data.userId }
          });
        } catch (_) {}
        try {
          serverIo.of(run.browserId).emit('run-completed', { runId: data.runId, robotMetaId: run.robotMetaId, robotName: recording ? recording.recording_meta.name : 'Unknown Robot', status: 'failed', finishedAt: new Date().toLocaleString() });
          serverIo.of('/queued-run').to(`user-${data.userId}`).emit('run-completed', { runId: data.runId, status: 'failed' });
        } catch (_) {}
      }
    } catch (_) {}

    throw error;
  }
}

async function abortRun(runId: string, userId: string): Promise<void> {
  try {
    const run = await Run.findOne({ where: { runId } });
    if (!run) {
      logger.log('warn', `Run ${runId} not found`);
      return;
    }

    await run.update({ status: 'aborting' });

    const plainRun = run.toJSON();
    const recording = await Robot.findOne({ where: { 'recording_meta.id': plainRun.robotMetaId }, raw: true });
    const robotName = recording?.recording_meta?.name || 'Unknown Robot';

    let browser;
    try { browser = browserPool.getRemoteBrowser(plainRun.browserId); } catch { browser = null; }

    if (!browser) {
      await run.update({ status: 'aborted', finishedAt: new Date().toLocaleString(), log: 'Aborted: Browser not found or already closed' });
      try { serverIo.of(plainRun.browserId).emit('run-aborted', { runId, robotName, status: 'aborted', finishedAt: new Date().toLocaleString() }); } catch (_) {}
      return;
    }

    await run.update({ status: 'aborted', finishedAt: new Date().toLocaleString(), log: 'Run aborted by user' });

    const hasData = (run.serializableOutput && (
      (run.serializableOutput.scrapeSchema && run.serializableOutput.scrapeSchema.length > 0) ||
      (run.serializableOutput.scrapeList && run.serializableOutput.scrapeList.length > 0))) ||
      (run.binaryOutput && Object.keys(run.binaryOutput).length > 0);

    if (hasData) await triggerIntegrationUpdates(runId, plainRun.robotMetaId);

    try { serverIo.of(plainRun.browserId).emit('run-aborted', { runId, robotName, status: 'aborted', finishedAt: new Date().toLocaleString() }); } catch (_) {}

    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      await destroyRemoteBrowser(plainRun.browserId, userId);
    } catch (cleanupError) {
      logger.log('warn', `Failed to clean up browser for aborted run ${runId}: ${cleanupError}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to abort run ${runId}: ${errorMessage}`);
    throw error;
  }
}

const taskList: TaskList = {
  [QUEUE_NAMES.INITIALIZE_BROWSER_RECORDING]: async (payload: unknown) => {
    const data = payload as InitializeBrowserData;
    logger.log('info', `Starting browser initialization job for user: ${data.userId}`);
    initializeRemoteBrowserForRecording(data.userId);
    logger.log('info', `Browser initialization triggered for user: ${data.userId}`);
  },

  [QUEUE_NAMES.DESTROY_BROWSER]: async (payload: unknown) => {
    const data = payload as DestroyBrowserData;
    logger.log('info', `Starting browser destruction job for browser: ${data.browserId}`);
    await destroyRemoteBrowser(data.browserId, data.userId);
    logger.log('info', `Browser ${data.browserId} destroyed`);
  },

  [QUEUE_NAMES.INTERPRET_WORKFLOW]: async (payload: unknown) => {
    const data = payload as InterpretWorkflow;
    logger.log('info', 'Starting workflow interpretation job');
    await interpretWholeWorkflow(data.userId);
    logger.log('info', 'Workflow interpretation job completed');
  },

  [QUEUE_NAMES.STOP_INTERPRETATION]: async (payload: unknown) => {
    const data = payload as StopInterpretWorkflow;
    logger.log('info', 'Starting stop interpretation job');
    await stopRunningInterpretation(data.userId);
    logger.log('info', 'Stop interpretation job completed');
  },

  [QUEUE_NAMES.EXECUTE_RUN]: async (payload: unknown) => {
    await processRunExecution(payload as ExecuteRunData);
  },

  [QUEUE_NAMES.ABORT_RUN]: async (payload: unknown) => {
    const data = payload as AbortRunData;
    logger.log('info', `Processing abort request for run ${data.runId} by user ${data.userId}`);
    await abortRun(data.runId, data.userId);
  },

  [QUEUE_NAMES.SCHEDULED_WORKFLOW]: async (payload: unknown) => {
    const data = payload as ScheduledWorkflowData;
    logger.log('info', `Processing scheduled workflow for robot ${data.robotMetaId}`);
    await handleRunRecording(data.robotMetaId, data.userId);
  },
};

let runner: Runner | null = null;
let runnerPool: Pool | null = null;
let workersStarted = false;

export async function startWorkers(): Promise<void> {
  if (workersStarted) {
    logger.log('warn', 'Graphile Worker runner already started, skipping...');
    return;
  }

  try {
    logger.log('info', 'Starting Graphile Worker runner...');

    runnerPool = new Pool({
      connectionString,
      max: TOTAL_CONCURRENCY + 2,
      ssl: useSSL ? true : undefined,
    });

    runner = await run({
      pgPool: runnerPool,
      concurrency: TOTAL_CONCURRENCY,
      noHandleSignals: true,
      pollInterval: 3600000,
      taskList,
    });

    runner.events.on('job:error', ({ job, error }: { job: any; error: unknown }) => {
      const msg = error instanceof Error ? error.message : String(error);
      logger.log('error', `Job error for job ${job?.id} (${job?.task_identifier}): ${msg}`);
    });

    workersStarted = true;
    logger.log('info', `Graphile Worker runner started (concurrency: ${TOTAL_CONCURRENCY})`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to start Graphile Worker runner: ${errorMessage}`);
    throw error;
  }
}

export async function stopWorkers(): Promise<void> {
  if (!workersStarted || !runner) return;

  try {
    await runner.stop();
    runner = null;
  } catch (error: any) {
    logger.log('warn', `Error stopping Graphile Worker runner: ${error.message}`);
  }

  try {
    if (runnerPool) {
      await runnerPool.end();
      runnerPool = null;
    }
  } catch (error: any) {
    logger.log('warn', `Error closing runner pool: ${error.message}`);
  }

  workersStarted = false;
  logger.log('info', 'Graphile Worker runner stopped');
}
