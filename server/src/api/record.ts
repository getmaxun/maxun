import { Router, Request, Response } from 'express';
import { requireAPIKey } from "../middlewares/api";
import Robot from "../models/Robot";
import Run from "../models/Run";
import { getDecryptedProxyConfig } from "../routes/proxy";
import { v4 as uuid } from "uuid";
import { createRemoteBrowserForRun, destroyRemoteBrowser } from "../browser-management/controller";
import logger from "../logger";
import { browserPool, io as serverIo } from "../server";
import { io, Socket } from "socket.io-client";
import { BinaryOutputService } from "../storage/mino";
import { AuthenticatedRequest } from "../routes/record"
import {capture} from "../utils/analytics";
import { Page } from "playwright-core";
import { WorkflowFile } from "maxun-core";
import { addGoogleSheetUpdateTask, processGoogleSheetUpdates } from "../workflow-management/integrations/gsheet";
import { addAirtableUpdateTask, processAirtableUpdates } from "../workflow-management/integrations/airtable";
import { sendWebhook } from "../routes/webhook";
import { convertPageToHTML, convertPageToMarkdown, convertPageToScreenshot } from '../markdownify/scrape';

const router = Router();

const formatRecording = (recordingData: any) => {
    const recordingMeta = recordingData.recording_meta;
    const workflow = recordingData.recording.workflow || [];
    const firstWorkflowStep = workflow[0]?.where?.url || '';

    const inputParameters = [
        {
            type: "string",
            name: "originUrl",
            label: "Origin URL",
            required: true,
            defaultValue: firstWorkflowStep,
        },
    ];

    return {
        id: recordingMeta.id,
        name: recordingMeta.name,
        createdAt: new Date(recordingMeta.createdAt).getTime(),
        inputParameters,
    };
};

/**
 * @swagger
 * /api/robots:
 *   get:
 *     summary: Get all robots
 *     description: Retrieve a list of all robots.
 *     security:
 *       - api_key: []
 *     responses:
 *       200:
 *         description: A list of robots.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 statusCode:
 *                   type: integer
 *                   example: 200
 *                 messageCode:
 *                   type: string
 *                   example: success
 *                 robots:
 *                   type: object
 *                   properties:
 *                     totalCount:
 *                       type: integer
 *                       example: 5
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             example: "12345"
 *                           name:
 *                             type: string
 *                             example: "Sample Robot"
 *       500:
 *         description: Error retrieving robots.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 statusCode:
 *                   type: integer
 *                   example: 500
 *                 messageCode:
 *                   type: string
 *                   example: error
 *                 message:
 *                   type: string
 *                   example: "Failed to retrieve robots"
 */
router.get("/robots", requireAPIKey, async (req: Request, res: Response) => {
    try {
        const robots = await Robot.findAll({ raw: true });
        const formattedRecordings = robots.map(formatRecording);

        const response = {
            statusCode: 200,
            messageCode: "success",
            robots: {
                totalCount: formattedRecordings.length,
                items: formattedRecordings,
            },
        };

        res.status(200).json(response);
    } catch (error) {
        console.error("Error fetching robots:", error);
        res.status(500).json({
            statusCode: 500,
            messageCode: "error",
            message: "Failed to retrieve robots",
        });
    }
});


const formatRecordingById = (recordingData: any) => {
    const recordingMeta = recordingData.recording_meta;
    const workflow = recordingData.recording.workflow || [];
    const firstWorkflowStep = workflow[0]?.where?.url || '';

    const inputParameters = [
        {
            type: "string",
            name: "originUrl",
            label: "Origin URL",
            required: true,
            defaultValue: firstWorkflowStep,
        },
    ];

    return {
        id: recordingMeta.id,
        name: recordingMeta.name,
        createdAt: new Date(recordingMeta.createdAt).getTime(),
        inputParameters,
    };
};

/**
 * @swagger
 * /api/robots/{id}:
 *   get:
 *     summary: Get robot by ID
 *     description: Retrieve a robot by its ID.
 *     security:
 *       - api_key: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The ID of the robot to retrieve.
 *     responses:
 *       200:
 *         description: Robot details.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 statusCode:
 *                   type: integer
 *                   example: 200
 *                 messageCode:
 *                   type: string
 *                   example: success
 *                 robot:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: "12345"
 *                     name:
 *                       type: string
 *                       example: "Sample Robot"
 *       404:
 *         description: Robot not found.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 statusCode:
 *                   type: integer
 *                   example: 404
 *                 messageCode:
 *                   type: string
 *                   example: not_found
 *                 message:
 *                   type: string
 *                   example: "Recording with ID not found."
 */
router.get("/robots/:id", requireAPIKey, async (req: Request, res: Response) => {
    try {
        const robot = await Robot.findOne({
            where: {
                'recording_meta.id': req.params.id
            },
            raw: true
        });

        const formattedRecording = formatRecordingById(robot);

        const response = {
            statusCode: 200,
            messageCode: "success",
            robot: formattedRecording,
        };

        res.status(200).json(response);
    } catch (error) {
        console.error("Error fetching robot:", error);
        res.status(404).json({
            statusCode: 404,
            messageCode: "not_found",
            message: `Robot with ID "${req.params.id}" not found.`,
        });
    }
});

/**
 * @swagger
 * /api/robots/{id}/runs:
 *   get:
 *     summary: Get all runs for a robot
 *     description: Retrieve all runs associated with a specific robot.
 *     security:
 *       - api_key: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The ID of the robot.
 *     responses:
 *       200:
 *         description: A list of runs for the robot.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 statusCode:
 *                   type: integer
 *                   example: 200
 *                 messageCode:
 *                   type: string
 *                   example: success
 *                 runs:
 *                   type: object
 *                   properties:
 *                     totalCount:
 *                       type: integer
 *                       example: 5
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           runId:
 *                             type: string
 *                             example: "67890"
 *                           status:
 *                             type: string
 *                             example: "completed"
 *       500:
 *         description: Error retrieving runs.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 statusCode:
 *                   type: integer
 *                   example: 500
 *                 messageCode:
 *                   type: string
 *                   example: error
 *                 message:
 *                   type: string
 *                   example: "Failed to retrieve runs"
 */
router.get("/robots/:id/runs",requireAPIKey, async (req: Request, res: Response) => {
    try {
        const runs = await Run.findAll({
            where: {
                robotMetaId: req.params.id
            },
            raw: true
        });

        const formattedRuns = runs.map(formatRunResponse);

        const response = {
            statusCode: 200,
            messageCode: "success",
            runs: {
                totalCount: formattedRuns.length,
                items: formattedRuns,
            },
        };

        res.status(200).json(response);
    } catch (error) {
        console.error("Error fetching runs:", error);
        res.status(500).json({
            statusCode: 500,
            messageCode: "error",
            message: "Failed to retrieve runs",
        });
    }
}
);


function formatRunResponse(run: any) {
    const formattedRun = {
        id: run.id,
        status: run.status,
        name: run.name,
        robotId: run.robotMetaId,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        runId: run.runId,
        runByUserId: run.runByUserId,
        runByScheduleId: run.runByScheduleId,
        runByAPI: run.runByAPI,
        runBySDK: run.runBySDK,
        data: {
            textData: {},
            listData: {},
            crawlData: {},
            searchData: {},
            markdown: '',
            html: ''
        },
        screenshots: [] as any[],
    };

    const output = run.serializableOutput || {};

    if (output.scrapeSchema && typeof output.scrapeSchema === 'object') {
        formattedRun.data.textData = output.scrapeSchema;
    }

    if (output.scrapeList && typeof output.scrapeList === 'object') {
        formattedRun.data.listData = output.scrapeList;
    }

    if (output.crawl && typeof output.crawl === 'object') {
        formattedRun.data.crawlData = output.crawl;
    }

    if (output.search && typeof output.search === 'object') {
        formattedRun.data.searchData = output.search;
    }

    if (output.markdown && Array.isArray(output.markdown)) {
        formattedRun.data.markdown = output.markdown[0]?.content || '';
    }

    if (output.html && Array.isArray(output.html)) {
        formattedRun.data.html = output.html[0]?.content || '';
    }

    if (run.binaryOutput) {
        Object.keys(run.binaryOutput).forEach(key => {
            if (run.binaryOutput[key]) {
                formattedRun.screenshots.push(run.binaryOutput[key]);
            }
        });
    }

    return formattedRun;
}


/**
 * @swagger
 * /api/robots/{id}/runs/{runId}:
 *   get:
 *     summary: Get a specific run by ID for a robot
 *     description: Retrieve details of a specific run by its ID.
 *     security:
 *       - api_key: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The ID of the robot.
 *       - in: path
 *         name: runId
 *         schema:
 *           type: string
 *         required: true
 *         description: The ID of the run.
 *     responses:
 *       200:
 *         description: Run details.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 statusCode:
 *                   type: integer
 *                   example: 200
 *                 messageCode:
 *                   type: string
 *                   example: success
 *                 run:
 *                   type: object
 *                   properties:
 *                     runId:
 *                       type: string
 *                       example: "67890"
 *                     status:
 *                       type: string
 *                       example: "completed"
 *       404:
 *         description: Run not found.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 statusCode:
 *                   type: integer
 *                   example: 404
 *                 messageCode:
 *                   type: string
 *                   example: not_found
 *                 message:
 *                   type: string
 *                   example: "Run with id not found."
 */
router.get("/robots/:id/runs/:runId", requireAPIKey, async (req: Request, res: Response) => {
    try {
        const run = await Run.findOne({
            where: {
                runId: req.params.runId,
                robotMetaId: req.params.id,
            },
            raw: true
        });

        const response = {
            statusCode: 200,
            messageCode: "success",
            run: formatRunResponse(run),
        };

        res.status(200).json(response);
    } catch (error) {
        console.error("Error fetching run:", error);
        res.status(404).json({
            statusCode: 404,
            messageCode: "not_found",
            message: `Run with id "${req.params.runId}" for robot with id "${req.params.id}" not found.`,
        });
    }
});

async function createWorkflowAndStoreMetadata(id: string, userId: string, isSDK: boolean) {
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
            status: 'running',
            name: recording.recording_meta.name,
            robotId: recording.id,
            robotMetaId: recording.recording_meta.id,
            startedAt: new Date().toLocaleString(),
            finishedAt: '',
            browserId,
            interpreterSettings: { maxConcurrency: 1, maxRepeats: 1, debug: true },
            log: '',
            runId,
            runByUserId: userId,
            runByAPI: !isSDK,
            runBySDK: isSDK,
            serializableOutput: {},
            binaryOutput: {},
            retryCount: 0
        });

        const plainRun = run.toJSON();

        try {
            const runStartedData = {
                runId: plainRun.runId,
                robotMetaId: plainRun.robotMetaId,
                robotName: plainRun.name,
                status: 'running',
                startedAt: plainRun.startedAt,
                runByUserId: plainRun.runByUserId,
                runByScheduleId: plainRun.runByScheduleId,
                runByAPI: plainRun.runByAPI || false,
                browserId: plainRun.browserId
            };
            
            serverIo.of('/queued-run').to(`user-${userId}`).emit('run-started', runStartedData);
            logger.log('info', `API run started notification sent for run: ${plainRun.runId} to user-${userId}`);
        } catch (socketError: any) {
            logger.log('warn', `Failed to send run-started notification for API run ${plainRun.runId}: ${socketError.message}`);
        }

        return {
            browserId,
            runId: plainRun.runId,
        }

    } catch (e) {
        const { message } = e as Error;
        logger.log('info', `Error while scheduling a run with id: ${id}`);
        console.log(`Error scheduling run:`, message);
        return {
            success: false,
            error: message,
        };
    }
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
    addGoogleSheetUpdateTask(runId, {
      robotId: robotMetaId,
      runId: runId,
      status: 'pending',
      retries: 5,
    });

    addAirtableUpdateTask(runId, {
      robotId: robotMetaId,
      runId: runId,
      status: 'pending',
      retries: 5,
    });

    withTimeout(processAirtableUpdates(), 65000, 'Airtable update')
      .catch(err => logger.log('error', `Airtable update error: ${err.message}`));

    withTimeout(processGoogleSheetUpdates(), 65000, 'Google Sheets update')
      .catch(err => logger.log('error', `Google Sheets update error: ${err.message}`));
  } catch (err: any) {
    logger.log('error', `Failed to update integrations for run: ${runId}: ${err.message}`);
  }
}

async function readyForRunHandler(browserId: string, id: string, userId: string, socket: Socket, requestedFormats?: string[]){
    try {
        const result = await executeRun(id, userId, requestedFormats);

        if (result && result.success) {
            logger.log('info', `Interpretation of ${id} succeeded`);
            resetRecordingState(browserId, id);
            return result.interpretationInfo;
        } else {
            logger.log('error', `Interpretation of ${id} failed`);
            await destroyRemoteBrowser(browserId, userId);
            resetRecordingState(browserId, id);
            return null;
        }

    } catch (error: any) {
        logger.error(`Error during readyForRunHandler: ${error.message}`);
        await destroyRemoteBrowser(browserId, userId);
        return null;
    } finally {
        cleanupSocketConnection(socket, browserId, id);
    }
}


function resetRecordingState(browserId: string, id: string) {
    browserId = '';
    id = '';
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

async function executeRun(id: string, userId: string, requestedFormats?: string[]) {
    let browser: any = null;
    
    try {
        const run = await Run.findOne({ where: { runId: id } });
        if (!run) {
            return {
                success: false,
                error: 'Run not found'
            };
        }

        const plainRun = run.toJSON();

        if (run.status === 'aborted' || run.status === 'aborting') {
            logger.log('info', `API Run ${id} has status ${run.status}, skipping execution`);
            return { success: true };
        }

        if (run.status === 'queued') {
            logger.log('info', `API Run ${id} has status 'queued', skipping stale execution - will be handled by recovery`);
            return { success: true };
        }

        const retryCount = plainRun.retryCount || 0;
        if (retryCount >= 3) {
            logger.log('warn', `API Run ${id} has exceeded max retries (${retryCount}/3), marking as failed`);
            await run.update({
                status: 'failed',
                finishedAt: new Date().toLocaleString(),
                log: `Max retries exceeded (${retryCount}/3) - Run permanently failed`
            });
            return { success: false, error: 'Max retries exceeded' };
        }

        const recording = await Robot.findOne({ where: { 'recording_meta.id': plainRun.robotMetaId }, raw: true });
        if (!recording) {
            return {
                success: false,
                error: 'Recording not found'
            };
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
            logger.log('info', `Executing scrape robot for API run ${id}`);

            let formats = recording.recording_meta.formats || ['markdown'];

            if (requestedFormats && Array.isArray(requestedFormats) && requestedFormats.length > 0) {
                formats = requestedFormats.filter((f): f is 'markdown' | 'html' | 'screenshot-visible' | 'screenshot-fullpage' =>
                    ['markdown', 'html', 'screenshot-visible', 'screenshot-fullpage'].includes(f)
                );
            }

            await run.update({
                status: 'running',
                log: `Converting page to: ${formats.join(', ')}`
            });

            try {
                const url = recording.recording_meta.url;

                if (!url) {
                    throw new Error('No URL specified for markdown robot');
                }

                let markdown = '';
                let html = '';
                const serializableOutput: any = {};
                const binaryOutput: any = {};

                const SCRAPE_TIMEOUT = 120000;

                if (formats.includes('markdown')) {
                    try {
                        const markdownPromise = convertPageToMarkdown(url, currentPage);
                        const timeoutPromise = new Promise<never>((_, reject) => {
                            setTimeout(() => reject(new Error(`Markdown conversion timed out after ${SCRAPE_TIMEOUT / 1000}s`)), SCRAPE_TIMEOUT);
                        });
                        markdown = await Promise.race([markdownPromise, timeoutPromise]);
                        if (markdown && markdown.trim().length > 0) {
                            serializableOutput.markdown = [{ content: markdown }];
                        }
                    } catch (error: any) {
                        logger.log('warn', `Markdown conversion failed for API run ${plainRun.runId}: ${error.message}`);
                    }
                }

                if (formats.includes('html')) {
                    try {
                        const htmlPromise = convertPageToHTML(url, currentPage);
                        const timeoutPromise = new Promise<never>((_, reject) => {
                            setTimeout(() => reject(new Error(`HTML conversion timed out after ${SCRAPE_TIMEOUT / 1000}s`)), SCRAPE_TIMEOUT);
                        });
                        html = await Promise.race([htmlPromise, timeoutPromise]);
                        if (html && html.trim().length > 0) {
                            serializableOutput.html = [{ content: html }];
                        }
                    } catch (error: any) {
                        logger.log('warn', `HTML conversion failed for API run ${plainRun.runId}: ${error.message}`);
                    }
                }

                if (formats.includes("screenshot-visible")) {
                    try {
                        const screenshotPromise = convertPageToScreenshot(url, currentPage, false);
                        const timeoutPromise = new Promise<never>((_, reject) => {
                            setTimeout(() => reject(new Error(`Screenshot conversion timed out after ${SCRAPE_TIMEOUT / 1000}s`)), SCRAPE_TIMEOUT);
                        });
                        const screenshotBuffer = await Promise.race([screenshotPromise, timeoutPromise]);

                        if (screenshotBuffer && screenshotBuffer.length > 0) {
                            binaryOutput['screenshot-visible'] = {
                                data: screenshotBuffer.toString('base64'),
                                mimeType: 'image/png'
                            };
                        }
                    } catch (error: any) {
                        logger.log('warn', `Screenshot-visible conversion failed for API run ${plainRun.runId}: ${error.message}`);
                    }
                }

                if (formats.includes("screenshot-fullpage")) {
                    try {
                        const screenshotPromise = convertPageToScreenshot(url, currentPage, true);
                        const timeoutPromise = new Promise<never>((_, reject) => {
                            setTimeout(() => reject(new Error(`Screenshot conversion timed out after ${SCRAPE_TIMEOUT / 1000}s`)), SCRAPE_TIMEOUT);
                        });
                        const screenshotBuffer = await Promise.race([screenshotPromise, timeoutPromise]);

                        if (screenshotBuffer && screenshotBuffer.length > 0) {
                            binaryOutput['screenshot-fullpage'] = {
                                data: screenshotBuffer.toString('base64'),
                                mimeType: 'image/png'
                            };
                        }
                    } catch (error: any) {
                        logger.log('warn', `Screenshot-fullpage conversion failed for API run ${plainRun.runId}: ${error.message}`);
                    }
                }

                await run.update({
                    status: 'success',
                    finishedAt: new Date().toLocaleString(),
                    log: `${formats.join(', ')} conversion completed successfully`,
                    serializableOutput,
                    binaryOutput,
                });

                let uploadedBinaryOutput: Record<string, string> = {};
                if (Object.keys(binaryOutput).length > 0) {
                    const binaryOutputService = new BinaryOutputService('maxun-run-screenshots');
                    uploadedBinaryOutput = await binaryOutputService.uploadAndStoreBinaryOutput(run, binaryOutput);
                    await run.update({ binaryOutput: uploadedBinaryOutput });
                }

                logger.log('info', `Markdown robot execution completed for API run ${id}`);

                try {
                    const completionData = {
                        runId: plainRun.runId,
                        robotMetaId: plainRun.robotMetaId,
                        robotName: recording.recording_meta.name,
                        status: 'success',
                        finishedAt: new Date().toLocaleString()
                    };

                    serverIo
                        .of('/queued-run')
                        .to(`user-${userId}`)
                        .emit('run-completed', completionData);
                } catch (socketError: any) {
                    logger.log(
                        'warn',
                        `Failed to send run-completed notification for markdown robot run ${id}: ${socketError.message}`
                    );
                }

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
                    },
                };

                if (serializableOutput.markdown) webhookPayload.markdown = markdown;
                if (serializableOutput.html) webhookPayload.html = html;
                if (uploadedBinaryOutput['screenshot-visible']) webhookPayload.screenshot_visible = uploadedBinaryOutput['screenshot-visible'];
                if (uploadedBinaryOutput['screenshot-fullpage']) webhookPayload.screenshot_fullpage = uploadedBinaryOutput['screenshot-fullpage'];

                try {
                    await sendWebhook(plainRun.robotMetaId, 'run_completed', webhookPayload);
                    logger.log(
                        'info',
                        `Webhooks sent successfully for markdown robot API run ${plainRun.runId}`
                    );
                } catch (webhookError: any) {
                    logger.log(
                        'warn',
                        `Failed to send webhooks for markdown robot run ${plainRun.runId}: ${webhookError.message}`
                    );
                }

                capture("maxun-oss-run-created-api", {
                    runId: plainRun.runId,
                    userId: userId,
                    robotId: recording.recording_meta.id,
                    robotType: "scrape",
                    source: "api",
                    status: "success",
                    createdAt: new Date().toISOString(),
                    formats
                });

                await destroyRemoteBrowser(plainRun.browserId, userId);

                return {
                    success: true,
                    interpretationInfo: run.toJSON()
                };
            } catch (error: any) {
                logger.log(
                    'error',
                    `${formats.join(', ')} conversion failed for API run ${id}: ${error.message}`
                );

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
                        finishedAt: new Date().toLocaleString(),
                        error: error.message
                    };

                    serverIo
                        .of('/queued-run')
                        .to(`user-${userId}`)
                        .emit('run-completed', failureData);
                } catch (socketError: any) {
                    logger.log(
                        'warn',
                        `Failed to send run-failed notification for markdown robot run ${id}: ${socketError.message}`
                    );
                }

                try {
                    await sendWebhook(plainRun.robotMetaId, 'run_failed', {
                        robot_id: plainRun.robotMetaId,
                        run_id: plainRun.runId,
                        robot_name: recording.recording_meta.name,
                        status: 'failed',
                        finished_at: new Date().toLocaleString(),
                        error: {
                            message: error.message,
                            type: 'ConversionError'
                        }
                    });
                } catch (webhookError: any) {
                    logger.log('warn', `Failed to send webhook for failed API scrape run ${plainRun.runId}: ${webhookError.message}`);
                }

                capture("maxun-oss-run-created", {
                    runId: plainRun.runId,
                    userId: userId,
                    robotId: recording.recording_meta.id,
                    robotType: "scrape",
                    source: "api",
                    status: "failed",
                    createdAt: new Date().toISOString(),
                    formats
                });

                await destroyRemoteBrowser(plainRun.browserId, userId);

                throw error;
            }
        }

        plainRun.status = 'running';

        const workflow = AddGeneratedFlags(recording.recording);

        browser.interpreter.setRunId(plainRun.runId);
        
        const INTERPRETATION_TIMEOUT = 600000;

        const interpretationPromise = browser.interpreter.InterpretRecording(
            workflow, currentPage, (newPage: Page) => currentPage = newPage, plainRun.interpreterSettings
        );

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Workflow interpretation timed out after ${INTERPRETATION_TIMEOUT/1000}s`)), INTERPRETATION_TIMEOUT);
        });

        const interpretationInfo = await Promise.race([interpretationPromise, timeoutPromise]);

        const binaryOutputService = new BinaryOutputService('maxun-run-screenshots');
        const uploadedBinaryOutput = await binaryOutputService.uploadAndStoreBinaryOutput(run, interpretationInfo.binaryOutput);

        if (browser && browser.interpreter) {
            await browser.interpreter.clearState();
        }
        await destroyRemoteBrowser(plainRun.browserId, userId);

        const updatedRun = await run.update({
            status: 'success',
            finishedAt: new Date().toLocaleString(),
            log: interpretationInfo.log.join('\n'),
            binaryOutput: uploadedBinaryOutput,
        });

        try {
            const completionData = {
                runId: plainRun.runId,
                robotMetaId: plainRun.robotMetaId,
                robotName: recording.recording_meta.name,
                status: 'success',
                finishedAt: new Date().toLocaleString(),
                runByUserId: plainRun.runByUserId,
                runByScheduleId: plainRun.runByScheduleId,
                runByAPI: plainRun.runByAPI || false,
                browserId: plainRun.browserId
            };

            serverIo.of('/queued-run').to(`user-${userId}`).emit('run-completed', completionData);
            logger.log('info', `API run completed notification sent for run: ${plainRun.runId} to user-${userId}`);
        } catch (socketError: any) {
            logger.log('warn', `Failed to send run-completed notification for API run ${plainRun.runId}: ${socketError.message}`);
        }

        let totalSchemaItemsExtracted = 0;
        let totalListItemsExtracted = 0;
        let extractedScreenshotsCount = 0;
        
        if (updatedRun) {
            if (updatedRun.dataValues.serializableOutput) {
                if (updatedRun.dataValues.serializableOutput.scrapeSchema) {
                    Object.values(updatedRun.dataValues.serializableOutput.scrapeSchema).forEach((schemaResult: any) => {
                        if (Array.isArray(schemaResult)) {
                            totalSchemaItemsExtracted += schemaResult.length;
                        } else if (schemaResult && typeof schemaResult === 'object') {
                            totalSchemaItemsExtracted += 1;
                        }
                    });
                }
                
                if (updatedRun.dataValues.serializableOutput.scrapeList) {
                    Object.values(updatedRun.dataValues.serializableOutput.scrapeList).forEach((listResult: any) => {
                        if (Array.isArray(listResult)) {
                            totalListItemsExtracted += listResult.length;
                        }
                    });
                }
            }
            
            if (updatedRun.dataValues.binaryOutput) {
                extractedScreenshotsCount = Object.keys(updatedRun.dataValues.binaryOutput).length;
            }
        }
        
        const totalRowsExtracted = totalSchemaItemsExtracted + totalListItemsExtracted;

        capture('maxun-oss-run-created',{
                runId: id,
                userId: userId,
                robotId: recording.recording_meta.id,
                robotType: recording.recording_meta.type || 'extract',
                source: 'api',
                createdAt: new Date().toISOString(),
                status: 'success',
                totalSchemaItemsExtracted,
                totalListItemsExtracted,
                extractedScreenshotsCount,
                totalRowsExtracted
            }
        )

        const parsedOutput =
            typeof updatedRun.dataValues.serializableOutput === "string"
                ? JSON.parse(updatedRun.dataValues.serializableOutput)
                : updatedRun.dataValues.serializableOutput || {};

        const parsedList =
            typeof parsedOutput.scrapeList === "string"
                ? JSON.parse(parsedOutput.scrapeList)
                : parsedOutput.scrapeList || {};

        const parsedSchema =
            typeof parsedOutput.scrapeSchema === "string"
                ? JSON.parse(parsedOutput.scrapeSchema)
                : parsedOutput.scrapeSchema || {};
                
        const parsedCrawl =
            typeof parsedOutput.crawl === "string"
                ? JSON.parse(parsedOutput.crawl)
                : parsedOutput.crawl || {};

        const parsedSearch =
            typeof parsedOutput.search === "string"
                ? JSON.parse(parsedOutput.search)
                : parsedOutput.search || {};

        const webhookPayload = {
            robot_id: plainRun.robotMetaId,
            run_id: plainRun.runId,
            robot_name: recording.recording_meta.name,
            status: "success",
            started_at: plainRun.startedAt,
            finished_at: new Date().toLocaleString(),
            extracted_data: {
                captured_texts: parsedSchema || {},
                captured_lists: parsedList || {},
                crawl_data: parsedCrawl || {},
                search_data: parsedSearch || {},
                captured_texts_count: totalSchemaItemsExtracted,
                captured_lists_count: totalListItemsExtracted,
                screenshots_count: extractedScreenshotsCount
            },
            metadata: {
                browser_id: plainRun.browserId,
                user_id: userId,
            },
        };

        try {
            await sendWebhook(plainRun.robotMetaId, 'run_completed', webhookPayload);
            logger.log('info', `Webhooks sent successfully for completed run ${plainRun.runId}`);
        } catch (webhookError: any) {
            logger.log('error', `Failed to send webhooks for run ${plainRun.runId}: ${webhookError.message}`);
        }

        await triggerIntegrationUpdates(plainRun.runId, plainRun.robotMetaId);

        return {
            success: true,
            interpretationInfo: updatedRun.toJSON()
        };

    } catch (error: any) {
        logger.log('info', `Error while running a robot with id: ${id} - ${error.message}`);
        const run = await Run.findOne({ where: { runId: id } });
        if (run) {
            if (browser) {
                try {
                    if (browser.interpreter) {
                        await browser.interpreter.clearState();
                    }
                    await destroyRemoteBrowser(run.browserId, userId);
                } catch (cleanupError: any) {
                    logger.error(`Failed to cleanup browser in error handler: ${cleanupError.message}`);
                }
            }

            await run.update({
                status: 'failed',
                finishedAt: new Date().toLocaleString(),
                log: (run.log ? run.log + '\n' : '') + `Error: ${error.message}\n` + (error.stack ? error.stack : ''),
            });

            try {
                const recording = await Robot.findOne({ where: { 'recording_meta.id': run.robotMetaId }, raw: true });
                const failureData = {
                    runId: run.runId,
                    robotMetaId: run.robotMetaId,
                    robotName: recording ? recording.recording_meta.name : 'Unknown Robot',
                    status: 'failed',
                    finishedAt: new Date().toLocaleString(),
                    runByUserId: run.runByUserId,
                    runByScheduleId: run.runByScheduleId,
                    runByAPI: run.runByAPI || false,
                    browserId: run.browserId
                };

                serverIo.of('/queued-run').to(`user-${userId}`).emit('run-completed', failureData);
                logger.log('info', `API run permanently failed notification sent for run: ${run.runId} to user-${userId}`);
            } catch (socketError: any) {
                logger.log('warn', `Failed to send run-completed notification for permanently failed API run ${run.runId}: ${socketError.message}`);
            }

            const recording = await Robot.findOne({ where: { 'recording_meta.id': run.robotMetaId }, raw: true });

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
            capture(
               'maxun-oss-run-created',
               {
                    runId: id,
                    userId: userId,
                    robotId: recording?.recording_meta?.id || run.robotMetaId,
                    robotType: recording?.recording_meta?.type || 'extract',
                    source: 'api',
                    createdAt: new Date().toISOString(),
                    status: 'failed',
                    is_llm: (recording?.recording_meta as any)?.isLLM,
                }
            );
        }
        return {
            success: false,
            error: error.message,
        };
    }
}

export async function handleRunRecording(id: string, userId: string, isSDK: boolean = false, requestedFormats?: string[]) {
    let socket: Socket | null = null;

    try {
        const result = await createWorkflowAndStoreMetadata(id, userId, isSDK);
        const { browserId, runId: newRunId } = result;

        if (!browserId || !newRunId || !userId) {
            throw new Error('browserId or runId or userId is undefined');
        }

        const CONNECTION_TIMEOUT = 30000;

        socket = io(`${process.env.BACKEND_URL ? process.env.BACKEND_URL : 'http://localhost:8080'}/${browserId}`, {
            transports: ['websocket'],
            rejectUnauthorized: false,
            timeout: CONNECTION_TIMEOUT,
        });

        const readyHandler = () => readyForRunHandler(browserId, newRunId, userId, socket!, requestedFormats);

        socket.on('ready-for-run', readyHandler);

        socket.on('connect_error', (error: Error) => {
            logger.error(`Socket connection error for API run ${newRunId}: ${error.message}`);
            cleanupSocketConnection(socket!, browserId, newRunId);
        });

        socket.on('error', (error: Error) => {
            logger.error(`Socket error for API run ${newRunId}: ${error.message}`);
        });

        socket.on('disconnect', () => {
            cleanupSocketConnection(socket!, browserId, newRunId);
        });

        logger.log('info', `Running Robot: ${id}`);

        return newRunId;

    } catch (error: any) {
        logger.error('Error running robot:', error);
        if (socket) {
            cleanupSocketConnection(socket, '', '');
        }
    }
}

function cleanupSocketConnection(socket: Socket, browserId: string, id: string) {
    try {
        socket.removeAllListeners();
        socket.disconnect();

        if (browserId) {
            const namespace = serverIo.of(browserId);
            namespace.removeAllListeners();
            namespace.disconnectSockets(true);
            const nsps = (serverIo as any)._nsps;
            if (nsps && nsps.has(`/${browserId}`)) {
                nsps.delete(`/${browserId}`);
                logger.log('debug', `Deleted namespace /${browserId} from io._nsps Map`);
            }
        }

        logger.log('info', `Cleaned up socket connection for browserId: ${browserId}, runId: ${id}`);
    } catch (error: any) {
        logger.error(`Error cleaning up socket connection: ${error.message}`);
    }
}

async function waitForRunCompletion(runId: string, interval: number = 2000) {
    const MAX_WAIT_TIME = 180 * 60 * 1000;
    const startTime = Date.now();

    while (true) {
        if (Date.now() - startTime > MAX_WAIT_TIME) {
            throw new Error('Run completion timeout after 3 hours');
        }

        const run = await Run.findOne({ where: { runId } });
        if (!run) throw new Error('Run not found');

        if (run.status === 'success') {
            return run.toJSON();
        } else if (run.status === 'failed') {
            throw new Error('Run failed');
        } else if (run.status === 'aborted' || run.status === 'aborting') {
            throw new Error('Run was aborted');
        }

        await new Promise(resolve => setTimeout(resolve, interval));
    }
}

/**
 * @swagger
 * /api/robots/{id}/runs:
 *   post:
 *     summary: Run a robot by ID
 *     description: When you need to run a robot and get its captured data, you can use this endpoint to create a run for the robot. For now, you can poll the GET endpoint to retrieve a run's details as soon as it is finished. We are working on adding a webhook feature to notify you when a run is finished.
 *     security:
 *       - api_key: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: The ID of the robot to run.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               formats:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [markdown, html]
 *                 description: Optional override formats for this run.
 *           example:
 *             formats: ["html"]
 *     responses:
 *       200:
 *         description: Robot run started successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 statusCode:
 *                   type: integer
 *                   example: 200
 *                 messageCode:
 *                   type: string
 *                   example: success
 *                 run:
 *                   type: object
 *                   properties:
 *                     runId:
 *                       type: string
 *                       example: "67890"
 *                     status:
 *                       type: string
 *                       example: "in_progress"
 *       401:
 *         description: Unauthorized access.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Unauthorized"
 *       500:
 *         description: Error running robot.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 statusCode:
 *                   type: integer
 *                   example: 500
 *                 messageCode:
 *                   type: string
 *                   example: error
 *                 message:
 *                   type: string
 *                   example: "Failed to run robot"
 */
router.post("/robots/:id/runs", requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }

        const requestedFormats = req.body?.formats;
        const runId = await handleRunRecording(req.params.id, req.user.id, false, requestedFormats);

        if (!runId) {
            throw new Error('Run ID is undefined');
        }
        const completedRun = await waitForRunCompletion(runId);

        const response = {
            statusCode: 200,
            messageCode: "success",
            run: formatRunResponse(completedRun),
        };

        res.status(200).json(response);
    } catch (error) {
        console.error("Error running robot:", error);
        res.status(500).json({
            statusCode: 500,
            messageCode: "error",
            message: "Failed to run robot",
        });
    }
});


export default router;