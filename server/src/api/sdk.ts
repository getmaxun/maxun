/**
 * SDK API Routes
 * Separate API endpoints specifically for Maxun SDKs
 * All routes require API key authentication
 */

import { Router, Request, Response } from 'express';
import { requireAPIKey } from "../middlewares/api";
import Robot from "../models/Robot";
import RecorderDraft from "../models/RecorderDraft";
import Run from "../models/Run";
import { v4 as uuid } from 'uuid';
import { WorkflowFile } from "maxun-core";
import logger from "../logger";
import { capture } from "../utils/analytics";
import { handleRunRecording } from "./record";
import {
    createRemoteBrowserForRun,
    destroyRemoteBrowser,
    getRemoteBrowser,
    getRemoteBrowserCurrentUrl,
    getRemoteBrowserOwner,
    getRemoteBrowserStatus,
} from '../browser-management/controller';
import { WorkflowEnricher } from "../sdk/workflowEnricher";
import { cancelScheduledWorkflow, scheduleWorkflow } from '../storage/schedule';
import { encrypt } from '../utils/auth';
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
import { normalizeRobotUrl, normalizeWorkflowUrls, applyWorkflowLimits } from '../utils/robot-updates';
import { validateRequiredLlmConfig, formatsRequireLlm, readLlmConfig, toPromptLlmMeta } from '../utils/llm-config-validation';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { MAX_FILE_SIZE_BYTES } from '../workflow-management/classes/DocumentInterpreter';
import { getServiceInstanceId } from '../sdk/serviceIdentity';
import { claimResource, releaseResource, requireResourceClaim, ResourceClaimError } from '../sdk/resourceClaims';
import { createDocumentRobotRecord } from '../utils/document/createDocumentRobotRecord';
import { createDocumentParseRobotRecord } from '../utils/document/createDocumentParseRobotRecord';
import {
    acknowledgeControlObservation,
    acquireControl,
    getControlCommandStatus,
    heartbeatControl,
    releaseControl,
    requireControlLease,
    ControlLeaseError,
    type ControlActor,
} from '../sdk/controlLease';
import {
    abortWhenRequestCloses,
    cancelBrowserControlCommand,
    cancelBrowserControlCommands,
    executeBrowserControlCommand,
    normalizeControlCommand,
} from '../sdk/browserControl';
import type { ControlCommandMode } from '../models/ControlCommand';
import type { ControlCommandKind } from '../browser-management/classes/RemoteBrowser';
import { sanitizeBrowserUrl } from '../sdk/urlPrivacy';
import { normalizeDocumentMimeType, PDF_MIME_TYPE } from '../utils/document/documentFile';
import {
    createLlmRobot,
    getTrustedAgentLlmConfig,
    LlmRobotError,
    summarizeListWorkflow,
} from '../sdk/llmRobot';
import {
    compileRecorderDraft,
    createRecorderDraft,
    RecorderDraftError,
    serializeRecorderDraft,
    selectRecorderDraftList,
    previewRecorderDraft,
    updateRecorderDraftField,
    updateRecorderDraftOptions,
    validateRecorderDraft,
} from '../sdk/recorderDraft';

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
            credits: 999999,
            serviceInstanceId: getServiceInstanceId(),
        });
    } catch (error: any) {
        logger.error("Error getting status:", error);
        return res.status(500).json({
            error: "Failed to get status",
            message: error.message
        });
    }
});

const resourceClaimErrorStatus = (code: ResourceClaimError['code']): number => (
    code === 'claim_conflict' ? 409 : 400
);

const sendResourceClaimError = (res: Response, error: unknown) => {
    if (error instanceof ResourceClaimError) {
        return res.status(resourceClaimErrorStatus(error.code)).json({
            error: error.message,
            code: error.code,
            ...(error.details ? { details: error.details } : {}),
        });
    }
    logger.error(`[SDK] Resource claim error: ${error instanceof Error ? error.message : 'unknown error'}`);
    return res.status(500).json({ error: 'Resource claim operation failed', code: 'internal_error' });
};

/** Explicitly claim one authenticated Maxun draft or browser for one Harness session. */
router.post('/sdk/correlation/claims', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const resourceType = req.body?.resourceType;
        const resourceId = req.body?.resourceId;
        const ownerSessionId = req.body?.ownerSessionId;
        if (resourceType === 'draft') {
            const draft = await RecorderDraft.findOne({ where: { id: resourceId, userId: Number(req.user!.id) } });
            if (!draft) return res.status(404).json({ error: 'Recorder draft not found', code: 'resource_not_found' });
        } else if (resourceType === 'browser') {
            if (getRemoteBrowserOwner(String(resourceId)) !== String(req.user!.id)) {
                return res.status(404).json({ error: 'Browser session not found', code: 'resource_not_found' });
            }
        }
        const claim = await claimResource(Number(req.user!.id), { resourceType, resourceId, ownerSessionId });
        return res.status(claim.existing ? 200 : 201).json({
            success: true,
            data: { ...claim, serviceInstanceId: getServiceInstanceId() },
        });
    } catch (error: unknown) {
        return sendResourceClaimError(res, error);
    }
});

/** Release a claim only from its owning Harness session and epoch. */
router.delete('/sdk/correlation/claims', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        await releaseResource(Number(req.user!.id), {
            resourceType: req.body?.resourceType,
            resourceId: req.body?.resourceId,
            ownerSessionId: req.body?.ownerSessionId,
            epoch: req.body?.epoch,
        });
        return res.status(204).send();
    } catch (error: unknown) {
        return sendResourceClaimError(res, error);
    }
});

/** Reserve a Maxun browser slot for an explicitly owned Harness session. */
router.post('/sdk/browser-sessions', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    const ownerSessionId = typeof req.body?.ownerSessionId === 'string' ? req.body.ownerSessionId.trim() : '';
    if (!ownerSessionId) return res.status(400).json({ error: 'ownerSessionId is required', code: 'invalid_claim' });
    let browserSessionId: string | undefined;
    try {
        browserSessionId = createRemoteBrowserForRun(String(req.user!.id), true);
        const claim = await claimResource(Number(req.user!.id), {
            resourceType: 'browser', resourceId: browserSessionId, ownerSessionId,
        });
        return res.status(201).json({
            success: true,
            data: {
                browserSessionId,
                serviceInstanceId: getServiceInstanceId(),
                browserStatus: 'active',
                status: 'reserved',
                ownerSessionId: claim.ownerSessionId,
                epoch: claim.epoch,
            },
        });
    } catch (error: unknown) {
        if (browserSessionId) await destroyRemoteBrowser(browserSessionId, String(req.user!.id)).catch(() => undefined);
        return sendResourceClaimError(res, error);
    }
});

const CONTROL_CAPABILITY_TTL_SECONDS = 5 * 60;
const CONTROL_ACTORS: readonly ControlActor[] = ['agent', 'human'];
const CONTROL_COMMANDS: readonly ControlCommandKind[] = ['click', 'key', 'type', 'navigate', 'scroll', 'refresh', 'pause', 'resume', 'step', 'abort'];
const CONTROL_MODES: readonly ControlCommandMode[] = ['assist', 'record'];

const controlErrorStatus = (code: ControlLeaseError['code']): number => {
    if (code === 'control_conflict') return 409;
    if (code === 'stale_control' || code === 'control_expired' || code === 'command_replay' || code === 'observation_required') return 409;
    return 400;
};

const sendControlError = (res: Response, error: unknown) => {
    if (error instanceof ResourceClaimError) return sendResourceClaimError(res, error);
    if (error instanceof ControlLeaseError) {
        return res.status(controlErrorStatus(error.code)).json({
            error: error.message,
            code: error.code,
            ...(error.details ? { details: error.details } : {}),
        });
    }
    logger.error(`[SDK] Browser control error: ${error instanceof Error ? error.message : 'unknown error'}`);
    return res.status(500).json({ error: 'Browser control operation failed', code: 'control_internal_error' });
};

const controlCapability = (req: AuthenticatedRequest, browserSessionId: string, lease: {
    ownerSessionId: string;
    actor: ControlActor;
    controlEpoch: number;
}) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new ControlLeaseError('invalid_control', 'Browser control is unavailable without JWT_SECRET');
    const expiresAt = new Date(Date.now() + CONTROL_CAPABILITY_TTL_SECONDS * 1000);
    const capability = jwt.sign({
        id: String(req.user!.id),
        purpose: 'maxun-browser-control',
        browserId: browserSessionId,
        ownerSessionId: lease.ownerSessionId,
        controlEpoch: lease.controlEpoch,
        actor: lease.actor,
    }, secret, { expiresIn: CONTROL_CAPABILITY_TTL_SECONDS });
    return { capability, expiresAt: expiresAt.toISOString() };
};

/** Acquire or transition the server-side browser control lease. */
router.post('/sdk/browser-sessions/:id/control/acquire', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    const browserSessionId = req.params.id;
    const ownerSessionId = typeof req.body?.ownerSessionId === 'string' ? req.body.ownerSessionId.trim() : '';
    const actor = req.body?.actor;
    if (!ownerSessionId || !CONTROL_ACTORS.includes(actor)) {
        return res.status(400).json({ error: 'ownerSessionId and actor are required', code: 'invalid_control' });
    }
    try {
        if (getRemoteBrowserOwner(browserSessionId) !== String(req.user!.id)) {
            return res.status(404).json({ error: 'Browser session not found', code: 'resource_not_found' });
        }
        const lease = await acquireControl(Number(req.user!.id), { browserSessionId, ownerSessionId, actor });
        if (!lease.existing) cancelBrowserControlCommands(Number(req.user!.id), browserSessionId);
        const token = controlCapability(req, browserSessionId, lease);
        return res.status(200).json({
            success: true,
            data: {
                ...lease,
                ...token,
                streamUrl: (process.env.MAXUN_BROWSER_STREAM_URL || `${req.protocol}://${req.get('host')}`).replace(/\/api\/?$/, ''),
                serviceInstanceId: getServiceInstanceId(),
                currentUrl: sanitizeBrowserUrl(getRemoteBrowserCurrentUrl(browserSessionId, String(req.user!.id))) || null,
                browserStatus: getRemoteBrowserStatus(browserSessionId) === 'failed' ? 'gone' : 'active',
            },
        });
    } catch (error: unknown) {
        return sendControlError(res, error);
    }
});

/** Acknowledge the fresh rrweb full snapshot required after agent takeover. */
router.post('/sdk/browser-sessions/:id/control/observation/ack', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const lease = await acknowledgeControlObservation(Number(req.user!.id), {
            browserSessionId: req.params.id,
            ownerSessionId: req.body?.ownerSessionId,
            actor: req.body?.actor,
            controlEpoch: req.body?.controlEpoch,
        });
        return res.status(200).json({ success: true, data: lease });
    } catch (error: unknown) {
        return sendControlError(res, error);
    }
});

/** Extend a control lease without advancing its epoch. */
router.post('/sdk/browser-sessions/:id/control/heartbeat', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const lease = await heartbeatControl(Number(req.user!.id), {
            browserSessionId: req.params.id,
            ownerSessionId: req.body?.ownerSessionId,
            actor: req.body?.actor,
            controlEpoch: req.body?.controlEpoch,
        });
        return res.status(200).json({ success: true, data: lease });
    } catch (error: unknown) {
        return sendControlError(res, error);
    }
});

/** Release a lease and cancel any command that was in flight for the old epoch. */
router.post('/sdk/browser-sessions/:id/control/release', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await releaseControl(Number(req.user!.id), {
            browserSessionId: req.params.id,
            ownerSessionId: req.body?.ownerSessionId,
            actor: req.body?.actor,
            controlEpoch: req.body?.controlEpoch,
        });
        cancelBrowserControlCommands(Number(req.user!.id), req.params.id);
        return res.status(200).json({ success: true, data: result });
    } catch (error: unknown) {
        return sendControlError(res, error);
    }
});

/** Execute one epoch-bound browser/interpreter command. */
router.post('/sdk/browser-sessions/:id/control/command', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    const browserSessionId = req.params.id;
    const ownerSessionId = typeof req.body?.ownerSessionId === 'string' ? req.body.ownerSessionId.trim() : '';
    const actor = req.body?.actor;
    const controlEpoch = req.body?.controlEpoch;
    const commandId = typeof req.body?.commandId === 'string' ? req.body.commandId.trim() : '';
    if (!ownerSessionId || !CONTROL_ACTORS.includes(actor) || !Number.isSafeInteger(controlEpoch) || controlEpoch < 1 || !commandId) {
        return res.status(400).json({ error: 'ownerSessionId, actor, positive controlEpoch, and commandId are required', code: 'invalid_control' });
    }
    try {
        const command = normalizeControlCommand(req.body);
        if (getRemoteBrowserOwner(browserSessionId) !== String(req.user!.id)) {
            return res.status(404).json({ error: 'Browser session not found', code: 'resource_not_found' });
        }
        const browser = getRemoteBrowserStatus(browserSessionId) === 'ready'
            ? getRemoteBrowser(browserSessionId, String(req.user!.id))
            : undefined;
        if (!browser) return res.status(404).json({ error: 'Browser session not found', code: 'resource_not_found' });
        const abort = new AbortController();
        const cleanup = abortWhenRequestCloses(req, abort, () => res.writableEnded);
        try {
            const result = await executeBrowserControlCommand(Number(req.user!.id), browser, {
                browserSessionId,
                ownerSessionId,
                actor,
                controlEpoch,
                commandId,
                commandType: command.kind,
                mode: command.mode,
            }, command, abort.signal);
            return res.status(200).json({ success: true, data: result });
        } finally {
            cleanup();
        }
    } catch (error: unknown) {
        if (error instanceof Error && /cancelled|disconnected/i.test(error.message)) {
            return res.status(499).json({ error: 'Control command cancelled', code: 'control_cancelled' });
        }
        if (error instanceof ControlLeaseError) return sendControlError(res, error);
        logger.error(`[SDK] Browser control command failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        return res.status(502).json({ error: 'Browser control command failed', code: 'control_command_failed' });
    }
});

/** Read compact command outcome without exposing command arguments or text. */
router.get('/sdk/browser-sessions/:id/control/command/:commandId', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await getControlCommandStatus(Number(req.user!.id), {
            browserSessionId: req.params.id,
            ownerSessionId: String(req.query.ownerSessionId ?? ''),
            actor: req.query.actor === 'human' ? 'human' : 'agent',
            controlEpoch: Number(req.query.controlEpoch),
            commandId: req.params.commandId,
        });
        if (!result) return res.status(404).json({ error: 'Control command not found', code: 'control_command_not_found' });
        return res.status(200).json({ success: true, data: result });
    } catch (error: unknown) {
        return sendControlError(res, error);
    }
});

/** Cooperatively cancel one running command without accepting command arguments. */
router.post('/sdk/browser-sessions/:id/control/command/:commandId/cancel', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        await requireControlLease(Number(req.user!.id), {
            browserSessionId: req.params.id,
            ownerSessionId: req.body?.ownerSessionId,
            actor: req.body?.actor,
            controlEpoch: req.body?.controlEpoch,
        });
        const cancelled = cancelBrowserControlCommand(Number(req.user!.id), req.params.id, req.params.commandId);
        return res.status(200).json({ success: true, data: { commandId: req.params.commandId, cancelled } });
    } catch (error: unknown) {
        return sendControlError(res, error);
    }
});

const BROWSER_STREAM_CAPABILITY_TTL_SECONDS = 60;

/** Issue a short-lived claim-bound token for the read-only browser stream. */
router.post('/sdk/browser-sessions/:id/stream-capability', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    const browserSessionId = req.params.id;
    const ownerSessionId = typeof req.body?.ownerSessionId === 'string' ? req.body.ownerSessionId.trim() : '';
    const epoch = req.body?.epoch;
    if (!ownerSessionId || !Number.isSafeInteger(epoch) || epoch < 1) {
        return res.status(400).json({ error: 'ownerSessionId and positive integer epoch are required', code: 'invalid_claim' });
    }
    try {
        if (getRemoteBrowserOwner(browserSessionId) !== String(req.user!.id)) {
            return res.status(404).json({ error: 'Browser session not found', code: 'resource_not_found' });
        }
        await requireResourceClaim(Number(req.user!.id), {
            resourceType: 'browser', resourceId: browserSessionId, ownerSessionId,
        });
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            logger.error('[SDK] Cannot issue browser stream capability without JWT_SECRET');
            return res.status(503).json({ error: 'Browser stream is unavailable', code: 'service_unavailable' });
        }
        const expiresAt = new Date(Date.now() + BROWSER_STREAM_CAPABILITY_TTL_SECONDS * 1000);
        const capability = jwt.sign({
            id: String(req.user!.id),
            purpose: 'maxun-browser-stream',
            browserId: browserSessionId,
            ownerSessionId,
            epoch,
        }, secret, { expiresIn: BROWSER_STREAM_CAPABILITY_TTL_SECONDS });
        return res.status(200).json({
            success: true,
            data: {
                capability,
                expiresAt: expiresAt.toISOString(),
                streamUrl: (process.env.MAXUN_BROWSER_STREAM_URL || `${req.protocol}://${req.get('host')}`).replace(/\/api\/?$/, ''),
                serviceInstanceId: getServiceInstanceId(),
                browserSessionId,
                ownerSessionId,
                epoch,
            },
        });
    } catch (error: unknown) {
        return sendResourceClaimError(res, error);
    }
});

/** Capture a current-browser screenshot for the authenticated owner. */
router.post('/sdk/browser-sessions/:id/screenshot', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    const browserSessionId = req.params.id;
    const ownerSessionId = typeof req.body?.ownerSessionId === 'string' ? req.body.ownerSessionId.trim() : '';
    const epoch = req.body?.epoch;
    if (!ownerSessionId || !Number.isSafeInteger(epoch) || epoch < 1) {
        return res.status(400).json({ error: 'ownerSessionId and positive integer epoch are required', code: 'invalid_claim' });
    }
    try {
        if (getRemoteBrowserOwner(browserSessionId) !== String(req.user!.id)) {
            return res.status(404).json({ error: 'Browser session not found', code: 'resource_not_found' });
        }
        const claim = await requireResourceClaim(Number(req.user!.id), {
            resourceType: 'browser', resourceId: browserSessionId, ownerSessionId, epoch,
        });
        if (claim.epoch !== epoch) {
            return res.status(409).json({ error: 'Browser resource claim is stale', code: 'stale_claim', epoch: claim.epoch });
        }
        const browser = getRemoteBrowserStatus(browserSessionId) === 'ready'
            ? getRemoteBrowser(browserSessionId, String(req.user!.id))
            : undefined;
        if (!browser) return res.status(404).json({ error: 'Browser session not found', code: 'resource_not_found' });
        const image = await browser.captureCurrentScreenshot({
            fullPage: req.body?.fullPage === true,
            type: req.body?.type === 'jpeg' ? 'jpeg' : 'png',
            timeout: 30000,
            animations: 'disabled',
            caret: 'hide',
            scale: 'css',
        });
        res.setHeader('content-type', req.body?.type === 'jpeg' ? 'image/jpeg' : 'image/png');
        res.setHeader('cache-control', 'no-store');
        return res.status(200).send(image);
    } catch (error: unknown) {
        if (error instanceof ResourceClaimError) return sendResourceClaimError(res, error);
        logger.error(`[SDK] Browser screenshot failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        return res.status(502).json({ error: 'Browser screenshot unavailable', code: 'screenshot_unavailable' });
    }
});

/** Read process-local browser health for its authenticated owner. */
router.get('/sdk/browser-sessions/:id', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    const browserSessionId = req.params.id;
    if (getRemoteBrowserOwner(browserSessionId) !== String(req.user!.id)) {
        return res.status(404).json({ error: 'Browser session not found', code: 'resource_not_found' });
    }
    const status = getRemoteBrowserStatus(browserSessionId);
    if (!status) return res.status(404).json({ error: 'Browser session not found', code: 'resource_not_found' });
    try {
        await requireResourceClaim(Number(req.user!.id), {
            resourceType: 'browser', resourceId: browserSessionId,
            ownerSessionId: req.query.ownerSessionId,
        });
    } catch (error: unknown) {
        return sendResourceClaimError(res, error);
    }
    return res.status(200).json({
        success: true,
        data: {
            browserSessionId,
            serviceInstanceId: getServiceInstanceId(),
            browserStatus: status === 'failed' ? 'gone' : 'active',
            status,
            currentUrl: sanitizeBrowserUrl(getRemoteBrowserCurrentUrl(browserSessionId, String(req.user!.id))) || null,
        },
    });
});

/** Explicitly release ownership and destroy one browser session. */
router.delete('/sdk/browser-sessions/:id', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    const browserSessionId = req.params.id;
    try {
        await requireResourceClaim(Number(req.user!.id), {
            resourceType: 'browser', resourceId: browserSessionId,
            ownerSessionId: req.body?.ownerSessionId,
        });
        await releaseResource(Number(req.user!.id), {
            resourceType: 'browser', resourceId: browserSessionId,
            ownerSessionId: req.body?.ownerSessionId, epoch: req.body?.epoch,
        });
        await destroyRemoteBrowser(browserSessionId, String(req.user!.id));
        return res.status(204).send();
    } catch (error: unknown) {
        return sendResourceClaimError(res, error);
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
            } catch (err) {
                return res.status(400).json({
                    error: `Invalid URL: ${err instanceof Error ? err.message : 'malformed URL'}`
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

        const robotLlmConfig = readLlmConfig(workflowFile.meta);
        const needsLlmForSummary = formatsRequireLlm(normalizedFormats);
        const needsLlmForSmartQuery = Boolean(promptInstructionsForMeta);
        if (needsLlmForSummary || needsLlmForSmartQuery) {
            const reason = needsLlmForSummary && needsLlmForSmartQuery
                ? 'The "summary" output format and Smart Query'
                : needsLlmForSummary
                    ? 'The "summary" output format'
                    : 'Smart Query (promptInstructions)';

            const llmValidationError = validateRequiredLlmConfig(robotLlmConfig, reason);
            if (llmValidationError) {
                return res.status(400).json(llmValidationError);
            }
        }

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
            ...toPromptLlmMeta(robotLlmConfig, encrypt),
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

        /**
         * A single working copy of the workflow. A request may replace the
         * workflow wholesale, patch individual values such as `limits`, or do
         * both, so every block below edits this one array, and it is written
         * back to `updateData` once at the end.
         */
        let workflow: any[];
        try {
            workflow = updates.workflow
                ? normalizeWorkflowUrls(updates.workflow)
                : JSON.parse(JSON.stringify(robot.recording?.workflow || []));
        } catch {
            return res.status(400).json({ error: "Invalid URL in workflow" });
        }

        let workflowTouched = Boolean(updates.workflow);

        if (updates.meta) {
            let normalizedMetaUrl: string | undefined;
            if (updates.meta.url) {
                try {
                    normalizedMetaUrl = normalizeRobotUrl(updates.meta.url);
                } catch (err) {
                    return res.status(400).json({
                        error: `Invalid URL: ${err instanceof Error ? err.message : 'malformed URL'}`
                    });
                }
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
                workflowTouched = true;
            }

            updateData.recording_meta = {
                ...robot.recording_meta,
                ...updates.meta,
                ...(normalizedMetaUrl ? { url: normalizedMetaUrl } : {}),
                updatedAt: new Date().toISOString()
            };
        }

        /**
         * Targeted limit updates, addressed by position in the workflow. Runs
         * after the workflow and meta blocks so the value the caller asked for
         * survives whatever those wrote. Anything not named here keeps the
         * value it already had.
         */
        if (Array.isArray(updates.limits) && updates.limits.length > 0) {
            try {
                applyWorkflowLimits(workflow, updates.limits);
                workflowTouched = true;
            } catch (error) {
                return res.status(400).json({
                    error: error instanceof Error ? error.message : 'Invalid limit update',
                });
            }
        }

        if (workflowTouched) {
            updateData.recording = { ...robot.recording, workflow };
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
        let summary: string | undefined = undefined;

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
        if (run.serializableOutput?.summary && Array.isArray(run.serializableOutput.summary)) {
            summary = run.serializableOutput.summary[0]?.content || undefined;
        }
        if (!summary && scrapeOutput?.summary && Array.isArray(scrapeOutput.summary)) {
            summary = scrapeOutput.summary[0]?.content || undefined;
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
                    summary: summary,
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
        } catch (err) {
            return res.status(400).json({
                error:  `Invalid URL: ${err instanceof Error ? err.message : 'malformed URL'}`
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
        const llmConfigInput = readLlmConfig(req.body);

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
                error: `Invalid URL: ${err instanceof Error ? err.message : 'malformed URL'}`
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

        const crawlFormats: OutputFormats[] = requestedFormats.length > 0
            ? requestedFormats
            : [...DEFAULT_OUTPUT_FORMATS];

        if (formatsRequireLlm(crawlFormats)) {
            const llmValidationError = validateRequiredLlmConfig(
                llmConfigInput,
                'The "summary" output format'
            );
            if (llmValidationError) {
                return res.status(400).json(llmValidationError);
            }
        }

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
                ...toPromptLlmMeta(llmConfigInput, encrypt),
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
        const llmConfigInput = readLlmConfig(req.body);

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

        if (formatsRequireLlm(searchFormats) || formatsRequireLlm(searchConfig.outputFormats)) {
            const llmValidationError = validateRequiredLlmConfig(
                llmConfigInput,
                'The "summary" output format'
            );
            if (llmValidationError) {
                return res.status(400).json(llmValidationError);
            }
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
                ...toPromptLlmMeta(llmConfigInput, encrypt),
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

        const llmValidationError = validateRequiredLlmConfig(
            readLlmConfig(req.body),
            'Creating an LLM extract robot'
        );
        if (llmValidationError) {
            return res.status(400).json(llmValidationError);
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

/**
 * Create and persist a native list robot from a URL and natural-language request.
 * The generator LLM configuration is read from trusted Maxun server environment.
 */
router.post("/sdk/robots/list", requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    const robotName = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
    const llmConfig = getTrustedAgentLlmConfig();

    if (!url) return res.status(400).json({ error: 'url is required', code: 'invalid_request' });
    if (!prompt) return res.status(400).json({ error: 'prompt is required', code: 'invalid_request' });
    if (!llmConfig.provider || !llmConfig.apiKey) {
        return res.status(503).json({
            error: 'Maxun agent LLM is not configured',
            code: 'agent_llm_not_configured',
        });
    }

    try {
        const result = await createLlmRobot({
            url,
            prompt,
            userId: req.user!.id,
            robotName,
            llmConfig,
        });
        const summary = summarizeListWorkflow(result.workflow);
        const meta = result.robot.recording_meta;

        return res.status(result.existing ? 200 : 201).json({
            success: true,
            existing: result.existing,
            data: {
                robotId: meta.id,
                name: meta.name,
                url: meta.url,
                type: meta.type,
                ...summary,
            },
        });
    } catch (error: unknown) {
        if (error instanceof LlmRobotError) {
            const status = error.code === 'robot_name_conflict' ? 409 : error.code === 'invalid_url' ? 400 : 422;
            return res.status(status).json({
                error: error.message,
                code: error.code,
                ...(error.details ? { details: error.details } : {}),
            });
        }

        const message = error instanceof Error ? error.message.replaceAll(llmConfig.apiKey, '[redacted]') : 'unknown error';
        logger.error(`[SDK] Error creating list robot: ${message}`);
        return res.status(500).json({ error: 'Failed to create list robot', code: 'internal_error' });
    }
});

const recorderDraftErrorStatus = (code: RecorderDraftError['code']): number => {
    if (code === 'draft_not_found' || code === 'candidate_not_found' || code === 'field_not_found') return 404;
    if (code === 'validation_failed') return 422;
    if (code === 'robot_name_conflict') return 409;
    return 400;
};

const sendRecorderDraftError = (res: Response, error: unknown) => {
    if (error instanceof RecorderDraftError) {
        return res.status(recorderDraftErrorStatus(error.code)).json({
            error: error.message,
            code: error.code,
            ...(error.details ? { details: error.details } : {}),
        });
    }
    if (error instanceof LlmRobotError) {
        const status = error.code === 'robot_name_conflict' ? 409 : error.code === 'invalid_url' ? 400 : 422;
        return res.status(status).json({
            error: error.message,
            code: error.code,
            ...(error.details ? { details: error.details } : {}),
        });
    }
    const message = error instanceof Error ? error.message : 'unknown error';
    logger.error(`[SDK] Recorder Draft error: ${message}`);
    return res.status(500).json({ error: 'Recorder Draft operation failed', code: 'internal_error' });
};

/**
 * Create a semantic Recorder Draft. Maxun discovers repeated lists and owns
 * all selectors; the API returns only opaque candidate IDs and metadata.
 */
router.post('/sdk/recorder/drafts', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!url) return res.status(400).json({ error: 'url is required', code: 'invalid_request' });
    try {
        const draft = await createRecorderDraft({
            url,
            userId: req.user!.id,
            name: typeof req.body?.name === 'string' ? req.body.name : undefined,
            description: typeof req.body?.description === 'string' ? req.body.description : undefined,
        });
        return res.status(201).json({ success: true, data: serializeRecorderDraft(draft) });
    } catch (error: unknown) {
        return sendRecorderDraftError(res, error);
    }
});

router.get('/sdk/recorder/drafts/:id', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const draft = await RecorderDraft.findOne({
            where: { id: req.params.id, userId: Number(req.user!.id) },
        });
        if (!draft) return res.status(404).json({ error: 'Recorder draft not found', code: 'draft_not_found' });
        return res.status(200).json({ success: true, data: serializeRecorderDraft(draft) });
    } catch (error: unknown) {
        return sendRecorderDraftError(res, error);
    }
});

router.post('/sdk/recorder/drafts/:id/select-list', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const listCandidateId = typeof req.body?.listCandidateId === 'string' ? req.body.listCandidateId : '';
        if (!listCandidateId) throw new RecorderDraftError('invalid_request', 'listCandidateId is required');
        const draft = await selectRecorderDraftList(req.params.id, req.user!.id, listCandidateId, req.body?.limit);
        return res.status(200).json({ success: true, data: serializeRecorderDraft(draft) });
    } catch (error: unknown) {
        return sendRecorderDraftError(res, error);
    }
});

router.post('/sdk/recorder/drafts/:id/fields', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const fieldId = typeof req.body?.fieldId === 'string' ? req.body.fieldId : '';
        const action = req.body?.action;
        if (!fieldId || !['include', 'exclude', 'rename'].includes(action)) {
            throw new RecorderDraftError('invalid_request', 'fieldId and action (include, exclude, or rename) are required');
        }
        const draft = await updateRecorderDraftField(req.params.id, req.user!.id, { fieldId, action, name: req.body?.name });
        return res.status(200).json({ success: true, data: serializeRecorderDraft(draft) });
    } catch (error: unknown) {
        return sendRecorderDraftError(res, error);
    }
});

router.post('/sdk/recorder/drafts/:id/options', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const draft = await updateRecorderDraftOptions(req.params.id, req.user!.id, { limit: req.body?.limit });
        return res.status(200).json({ success: true, data: serializeRecorderDraft(draft) });
    } catch (error: unknown) {
        return sendRecorderDraftError(res, error);
    }
});

router.post('/sdk/recorder/drafts/:id/preview', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const preview = await previewRecorderDraft(req.params.id, req.user!.id, {
            followPagination: req.body?.followPagination !== false,
            limit: req.body?.limit,
        });
        return res.status(200).json({ success: true, data: preview });
    } catch (error: unknown) {
        return sendRecorderDraftError(res, error);
    }
});

router.post('/sdk/recorder/drafts/:id/validate', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const scope = req.body?.scope === 'multi-page' ? 'multi-page' : 'current-page';
        const validation = await validateRecorderDraft(req.params.id, req.user!.id, scope);
        return res.status(validation.valid ? 200 : 422).json({ success: validation.valid, data: validation });
    } catch (error: unknown) {
        return sendRecorderDraftError(res, error);
    }
});

router.post('/sdk/recorder/drafts/:id/compile', requireAPIKey, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await compileRecorderDraft(req.params.id, req.user!.id, {
            robotName: typeof req.body?.robotName === 'string' ? req.body.robotName : undefined,
        });
        const meta = result.robot.recording_meta;
        const summary = summarizeListWorkflow(result.workflow);
        return res.status(result.existing ? 200 : 201).json({
            success: true,
            existing: result.existing,
            data: {
                draftId: result.draft.id,
                robotId: meta.id,
                name: meta.name,
                url: meta.url,
                type: meta.type,
                fields: summary.fields,
                pagination: summary.pagination
                    ? { type: summary.pagination.type, tested: true }
                    : null,
                limit: summary.limit,
            },
        });
    } catch (error: unknown) {
        return sendRecorderDraftError(res, error);
    }
});

/**
 * Uploads for the document endpoints
 */
const documentUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
    fileFilter: (_req, file, cb) => {
        const allowedMimeTypes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/csv',
            'application/csv',
        ];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF, XLSX, and CSV files are allowed'));
        }
    },
});

const DOC_PARSE_FORMATS: OutputFormats[] = ['markdown', 'html', 'links', 'summary'];

/**
 * Create a document extraction robot from an uploaded file
 * POST /api/sdk/robots/document
 */
router.post("/sdk/robots/document", requireAPIKey, documentUpload.single('file'), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const user = req.user;
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file) return res.status(400).json({ error: 'A PDF file is required' });

        const prompt: string = (req.body.prompt || '').trim();
        if (!prompt) return res.status(400).json({ error: 'prompt is required' });

        const llmConfigInput = readLlmConfig(req.body);
        const llmValidationError = validateRequiredLlmConfig(
            llmConfigInput,
            'Creating a document extract robot'
        );
        if (llmValidationError) {
            return res.status(400).json(llmValidationError);
        }

        const robotName = (typeof req.body.robotName === 'string' ? req.body.robotName.trim() : '')
            || `Document: ${prompt.substring(0, 50)}`;

        const existingRobot = await findExistingRobotByName(robotName, user.id);
        if (existingRobot) {
            return res.status(409).json({
                error: `A robot named "${robotName}" already exists. Please choose a different name.`
            });
        }

        const { robot, extractionSchema } = await createDocumentRobotRecord({
            documentBuffer: file.buffer,
            documentMimeType: normalizeDocumentMimeType(file.mimetype, file.originalname) || PDF_MIME_TYPE,
            originalFileName: file.originalname,
            prompt,
            robotName,
            llmProvider: llmConfigInput.provider as 'anthropic' | 'openai' | 'ollama' | undefined,
            llmModel: typeof llmConfigInput.model === 'string' ? llmConfigInput.model : undefined,
            llmApiKey: typeof llmConfigInput.apiKey === 'string' ? llmConfigInput.apiKey : undefined,
            llmBaseUrl: typeof llmConfigInput.baseUrl === 'string' ? llmConfigInput.baseUrl : undefined,
            userId: user.id,
        });

        logger.info(`[SDK] Document robot created: ${robot.recording_meta?.id}`);

        capture('maxun-oss-robot-created', {
            robot_meta: robot.recording_meta,
            robot_type: 'doc-extract',
        });

        return res.status(201).json({
            success: true,
            data: robot,
            extractionSchema,
        });
    } catch (error: any) {
        if (error.name === 'SequelizeUniqueConstraintError' || error.parent?.code === '23505') {
            return res.status(409).json({ error: 'A robot with this name already exists.' });
        }
        logger.error(`[SDK] Error creating document robot: ${error.message}`);
        return res.status(500).json({
            error: 'Failed to create document robot',
            message: error.message
        });
    }
});

/**
 * Create a document parse robot from an uploaded file
 * POST /api/sdk/robots/document-parse
 *
 * Parsing converts the document to markdown/html/links without an LLM, so no
 * model configuration is required.
 */
router.post("/sdk/robots/document-parse", requireAPIKey, documentUpload.single('file'), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const user = req.user;
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file) return res.status(400).json({ error: 'A PDF file is required' });

        const rawFormats = req.body['outputFormats[]'] ?? req.body.outputFormats ?? req.body.formats;
        const requestedFormats: string[] = Array.isArray(rawFormats)
            ? rawFormats
            : (typeof rawFormats === 'string' ? [rawFormats] : []);

        const invalidFormats = requestedFormats.filter((f) => !DOC_PARSE_FORMATS.includes(f as OutputFormats));
        if (invalidFormats.length > 0) {
            return res.status(400).json({
                error: `Invalid formats: ${invalidFormats.join(', ')}. Document parse supports: ${DOC_PARSE_FORMATS.join(', ')}.`
            });
        }

        const outputFormats: OutputFormats[] = requestedFormats.length > 0
            ? (requestedFormats as OutputFormats[])
            : [...DOC_PARSE_FORMATS];

        const llmConfigInput = readLlmConfig(req.body);
        if (formatsRequireLlm(outputFormats)) {
            const llmValidationError = validateRequiredLlmConfig(
                llmConfigInput,
                'The "summary" output format'
            );
            if (llmValidationError) {
                return res.status(400).json(llmValidationError);
            }
        }

        const robotName = (typeof req.body.robotName === 'string' ? req.body.robotName.trim() : '')
            || `Doc Parse: ${file.originalname}`;

        const existingRobot = await findExistingRobotByName(robotName, user.id);
        if (existingRobot) {
            return res.status(409).json({
                error: `A robot named "${robotName}" already exists. Please choose a different name.`
            });
        }

        const { robot, parsedOutput } = await createDocumentParseRobotRecord({
            documentBuffer: file.buffer,
            documentMimeType: normalizeDocumentMimeType(file.mimetype, file.originalname) || PDF_MIME_TYPE,
            originalFileName: file.originalname,
            robotName,
            outputFormats,
            userId: user.id,
            llmProvider: llmConfigInput.provider as 'anthropic' | 'openai' | 'ollama' | undefined,
            llmModel: typeof llmConfigInput.model === 'string' ? llmConfigInput.model : undefined,
            llmApiKey: typeof llmConfigInput.apiKey === 'string' ? llmConfigInput.apiKey : undefined,
            llmBaseUrl: typeof llmConfigInput.baseUrl === 'string' ? llmConfigInput.baseUrl : undefined,
        });

        logger.info(`[SDK] Document parse robot created: ${robot.recording_meta?.id}`);

        capture('maxun-oss-robot-created', {
            robot_meta: robot.recording_meta,
            robot_type: 'doc-parse',
        });

        return res.status(201).json({
            success: true,
            data: robot,
        });
    } catch (error: any) {
        if (error.name === 'SequelizeUniqueConstraintError' || error.parent?.code === '23505') {
            return res.status(409).json({ error: 'A robot with this name already exists.' });
        }
        logger.error(`[SDK] Error creating document parse robot: ${error.message}`);
        return res.status(500).json({
            error: 'Failed to create document parse robot',
            message: error.message
        });
    }
});

export default router;
