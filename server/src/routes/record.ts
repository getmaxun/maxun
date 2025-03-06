/**
 * RESTful API endpoints handling remote browser recording sessions.
 */
import { Router, Request, Response } from 'express';

import {
    initializeRemoteBrowserForRecording,
    destroyRemoteBrowser,
    getActiveBrowserId,
    interpretWholeWorkflow,
    stopRunningInterpretation,
    getRemoteBrowserCurrentUrl,
    getRemoteBrowserCurrentTabs,
} from '../browser-management/controller';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import logger from "../logger";
import { getDecryptedProxyConfig } from './proxy';
import { requireSignIn } from '../middlewares/auth';
import { pgBoss } from '../server'; // Import pgBoss reference

export const router = Router();
chromium.use(stealthPlugin());

export interface AuthenticatedRequest extends Request {
    user?: any;
}

/**
 * Logs information about remote browser recording session.
 */
router.all('/', requireSignIn, (req, res, next) => {
    logger.log('debug', `The record API was invoked: ${req.url}`)
    next() // pass control to the next handler
})

/**
 * GET endpoint for starting the remote browser recording session.
 * returns session's id or job id
 */
router.get('/start', requireSignIn, async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
        return res.status(401).send('User not authenticated');
    }
    try {
        const job = await pgBoss.send('initialize-browser-recording', {
            userId: req.user.id
        });
        
        if (!job) {
            logger.log('warn', 'pgBoss.send returned null, falling back to direct initialization');
            const browserId = initializeRemoteBrowserForRecording(req.user.id);
            return res.send(browserId);
        }
        
        logger.log('info', `Queued browser initialization job: ${job}`);
        return res.send(job); 
    } catch (error: any) {
        logger.log('error', `Failed to queue browser initialization job: ${error.message}`);
        
        try {
            const browserId = initializeRemoteBrowserForRecording(req.user.id);
            return res.send(browserId);
        } catch (directError: any) {
            logger.log('error', `Direct initialization also failed: ${directError.message}`);
            return res.status(500).send('Failed to start recording');
        }
    }
});

/**
 * POST endpoint for starting the remote browser recording session accepting browser launch options.
 * returns session's id or job id
 */
router.post('/start', requireSignIn, async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
        return res.status(401).send('User not authenticated');
    }
    try {
        const job = await pgBoss.send('initialize-browser-recording', {
            userId: req.user.id
        });
        
        if (!job) {
            logger.log('warn', 'pgBoss.send returned null, falling back to direct initialization');
            const browserId = initializeRemoteBrowserForRecording(req.user.id);
            return res.send(browserId);
        }
        
        logger.log('info', `Queued browser initialization job: ${job}`);
        return res.send(job); 
    } catch (error: any) {
        logger.log('error', `Failed to queue browser initialization job: ${error.message}`);

        try {
            const browserId = initializeRemoteBrowserForRecording(req.user.id);
            return res.send(browserId);
        } catch (directError: any) {
            logger.log('error', `Direct initialization also failed: ${directError.message}`);
            return res.status(500).send('Failed to start recording');
        }
    }
});

/**
 * GET endpoint for getting the job status of a browser initialization job
 */
router.get('/job-status/:jobId', requireSignIn, async (req, res) => {
    try {
        logger.log('debug', `Checking status for job ${req.params.jobId}`);
        const job = await pgBoss.getJobById("job-status", req.params.jobId);
        
        if (!job) {
            logger.log('warn', `Job ${req.params.jobId} not found`);
            return res.status(404).send('Job not found');
        }
        
        logger.log('debug', `Job state: ${job.state}, hasOutput: ${!!job.output}`);
        
        if (job.state === 'completed' && job.output) {
            const output = job.output as { browserId?: string };
            if (output.browserId) {
                logger.log('info', `Job completed with browserId: ${output.browserId}`);
            } else {
                logger.log('warn', `Job completed but missing browserId in output`);
            }
            return res.send(output); // Return the browser ID from the completed job
        }
        
        return res.send({ 
            state: job.state,
            createdAt: job.createdOn,
            startedAt: job.startedOn || null
        });
    } catch (error: any) {
        logger.log('error', `Failed to get job status: ${error.message}`);
        return res.status(500).send('Failed to get job status');
    }
});

/**
 * GET endpoint for terminating the remote browser recording session.
 * returns whether the termination was successful
 */
router.get('/stop/:browserId', requireSignIn, async (req, res) => {
    try {
        if (req.params.browserId.startsWith('job_')) {
            logger.log('debug', `Stopping job ${req.params.browserId}`);
            
            try {
                const job = await pgBoss.getJobById("stop", req.params.browserId);
                if (job && job.state === 'completed' && job.output) {
                    const output = job.output as { browserId?: string };
                    if (output.browserId) {
                        await pgBoss.send('destroy-browser', {
                            browserId: output.browserId
                        });
                        logger.log('info', `Queued destroy job for browser ${output.browserId}`);
                        return res.send(true);
                    }
                } else if (job && (job.state === 'created' || job.state === 'active')) {
                    await pgBoss.cancel("cancel", req.params.browserId);
                    logger.log('info', `Cancelled job ${req.params.browserId}`);
                    return res.send(true);
                }
            } catch (jobError: any) {
                logger.log('error', `Error handling job termination: ${jobError.message}`);
            }
        }
        
        try {
            await pgBoss.send('destroy-browser', {
                browserId: req.params.browserId
            });
            logger.log('info', `Queued destroy job for browser ${req.params.browserId}`);
            return res.send(true);
        } catch (queueError: any) {
            logger.log('error', `Failed to queue destroy job: ${queueError.message}`);
            
            const success = await destroyRemoteBrowser(req.params.browserId);
            logger.log('info', `Direct browser destruction result: ${success}`);
            return res.send(success);
        }
    } catch (error: any) {
        logger.log('error', `Failed to stop browser: ${error.message}`);
        return res.status(500).send(false);
    }
});

/**
 * GET endpoint for getting the id of the active remote browser.
 */
router.get('/active', requireSignIn, (req, res) => {
    const id = getActiveBrowserId();
    return res.send(id);
});

/**
 * GET endpoint for getting the current url of the active remote browser.
 */
router.get('/active/url', requireSignIn, (req, res) => {
    const id = getActiveBrowserId();
    if (id) {
        const url = getRemoteBrowserCurrentUrl(id);
        return res.send(url);
    }
    return res.send(null);
});

/**
 * GET endpoint for getting the current tabs of the active remote browser.
 */
router.get('/active/tabs', requireSignIn, (req, res) => {
    const id = getActiveBrowserId();
    if (id) {
        const hosts = getRemoteBrowserCurrentTabs(id);
        return res.send(hosts);
    }
    return res.send([]);
});

/**
 * GET endpoint for starting an interpretation of the currently generated workflow.
 */
router.get('/interpret', requireSignIn, async (req, res) => {
    try {
        const job = await pgBoss.send('interpret-workflow', {});
        
        if (!job) {
            logger.log('warn', 'pgBoss.send returned null for interpret, falling back to direct interpretation');
            await interpretWholeWorkflow();
            return res.send('interpretation complete (direct)');
        }
        
        logger.log('info', `Queued interpretation job: ${job}`);
        return res.send('interpretation queued');
    } catch (error: any) {
        logger.log('error', `Failed to queue interpretation job: ${error.message}`);
        
        try {
            await interpretWholeWorkflow();
            return res.send('interpretation complete (fallback)');
        } catch (directError: any) {
            return res.status(500).send('interpretation failed');
        }
    }
});

/**
 * GET endpoint for stopping an ongoing interpretation of the currently generated workflow.
 */
router.get('/interpret/stop', requireSignIn, async (req, res) => {
    try {
        const job = await pgBoss.send('stop-interpretation', {});
        
        if (!job) {
            logger.log('warn', 'pgBoss.send returned null for stop-interpretation, falling back to direct stop');
            await stopRunningInterpretation();
            return res.send('interpretation stopped (direct)');
        }
        
        logger.log('info', `Queued stop interpretation job: ${job}`);
        return res.send('interpretation stop queued');
    } catch (error: any) {
        logger.log('error', `Failed to queue stop interpretation job: ${error.message}`);
        
        try {
            await stopRunningInterpretation();
            return res.send('interpretation stopped (fallback)');
        } catch (directError: any) {
            return res.status(500).send('interpretation stop failed');
        }
    }
});

export default router;