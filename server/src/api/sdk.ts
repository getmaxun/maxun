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
import {
    DEFAULT_OUTPUT_FORMATS,
    parseOutputFormats,
    OutputFormats,
    SCRAPE_OUTPUT_FORMAT_OPTIONS,
} from '../constants/output-formats';
import sequelizeInstance from '../storage/db';
import { Op } from 'sequelize';

const router = Router();

interface AuthenticatedRequest extends Request {
    user?: any;
}

/**
 * Find an existing robot by name scoped to a user or team.
 */
const findExistingRobotByName = async (
    name: string,
    userId: number
): Promise<any | null> => {
    const trimmed = name.trim();
    return Robot.findOne({
        where: {
            userId,
            [Op.and]: sequelizeInstance.where(
                sequelizeInstance.fn('trim', sequelizeInstance.literal("recording_meta->>'name'")),
                trimmed
            ),
        } as any,
    });
};

/**
 * Normalize a URL for comparison (strip trailing slash, lowercase host).
 */
const normalizeUrl = (raw: string): string => {
    try {
        const u = new URL(raw);
        u.search = u.searchParams.toString();
        return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/$/, '')}${u.search}`;
    } catch {
        return raw.toLowerCase().trim();
    }
};

const normalizeRobotUrl = (rawUrl: string): string => {
    const normalizedUrl = new URL(rawUrl.trim());
    if (!['http:', 'https:'].includes(normalizedUrl.protocol)) {
        throw new Error('Invalid URL protocol');
    }

    normalizedUrl.search = normalizedUrl.searchParams.toString();
    return normalizedUrl.toString();
};

const normalizeWorkflowUrls = (workflow: any[] = []): any[] =>
    workflow.map((pair: any) => ({
        ...pair,
        where: pair?.where
            ? {
                ...pair.where,
                ...(typeof pair.where.url === 'string' && pair.where.url !== 'about:blank'
                    ? { url: normalizeRobotUrl(pair.where.url) }
                    : {}),
            }
            : pair?.where,
        what: Array.isArray(pair?.what)
            ? pair.what.map((action: any) => {
                if (
                    action.action === 'goto' &&
                    Array.isArray(action.args) &&
                    typeof action.args[0] === 'string' &&
                    action.args[0] !== 'about:blank'
                ) {
                    return {
                        ...action,
                        args: [normalizeRobotUrl(action.args[0]), ...action.args.slice(1)],
                    };
                }

                if (
                    (action.action === 'scrape' || action.action === 'crawl') &&
                    Array.isArray(action.args) &&
                    action.args[0] &&
                    typeof action.args[0] === 'object' &&
                    typeof action.args[0].url === 'string' &&
                    action.args[0].url !== 'about:blank'
                ) {
                    return {
                        ...action,
                        args: [
                            {
                                ...action.args[0],
                                url: normalizeRobotUrl(action.args[0].url),
                            },
                            ...action.args.slice(1),
                        ],
                    };
                }

                return action;
            })
            : pair?.what,
    }));

/**
 * Get the status of the authenticated user
 * GET /api/sdk/status
 */
router.get("/sdk/status", requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const user = req.user;
        return res.status(200).json({
            email: user.email,
            plan: 'OSS',
            credits: 999999
        });
    } catch (error: any) {
        logger.error("Error getting status:", error);
        return res.status(500).json({
            error: "Failed to get status",
            message: error.message
        });
    }
});

const sortDeep = (val: any): any => {
    if (Array.isArray(val)) return val.map(sortDeep);
    if (val !== null && typeof val === 'object')
        return Object.fromEntries(
            Object.entries(val).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortDeep(v)])
        );
    return val;
};

const stableStringify = (obj: any): string => JSON.stringify(sortDeep(obj));

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

        const type = (workflowFile.meta as any).type || (workflowFile.meta as any).robotType || 'extract';

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

            try {
                extractedUrl = normalizeRobotUrl(extractedUrl);
            } catch {
                return res.status(400).json({
                    error: "Invalid URL format"
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

            enrichedWorkflow = normalizeWorkflowUrls(enrichResult.workflow!);
            extractedUrl = enrichResult.url ? normalizeRobotUrl(enrichResult.url) : undefined;
        }

        const rawFormats = (workflowFile.meta as any).formats;
        const { validFormats, invalidFormats } = parseOutputFormats(
            rawFormats,
            type === 'scrape' ? SCRAPE_OUTPUT_FORMAT_OPTIONS : undefined
        );

        if (invalidFormats.length > 0) {
            return res.status(400).json({
                error: `Invalid formats: ${invalidFormats.map(String).join(', ')}`
            });
        }

        let normalizedFormats: OutputFormats[] = validFormats;

        if (type === 'search') {
            const searchAction = enrichedWorkflow
                .flatMap((pair: any) => pair.what || [])
                .find((action: any) => action?.action === 'search');
            const searchMode = searchAction?.args?.[0]?.mode;

            if (searchMode === 'discover') {      
                normalizedFormats = validFormats.length > 0 ? validFormats : [];
            } else {     
                normalizedFormats = validFormats.length > 0 ? validFormats : [...DEFAULT_OUTPUT_FORMATS];
            }
        } else if (type === 'crawl' || type === 'scrape') {
            normalizedFormats = validFormats.length > 0 ? validFormats : [...DEFAULT_OUTPUT_FORMATS];
        }

        const robotId = uuid();
        const metaId = uuid();

        const existingRobot = await findExistingRobotByName(workflowFile.meta.name, user.id);
        if (existingRobot) {
            const meta = existingRobot.recording_meta;
            const sameType = meta.type === type;
            const sameUrl = normalizeUrl(meta.url || '') === normalizeUrl(extractedUrl || '');
            const sameFormats = type === 'scrape'
                ? JSON.stringify([...(meta.formats || [])].sort()) === JSON.stringify([...((workflowFile.meta as any).formats || ['markdown'])].sort())
                : true;

            if (sameType && sameUrl && sameFormats) {
                return res.status(200).json({
                    data: existingRobot,
                    message: "Existing robot returned",
                    existing: true
                });
            }
            return res.status(409).json({
                error: `A robot named "${workflowFile.meta.name}" already exists with a different configuration. Please choose a different name.`
            });
        }
      
        const promptInstructionsForMeta = type === 'scrape'
            ? ((workflowFile.meta as any).promptInstructions || (workflowFile.meta as any).smartQueries || (workflowFile.meta as any).smart_queries) as string | undefined
            : undefined;

        const robotMeta: any = {
            name: workflowFile.meta.name,
            id: metaId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            pairs: enrichedWorkflow.length,
            params: [],
            type,
            url: extractedUrl,
            formats: normalizedFormats,
            isLLM: (workflowFile.meta as any).isLLM,
            ...(promptInstructionsForMeta ? { promptInstructions: promptInstructionsForMeta } : {}),
            ...((workflowFile.meta as any).promptLlmProvider ? { promptLlmProvider: (workflowFile.meta as any).promptLlmProvider } : {}),
            ...((workflowFile.meta as any).promptLlmModel ? { promptLlmModel: (workflowFile.meta as any).promptLlmModel } : {}),
            ...((workflowFile.meta as any).promptLlmApiKey ? { promptLlmApiKey: (workflowFile.meta as any).promptLlmApiKey } : {}),
            ...((workflowFile.meta as any).promptLlmBaseUrl ? { promptLlmBaseUrl: (workflowFile.meta as any).promptLlmBaseUrl } : {}),
        };

        const robot = await Robot.create({
            id: robotId,
            userId: user.id,
            recording_meta: robotMeta,
            recording: {
                workflow: normalizeWorkflowUrls(enrichedWorkflow)
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
            try {
                updateData.recording = {
                    workflow: normalizeWorkflowUrls(updates.workflow)
                };
            } catch {
                return res.status(400).json({ error: "Invalid URL in workflow" });
            }
        }

        if (updates.meta) {
            let normalizedMetaUrl: string | undefined;
            if (updates.meta.url) {
                try {
                    normalizedMetaUrl = normalizeRobotUrl(updates.meta.url);
                } catch {
                    return res.status(400).json({
                        error: "Invalid URL format"
                    });
                }
            }

            let workflow: any[];
            try {
                workflow = updates.workflow ? normalizeWorkflowUrls(updates.workflow) : JSON.parse(JSON.stringify(robot.recording?.workflow || []));
            } catch {
                return res.status(400).json({ error: "Invalid URL in workflow" });
            }
            if (normalizedMetaUrl) {
                workflow.forEach((pair: any) => {
                    let stepUpdate = false;
                    pair.what?.forEach((action: any) => {
                        if (action.action === 'goto' && action.args?.length) {
                            action.args[0] = normalizedMetaUrl;
                            stepUpdate = true;
                        } else if ((action.action === 'scrape' || action.action === 'crawl') && action.args?.[0] && typeof action.args[0] === 'object') {
                            action.args[0].url = normalizedMetaUrl;
                            stepUpdate = true;
                        }
                    });

                    if (stepUpdate && pair.where?.url && pair.where.url !== 'about:blank') {
                        pair.where.url = normalizedMetaUrl;
                    }
                });
                updateData.recording = { workflow };
            }

            updateData.recording_meta = {
                ...robot.recording_meta,
                ...updates.meta,
                ...(normalizedMetaUrl ? { url: normalizedMetaUrl } : {}),
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

        const runSource = req.headers['x-run-source'] === 'cli' ? 'cli' : 'sdk';
        const promptInstructions = req.body?.promptInstructions;
        const requestedFormats = req.body?.formats as OutputFormats[] | undefined;
        
        const runId = await handleRunRecording(robotId, user.id.toString(), runSource, requestedFormats, promptInstructions);
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

        let text: string | undefined = undefined;
        if (run.serializableOutput?.text && Array.isArray(run.serializableOutput.text)) {
            text = run.serializableOutput.text[0]?.content || undefined;
        }

        const scrapeOutput = run.serializableOutput?.scrape as Record<string, any> | undefined;
        if (!text && scrapeOutput?.text && Array.isArray(scrapeOutput.text)) {
            text = scrapeOutput.text[0]?.content || undefined;
        }

        let markdown: string | undefined = undefined;
        let html: string | undefined = undefined;
        if (run.serializableOutput?.markdown && Array.isArray(run.serializableOutput.markdown)) {
            markdown = run.serializableOutput.markdown[0]?.content || undefined;
        }
        if (!markdown && scrapeOutput?.markdown && Array.isArray(scrapeOutput.markdown)) {
            markdown = scrapeOutput.markdown[0]?.content || undefined;
        }
        if (run.serializableOutput?.html && Array.isArray(run.serializableOutput.html)) {
            html = run.serializableOutput.html[0]?.content || undefined;
        }
        if (!html && scrapeOutput?.html && Array.isArray(scrapeOutput.html)) {
            html = scrapeOutput.html[0]?.content || undefined;
        }

        const promptResultRaw = run.serializableOutput?.promptResult;
        const promptResult = Array.isArray(promptResultRaw) && promptResultRaw.length > 0
            ? (promptResultRaw[0]?.content || null)
            : null;

        return res.status(200).json({
            data: {
                runId: run.runId,
                status: run.status,
                data: {
                    textData: run.serializableOutput?.scrapeSchema || {},
                    listData: listData,
                    crawlData: crawlData,
                    searchData: searchData,
                    text: text,
                    markdown: markdown,
                    html: html,
                    promptResult: promptResult
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
 * Duplicate a robot with a new target URL
 * POST /api/sdk/robots/:id/duplicate
 */
router.post("/sdk/robots/:id/duplicate", requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const robotId = req.params.id;
        const { targetUrl } = req.body;

        if (!targetUrl) {
            return res.status(400).json({
                error: "The \"targetUrl\" field is required."
            });
        }

        let normalizedTargetUrl: string;
        try {
            normalizedTargetUrl = normalizeRobotUrl(targetUrl);
            const parsed = new URL(normalizedTargetUrl);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                return res.status(400).json({
                    error: "The \"targetUrl\" must use http or https protocol."
                });
            }
        } catch {
            return res.status(400).json({
                error: "The \"targetUrl\" must be a valid URL."
            });
        }

        const originalRobot = await Robot.findOne({
            where: { 'recording_meta.id': robotId }
        });

        if (!originalRobot) {
            return res.status(404).json({
                error: `Robot with ID "${robotId}" not found.`
            });
        }

        const lastWord = normalizedTargetUrl.split('/').filter(Boolean).pop() || 'Unnamed';

        const steps: any[] = originalRobot.recording.workflow;
        const entryStep = steps.findLast((step: any) => step.where?.url === 'about:blank');
        const originalEntryUrl: string | null = entryStep?.what?.find(
            (action: any) => action.action === 'goto' && action.args?.length
        )?.args?.[0] ?? null;

        let gotoUpdated = false;
        let whereUpdateStopped = false;

        const workflow = [...steps].reverse().map((step: any) => {
            let updatedWhere = step.where;

            if (originalEntryUrl && step.where?.url !== 'about:blank' && !whereUpdateStopped) {
                if (step.where?.url === originalEntryUrl) {
                    updatedWhere = { ...step.where, url: normalizedTargetUrl };
                } else {
                    whereUpdateStopped = true;
                }
            }

            const updatedWhat = step.what.map((action: any) => {
                if (!gotoUpdated && action.action === 'goto' && action.args?.[0] === originalEntryUrl) {
                    gotoUpdated = true;
                    return { ...action, args: [normalizedTargetUrl, ...action.args.slice(1)] };
                }
                if ((action.action === 'scrape' || action.action === 'crawl') &&
                    action.args?.[0] && typeof action.args[0] === 'object' &&
                    action.args[0].url === originalEntryUrl) {
                    return { ...action, args: [{ ...action.args[0], url: normalizedTargetUrl }, ...action.args.slice(1)] };
                }
                return action;
            });

            return { ...step, where: updatedWhere, what: updatedWhat };
        }).reverse();

        const currentTimestamp = new Date().toISOString();

        const newRobot = await Robot.create({
            id: uuid(),
            userId: originalRobot.userId,
            recording_meta: {
                ...originalRobot.recording_meta,
                id: uuid(),
                name: `${originalRobot.recording_meta.name} (${lastWord})`,
                url: normalizedTargetUrl,
                createdAt: currentTimestamp,
                updatedAt: currentTimestamp,
            },
            recording: { ...originalRobot.recording, workflow },
            google_sheet_email: null,
            google_sheet_name: null,
            google_sheet_id: null,
            google_access_token: null,
            google_refresh_token: null,
            airtable_base_id: null,
            airtable_base_name: null,
            airtable_table_name: null,
            airtable_table_id: null,
            airtable_access_token: null,
            airtable_refresh_token: null,
            webhooks: null,
            schedule: null,
        });

        logger.info(`[SDK] Robot ${robotId} duplicated as ${newRobot.recording_meta.id}`);

        return res.status(201).json({
            data: newRobot,
            message: "Robot duplicated successfully"
        });
    } catch (error: any) {
        logger.error("[SDK] Error duplicating robot:", error);
        return res.status(500).json({
            error: "Failed to duplicate robot",
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
        const { url, name, crawlConfig, formats } = req.body;

        if (!url || !crawlConfig) {
            return res.status(400).json({
                error: "URL and crawl configuration are required"
            });
        }

        let normalizedUrl: string;
        try {
            normalizedUrl = normalizeRobotUrl(url);
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

        const { validFormats: requestedFormats, invalidFormats, wasProvided } = parseOutputFormats(formats);
        if (invalidFormats.length > 0) {
            return res.status(400).json({
                error: `Invalid formats: ${invalidFormats.map(String).join(', ')}`
            });
        }

        // Crawl always needs formats; use defaults even if explicit empty array is provided
        const crawlFormats: OutputFormats[] = requestedFormats.length > 0 
            ? requestedFormats 
            : [...DEFAULT_OUTPUT_FORMATS];

        const robotName = name || `Crawl Robot - ${new URL(normalizedUrl).hostname}`;
        const robotId = uuid();
        const metaId = uuid();

        const existingRobot = await findExistingRobotByName(robotName, user.id);
        if (existingRobot) {
            const existingCrawlArgs = existingRobot.recording?.workflow?.[0]?.what?.[0]?.args?.[0] || {};
            const sameType = existingRobot.recording_meta?.type === 'crawl';
            const sameUrl = normalizeUrl(existingRobot.recording_meta?.url || '') === normalizeUrl(normalizedUrl);
            const sameConfig = stableStringify(existingCrawlArgs) === stableStringify(crawlConfig);
            const sameFormats = JSON.stringify([...(existingRobot.recording_meta?.formats || [])].sort()) === JSON.stringify([...crawlFormats].sort());

            if (sameType && sameUrl && sameConfig && sameFormats) {
                return res.status(200).json({
                    data: existingRobot,
                    message: "Existing robot returned",
                    existing: true
                });
            }
            return res.status(409).json({
                error: `A robot named "${robotName}" already exists with a different configuration. Please choose a different name.`
            });
        }

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
                url: normalizedUrl,
                formats: crawlFormats,
            },
            recording: {
                workflow: [
                    {
                        where: { url: normalizedUrl },
                        what: [
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
                                args: [normalizedUrl]
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
            url: normalizedUrl,
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
        const { name, searchConfig, formats } = req.body;

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

        const { validFormats: requestedFormats, invalidFormats, wasProvided } = parseOutputFormats(formats);
        if (invalidFormats.length > 0) {
            return res.status(400).json({
                error: `Invalid formats: ${invalidFormats.map(String).join(', ')}`
            });
        }

        const searchFormats: OutputFormats[] = searchConfig.mode === 'discover'
            ? (requestedFormats.length > 0 ? requestedFormats : [])
            : (requestedFormats.length > 0 ? requestedFormats : [...DEFAULT_OUTPUT_FORMATS]);

        searchConfig.provider = 'duckduckgo';

        if (searchConfig.outputFormats && Array.isArray(searchConfig.outputFormats) && searchConfig.outputFormats.length > 0) {
            searchConfig.mode = 'scrape';
        }

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
                formats: searchFormats,
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
                normalizeRobotUrl(url);
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

        if (finalUrl) {
            finalUrl = normalizeRobotUrl(finalUrl);
        }

        const finalRobotName = robotName || `LLM Extract: ${prompt.substring(0, 50)}`;

        const existingRobot = await findExistingRobotByName(finalRobotName, user.id);
        if (existingRobot) {
            const meta = existingRobot.recording_meta;
            const samePrompt = (meta.description || '') === prompt;
            const sameUrl = normalizeUrl(meta.url || '') === normalizeUrl(finalUrl);

            if (samePrompt && sameUrl) {
                return res.status(200).json({
                    success: true,
                    data: {
                        robotId: meta.id,
                        name: meta.name,
                        description: meta.description,
                        url: meta.url,
                        workflow: existingRobot.recording?.workflow || []
                    },
                    existing: true
                });
            }
            return res.status(409).json({
                error: `A robot named "${finalRobotName}" already exists with a different configuration. Please choose a different name.`
            });
        }

        const robotMeta: any = {
            name: robotName || `LLM Extract: ${prompt.substring(0, 50)}`,
            id: metaId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            pairs: normalizeWorkflowUrls(workflowResult.workflow).length,
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
                workflow: normalizeWorkflowUrls(workflowResult.workflow)
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
