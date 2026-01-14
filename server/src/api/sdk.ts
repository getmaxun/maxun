/**
 * SDK API Routes
 * Separate API endpoints specifically for Maxun SDKs
 * All routes require API key authentication
 */

import { Router, Request, Response } from 'express';
import { requireAPIKey } from "../middlewares/api";
import Robot from "../models/Robot";
import Run from "../models/Run";
import { v4 as uuid } from 'uuid';
import { WorkflowFile } from "maxun-core";
import logger from "../logger";
import { capture } from "../utils/analytics";
import { handleRunRecording } from "./record";
import { WorkflowEnricher } from "../sdk/workflowEnricher";
import { cancelScheduledWorkflow, scheduleWorkflow } from '../storage/schedule';
import { computeNextRun } from "../utils/schedule";
import moment from 'moment-timezone';

const router = Router();

interface AuthenticatedRequest extends Request {
    user?: any;
}

/**
 * Create a new robot programmatically
 * POST /api/sdk/robots
 */
router.post("/sdk/robots", requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const user = req.user;
        const workflowFile: WorkflowFile = req.body;

        if (!workflowFile.meta || !workflowFile.workflow) {
            return res.status(400).json({
                error: "Invalid workflow structure. Expected { meta, workflow }"
            });
        }

        if (!workflowFile.meta.name) {
            return res.status(400).json({
                error: "Robot name is required in meta.name"
            });
        }

        const type = (workflowFile.meta as any).type || 'extract';

        let enrichedWorkflow: any[] = [];
        let extractedUrl: string | undefined;

        if (type === 'scrape') {
            enrichedWorkflow = [];
            extractedUrl = (workflowFile.meta as any).url;

            if (!extractedUrl) {
                return res.status(400).json({
                    error: "URL is required for scrape robots"
                });
            }
        } else {
            const enrichResult = await WorkflowEnricher.enrichWorkflow(workflowFile.workflow, user.id);

            if (!enrichResult.success) {
                logger.error("[SDK] Error in Selector Validation:\n" + JSON.stringify(enrichResult.errors, null, 2))

                return res.status(400).json({
                    error: "Workflow validation failed",
                    details: enrichResult.errors
                });
            }

            enrichedWorkflow = enrichResult.workflow!;
            extractedUrl = enrichResult.url;
        }

        const robotId = uuid();
        const metaId = uuid();

        const robotMeta: any = {
            name: workflowFile.meta.name,
            id: metaId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            pairs: enrichedWorkflow.length,
            params: [],
            type,
            url: extractedUrl,
            formats: (workflowFile.meta as any).formats || [],
            isLLM: (workflowFile.meta as any).isLLM,
        };

        const robot = await Robot.create({
            id: robotId,
            userId: user.id,
            recording_meta: robotMeta,
            recording: {
                workflow: enrichedWorkflow
            }
        });

        const eventName = robotMeta.isLLM
            ? "maxun-oss-llm-robot-created"
            : "maxun-oss-robot-created";
        const telemetryData: any = {
            robot_meta: robot.recording_meta,
            recording: robot.recording,
        };
        if (robotMeta.isLLM && (workflowFile.meta as any).prompt) {
            telemetryData.prompt = (workflowFile.meta as any).prompt;
        }
        capture(eventName, telemetryData);

        return res.status(201).json({
            data: robot,
            message: "Robot created successfully"
        });

    } catch (error: any) {
        logger.error("[SDK] Error creating robot:", error);
        return res.status(500).json({
            error: "Failed to create robot",
            message: error.message
        });
    }
});

/**
 * List all robots for the authenticated user
 * GET /api/sdk/robots
 */
router.get("/sdk/robots", requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const robots = await Robot.findAll();

        return res.status(200).json({
            data: robots
        });
    } catch (error: any) {
        logger.error("[SDK] Error listing robots:", error);
        return res.status(500).json({
            error: "Failed to list robots",
            message: error.message
        });
    }
});

/**
 * Get a specific robot by ID
 * GET /api/sdk/robots/:id
 */
router.get("/sdk/robots/:id", requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const robotId = req.params.id;

        const robot = await Robot.findOne({
            where: {
                'recording_meta.id': robotId
            }
        });

        if (!robot) {
            return res.status(404).json({
                error: "Robot not found"
            });
        }

        return res.status(200).json({
            data: robot
        });
    } catch (error: any) {
        logger.error("[SDK] Error getting robot:", error);
        return res.status(500).json({
            error: "Failed to get robot",
            message: error.message
        });
    }
});

/**
 * Update a robot
 * PUT /api/sdk/robots/:id
 */
router.put("/sdk/robots/:id", requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const robotId = req.params.id;
        const updates = req.body;

        const robot = await Robot.findOne({
            where: {
                'recording_meta.id': robotId
            }
        });

        if (!robot) {
            return res.status(404).json({
                error: "Robot not found"
            });
        }

        const updateData: any = {};

        if (updates.workflow) {
            updateData.recording = {
                workflow: updates.workflow
            };
        }

        if (updates.meta) {
            updateData.recording_meta = {
                ...robot.recording_meta,
                ...updates.meta,
                updatedAt: new Date().toISOString()
            };
        }

        if (updates.google_sheet_email !== undefined) {
            updateData.google_sheet_email = updates.google_sheet_email;
        }
        if (updates.google_sheet_name !== undefined) {
            updateData.google_sheet_name = updates.google_sheet_name;
        }
        if (updates.airtable_base_id !== undefined) {
            updateData.airtable_base_id = updates.airtable_base_id;
        }
        if (updates.airtable_table_name !== undefined) {
            updateData.airtable_table_name = updates.airtable_table_name;
        }

        if (updates.schedule !== undefined) {
            if (updates.schedule === null) {
                try {
                    await cancelScheduledWorkflow(robotId);
                } catch (cancelError) {
                    logger.warn(`[SDK] Failed to cancel existing schedule for robot ${robotId}: ${cancelError}`);
                }
                updateData.schedule = null;
            } else {
                const {
                    runEvery,
                    runEveryUnit,
                    timezone,
                    startFrom = 'SUNDAY',
                    dayOfMonth = 1,
                    atTimeStart = '00:00',
                    atTimeEnd = '23:59'
                } = updates.schedule;

                if (!runEvery || !runEveryUnit || !timezone) {
                    return res.status(400).json({
                        error: "Missing required schedule parameters: runEvery, runEveryUnit, timezone"
                    });
                }

                if (!moment.tz.zone(timezone)) {
                    return res.status(400).json({
                        error: "Invalid timezone"
                    });
                }

                const [startHours, startMinutes] = atTimeStart.split(':').map(Number);
                const [endHours, endMinutes] = atTimeEnd.split(':').map(Number);

                if (isNaN(startHours) || isNaN(startMinutes) || isNaN(endHours) || isNaN(endMinutes) ||
                    startHours < 0 || startHours > 23 || startMinutes < 0 || startMinutes > 59 ||
                    endHours < 0 || endHours > 23 || endMinutes < 0 || endMinutes > 59) {
                    return res.status(400).json({ error: 'Invalid time format. Expected HH:MM (e.g., 09:30)' });
                }

                const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
                if (!days.includes(startFrom)) {
                    return res.status(400).json({ error: 'Invalid startFrom day. Must be one of: SUNDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY' });
                }

                let cronExpression;
                const dayIndex = days.indexOf(startFrom);

                switch (runEveryUnit) {
                    case 'MINUTES':
                        cronExpression = `*/${runEvery} * * * *`;
                        break;
                    case 'HOURS':
                        cronExpression = `${startMinutes} */${runEvery} * * *`;
                        break;
                    case 'DAYS':
                        cronExpression = `${startMinutes} ${startHours} */${runEvery} * *`;
                        break;
                    case 'WEEKS':
                        cronExpression = `${startMinutes} ${startHours} * * ${dayIndex}`;
                        break;
                    case 'MONTHS':
                        cronExpression = `${startMinutes} ${startHours} ${dayOfMonth} */${runEvery} *`;
                        if (startFrom !== 'SUNDAY') {
                            cronExpression += ` ${dayIndex}`;
                        }
                        break;
                    default:
                        return res.status(400).json({
                            error: "Invalid runEveryUnit. Must be one of: MINUTES, HOURS, DAYS, WEEKS, MONTHS"
                        });
                }

                try {
                    await cancelScheduledWorkflow(robotId);
                } catch (cancelError) {
                    logger.warn(`[SDK] Failed to cancel existing schedule for robot ${robotId}: ${cancelError}`);
                }

                try {
                    await scheduleWorkflow(robotId, req.user.id, cronExpression, timezone);
                } catch (scheduleError: any) {
                    logger.error(`[SDK] Failed to schedule workflow for robot ${robotId}: ${scheduleError.message}`);
                    return res.status(500).json({
                        error: "Failed to schedule workflow",
                        message: scheduleError.message
                    });
                }

                const nextRunAt = computeNextRun(cronExpression, timezone);

                updateData.schedule = {
                    runEvery,
                    runEveryUnit,
                    timezone,
                    startFrom,
                    dayOfMonth,
                    atTimeStart,
                    atTimeEnd,
                    cronExpression,
                    lastRunAt: undefined,
                    nextRunAt: nextRunAt || undefined,
                };

                logger.info(`[SDK] Scheduled robot ${robotId} with cron: ${cronExpression} in timezone: ${timezone}`);
            }
        }

        if (updates.webhooks !== undefined) {
            updateData.webhooks = updates.webhooks;
        }

        if (updates.proxy_url !== undefined) {
            updateData.proxy_url = updates.proxy_url;
        }
        if (updates.proxy_username !== undefined) {
            updateData.proxy_username = updates.proxy_username;
        }
        if (updates.proxy_password !== undefined) {
            updateData.proxy_password = updates.proxy_password;
        }

        await robot.update(updateData);

        logger.info(`[SDK] Robot updated: ${robotId}`);

        return res.status(200).json({
            data: robot,
            message: "Robot updated successfully"
        });
    } catch (error: any) {
        logger.error("[SDK] Error updating robot:", error);
        return res.status(500).json({
            error: "Failed to update robot",
            message: error.message
        });
    }
});

/**
 * Delete a robot
 * DELETE /api/sdk/robots/:id
 */
router.delete("/sdk/robots/:id", requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const robotId = req.params.id;

        const robot = await Robot.findOne({
            where: {
                'recording_meta.id': robotId
            }
        });

        if (!robot) {
            return res.status(404).json({
                error: "Robot not found"
            });
        }

        await Run.destroy({
            where: {
                robotMetaId: robot.recording_meta.id
            }
        });

        await robot.destroy();

        logger.info(`[SDK] Robot deleted: ${robotId}`);

        const deleteEventName = robot.recording_meta.isLLM
            ? "maxun-oss-llm-robot-deleted"
            : "maxun-oss-robot-deleted";
        capture(deleteEventName, {
            robotId: robotId,
            user_id: req.user?.id,
            deleted_at: new Date().toISOString(),
        }
        )

        return res.status(200).json({
            message: "Robot deleted successfully"
        });
    } catch (error: any) {
        logger.error("[SDK] Error deleting robot:", error);
        return res.status(500).json({
            error: "Failed to delete robot",
            message: error.message
        });
    }
});

/**
 * Execute a robot
 * POST /api/sdk/robots/:id/execute
 */
router.post("/sdk/robots/:id/execute", requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const user = req.user;
        const robotId = req.params.id;

        logger.info(`[SDK] Starting execution for robot ${robotId}`);

        const runId = await handleRunRecording(robotId, user.id.toString(), true);
        if (!runId) {
            throw new Error('Failed to start robot execution');
        }

        const run = await waitForRunCompletion(runId, user.id.toString());

        let listData: any[] = [];
        if (run.serializableOutput?.scrapeList) {
            const scrapeList: any = run.serializableOutput.scrapeList;

            if (scrapeList.scrapeList && Array.isArray(scrapeList.scrapeList)) {
                listData = scrapeList.scrapeList;
            }
            else if (Array.isArray(scrapeList)) {
                listData = scrapeList;
            }
            else if (typeof scrapeList === 'object') {
                const listValues = Object.values(scrapeList);
                if (listValues.length > 0 && Array.isArray(listValues[0])) {
                    listData = listValues[0] as any[];
                }
            }
        }

        let crawlData: any[] = [];
        if (run.serializableOutput?.crawl) {
            const crawl: any = run.serializableOutput.crawl;

            if (Array.isArray(crawl)) {
                crawlData = crawl;
            }
            else if (typeof crawl === 'object') {
                const crawlValues = Object.values(crawl);
                if (crawlValues.length > 0 && Array.isArray(crawlValues[0])) {
                    crawlData = crawlValues[0] as any[];
                }
            }
        }

        let searchData: any = {};
        if (run.serializableOutput?.search) {
            searchData = run.serializableOutput.search;
        }

        return res.status(200).json({
            data: {
                runId: run.runId,
                status: run.status,
                data: {
                    textData: run.serializableOutput?.scrapeSchema || {},
                    listData: listData,
                    crawlData: crawlData,
                    searchData: searchData
                },
                screenshots: Object.values(run.binaryOutput || {})
            }
        });
    } catch (error: any) {
        logger.error("[SDK] Error executing robot:", error);
        return res.status(500).json({
            error: "Failed to execute robot",
            message: error.message
        });
    }
});

/**
 * Wait for run completion
 */
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
        } else if (run.status === 'aborted') {
            throw new Error('Run was aborted');
        }

        await new Promise(resolve => setTimeout(resolve, interval));
    }
}

/**
 * Get all runs for a robot
 * GET /api/sdk/robots/:id/runs
 */
router.get("/sdk/robots/:id/runs", requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const robotId = req.params.id;

        const robot = await Robot.findOne({
            where: {
                'recording_meta.id': robotId
            }
        });

        if (!robot) {
            return res.status(404).json({
                error: "Robot not found"
            });
        }

        const runs = await Run.findAll({
            where: {
                robotMetaId: robot.recording_meta.id
            },
            order: [['startedAt', 'DESC']]
        });

        return res.status(200).json({
            data: runs
        });
    } catch (error: any) {
        logger.error("[SDK] Error getting runs:", error);
        return res.status(500).json({
            error: "Failed to get runs",
            message: error.message
        });
    }
});

/**
 * Get a specific run
 * GET /api/sdk/robots/:id/runs/:runId
 */
router.get("/sdk/robots/:id/runs/:runId", requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const robotId = req.params.id;
        const runId = req.params.runId;

        const robot = await Robot.findOne({
            where: {
                'recording_meta.id': robotId
            }
        });

        if (!robot) {
            return res.status(404).json({
                error: "Robot not found"
            });
        }

        const run = await Run.findOne({
            where: {
                runId: runId,
                robotMetaId: robot.recording_meta.id
            }
        });

        if (!run) {
            return res.status(404).json({
                error: "Run not found"
            });
        }

        return res.status(200).json({
            data: run
        });
    } catch (error: any) {
        logger.error("[SDK] Error getting run:", error);
        return res.status(500).json({
            error: "Failed to get run",
            message: error.message
        });
    }
});

/**
 * Abort a running execution
 * POST /api/sdk/robots/:id/runs/:runId/abort
 */
router.post("/sdk/robots/:id/runs/:runId/abort", requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const robotId = req.params.id;
        const runId = req.params.runId;

        const robot = await Robot.findOne({
            where: {
                'recording_meta.id': robotId
            }
        });

        if (!robot) {
            return res.status(404).json({
                error: "Robot not found"
            });
        }

        const run = await Run.findOne({
            where: {
                runId: runId,
                robotMetaId: robot.recording_meta.id
            }
        });

        if (!run) {
            return res.status(404).json({
                error: "Run not found"
            });
        }

        if (run.status !== 'running' && run.status !== 'queued') {
            return res.status(400).json({
                error: "Run is not in a state that can be aborted",
                currentStatus: run.status
            });
        }

        await run.update({ status: 'aborted' });

        logger.info(`[SDK] Run ${runId} marked for abortion`);

        return res.status(200).json({
            message: "Run abortion initiated",
            data: run
        });
    } catch (error: any) {
        logger.error("[SDK] Error aborting run:", error);
        return res.status(500).json({
            error: "Failed to abort run",
            message: error.message
        });
    }
});

/**
 * Create a crawl robot programmatically
 * POST /api/sdk/crawl
 */
router.post("/sdk/crawl", requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const user = req.user;
        const { url, name, crawlConfig } = req.body;

        if (!url || !crawlConfig) {
            return res.status(400).json({
                error: "URL and crawl configuration are required"
            });
        }

        try {
            new URL(url);
        } catch (err) {
            return res.status(400).json({
                error: "Invalid URL format"
            });
        }

        if (typeof crawlConfig !== 'object') {
            return res.status(400).json({
                error: "crawlConfig must be an object"
            });
        }

        const robotName = name || `Crawl Robot - ${new URL(url).hostname}`;
        const robotId = uuid();
        const metaId = uuid();

        const robot = await Robot.create({
            id: robotId,
            userId: user.id,
            recording_meta: {
                name: robotName,
                id: metaId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                pairs: 1,
                params: [],
                type: 'crawl',
                url: url,
            },
            recording: {
                workflow: [
                    {
                        where: { url },
                        what: [
                            { action: 'flag', args: ['generated'] },
                            {
                                action: 'crawl',
                                args: [crawlConfig],
                                name: 'Crawl'
                            }
                        ]
                    },
                    {
                        where: { url: 'about:blank' },
                        what: [
                            {
                                action: 'goto',
                                args: [url]
                            },
                            {
                                action: 'waitForLoadState',
                                args: ['networkidle']
                            }
                        ]
                    }
                ]
            }
        });

        logger.info(`[SDK] Crawl robot created: ${metaId} (db: ${robotId}) by user ${user.id}`);

        capture("maxun-oss-robot-created", {
            userId: user.id.toString(),
            robotId: metaId,
            robotName: robotName,
            url: url,
            robotType: 'crawl',
            crawlConfig: crawlConfig,
            source: 'sdk',
            robot_meta: robot.recording_meta,
            recording: robot.recording,
        });

        return res.status(201).json({
            data: robot,
            message: "Crawl robot created successfully"
        });

    } catch (error: any) {
        logger.error("[SDK] Error creating crawl robot:", error);
        return res.status(500).json({
            error: "Failed to create crawl robot",
            message: error.message
        });
    }
});

/**
 * Create a search robot programmatically
 * POST /api/sdk/search
 */
router.post("/sdk/search", requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const user = req.user;
        const { name, searchConfig } = req.body;

        if (!searchConfig) {
            return res.status(400).json({
                error: "Search configuration is required"
            });
        }

        if (!searchConfig.query) {
            return res.status(400).json({
                error: "searchConfig must include a query"
            });
        }

        if (typeof searchConfig !== 'object') {
            return res.status(400).json({
                error: "searchConfig must be an object"
            });
        }

        if (searchConfig.mode && !['discover', 'scrape'].includes(searchConfig.mode)) {
            return res.status(400).json({
                error: "searchConfig.mode must be either 'discover' or 'scrape'"
            });
        }

        searchConfig.provider = 'duckduckgo';

        const robotName = name || `Search Robot - ${searchConfig.query}`;
        const robotId = uuid();
        const metaId = uuid();

        const robot = await Robot.create({
            id: robotId,
            userId: user.id,
            recording_meta: {
                name: robotName,
                id: metaId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                pairs: 1,
                params: [],
                type: 'search',
            },
            recording: {
                workflow: [
                    {
                        where: { url: 'about:blank' },
                        what: [
                            {
                                action: 'search',
                                args: [searchConfig],
                                name: 'Search'
                            }
                        ]
                    }
                ]
            }
        });

        logger.info(`[SDK] Search robot created: ${metaId} (db: ${robotId}) by user ${user.id}`);

        capture("maxun-oss-robot-created", {
            userId: user.id.toString(),
            robotId: metaId,
            robotName: robotName,
            robotType: 'search',
            searchQuery: searchConfig.query,
            searchProvider: searchConfig.provider || 'duckduckgo',
            searchLimit: searchConfig.limit || 10,
            source: 'sdk',
            robot_meta: robot.recording_meta,
            recording: robot.recording,
        });

        return res.status(201).json({
            data: robot,
            message: "Search robot created successfully"
        });

    } catch (error: any) {
        logger.error("[SDK] Error creating search robot:", error);
        return res.status(500).json({
            error: "Failed to create search robot",
            message: error.message
        });
    }
});

/**
 * LLM-based extraction - generate workflow from natural language prompt
 * POST /api/sdk/extract/llm
 * URL is optional - if not provided, the system will search for the target website based on the prompt
 */
router.post("/sdk/extract/llm", requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const user = req.user
        const { url, prompt, llmProvider, llmModel, llmApiKey, llmBaseUrl, robotName } = req.body;

        if (!prompt) {
            return res.status(400).json({
                error: "Prompt is required"
            });
        }

        if (url) {
            try {
                new URL(url);
            } catch (err) {
                return res.status(400).json({
                    error: "Invalid URL format"
                });
            }
        }

        const llmConfig = {
            provider: llmProvider,
            model: llmModel,
            apiKey: llmApiKey,
            baseUrl: llmBaseUrl
        };

        let workflowResult: any;
        let finalUrl: string;

        if (url) {
            workflowResult = await WorkflowEnricher.generateWorkflowFromPrompt(url, prompt, user.id, llmConfig);
            finalUrl = workflowResult.url || url;
        } else {
            workflowResult = await WorkflowEnricher.generateWorkflowFromPromptWithSearch(prompt, user.id, llmConfig);
            finalUrl = workflowResult.url || '';
        }

        if (!workflowResult.success || !workflowResult.workflow) {
            return res.status(400).json({
                error: "Failed to generate workflow from prompt",
                details: workflowResult.errors
            });
        }

        const robotId = uuid();
        const metaId = uuid();

        const robotMeta: any = {
            name: robotName || `LLM Extract: ${prompt.substring(0, 50)}`,
            id: metaId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            pairs: workflowResult.workflow.length,
            params: [],
            type: 'extract',
            url: finalUrl,
            isLLM: true
        };

        const robot = await Robot.create({
            id: robotId,
            userId: user.id,
            recording_meta: robotMeta,
            recording: {
                workflow: workflowResult.workflow
            },
        });

        logger.info(`[SDK] Persistent robot created: ${metaId} for LLM extraction`);

        capture("maxun-oss-llm-robot-created", {
            robot_meta: robot.recording_meta,
            recording: robot.recording,
            prompt: prompt
        });

        return res.status(200).json({
            success: true,
            data: {
                robotId: metaId,
                name: robotMeta.name,
                description: prompt,
                url: finalUrl,
                workflow: workflowResult.workflow
            }
        });
    } catch (error: any) {
        logger.error("[SDK] Error in LLM extraction:", error);
        return res.status(500).json({
            error: "Failed to perform LLM extraction",
            message: error.message
        });
    }
});

export default router;
