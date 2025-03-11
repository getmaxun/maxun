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
import { pgBoss } from '../pgboss-worker';

export const router = Router();
chromium.use(stealthPlugin());

export interface AuthenticatedRequest extends Request {
    user?: any;
}

async function waitForJobCompletion(jobId: string, queueName: string, timeout = 15000): Promise<any> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const checkJobStatus = async () => {
        if (Date.now() - startTime > timeout) {
          return reject(new Error(`Timeout waiting for job ${jobId} to complete`));
        }
        
        try {
          const job = await pgBoss.getJobById(queueName, jobId);
          
          if (!job) {
            return reject(new Error(`Job ${jobId} not found`));
          }
          
          if (job.state === 'completed') {
            return resolve(job.output);
          }
          
          if (job.state === 'failed') {
            return reject(new Error(`Job ${jobId} failed.`));
          }
          
          setTimeout(checkJobStatus, 200);
        } catch (error) {
          reject(error);
        }
      };
      
      // Start checking
      checkJobStatus();
    });
}

/**
 * Logs information about remote browser recording session.
 */
router.all('/', requireSignIn, (req, res, next) => {
    logger.log('debug', `The record API was invoked: ${req.url}`)
    next() // pass control to the next handler
})


/**
 * GET endpoint for starting the remote browser recording session
 * Waits for job completion
 */
router.get('/start', requireSignIn, async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
        return res.status(401).send('User not authenticated');
    }
    
    try {
        await pgBoss.createQueue('initialize-browser-recording');
        
        const jobId = await pgBoss.send('initialize-browser-recording', {
            userId: req.user.id,
            timestamp: new Date().toISOString()
        });
        
        if (!jobId) {
            logger.log('warn', 'pgBoss.send returned null, falling back to direct initialization');
            const browserId = initializeRemoteBrowserForRecording(req.user.id);
            return res.send( browserId );
        }
        
        logger.log('info', `Queued browser initialization job: ${jobId}, waiting for completion...`);
        
        try {
            const result = await waitForJobCompletion(jobId, 'initialize-browser-recording', 15000);
            
            if (result && result.browserId) {
                logger.log('info', `Job completed with browserId: ${result.browserId}`);
                return res.send(result.browserId);
            } else {
                logger.log('warn', 'Job completed but returned unexpected result');
                return res.send(jobId);
            }
        } catch (waitError: any) {
            logger.log('warn', `Error waiting for job completion: ${waitError.message}`);
            return res.send(jobId);
        }
    } catch (error: any) {
        logger.log('error', `Failed to queue browser initialization job: ${error.message}`);
        
        try {
            const browserId = initializeRemoteBrowserForRecording(req.user.id);
            return res.send( browserId );
        } catch (directError: any) {
            logger.log('error', `Direct initialization also failed: ${directError.message}`);
            return res.status(500).send('Failed to start recording');
        }
    }
});

/**
 * POST endpoint for starting the remote browser recording session accepting browser launch options.
 * returns session's id
 */
router.post('/start', requireSignIn, (req: AuthenticatedRequest, res:Response) => {
    if (!req.user) {
        return res.status(401).send('User not authenticated');
    }
    const id = initializeRemoteBrowserForRecording(req.user.id);
    return res.send(id);
});

/**
 * GET endpoint for terminating the remote browser recording session.
 * returns whether the termination was successful
 */
router.get('/stop/:browserId', requireSignIn, async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
        return res.status(401).send('User not authenticated');
    }

    try {
        await pgBoss.createQueue('destroy-browser');
        
        const jobId = await pgBoss.send('destroy-browser', {
            browserId: req.params.browserId,
            timestamp: new Date().toISOString()
        });

        if (!jobId) {
            logger.log('warn', 'pgBoss.send returned null, falling back to direct destruction');
            const browserId = initializeRemoteBrowserForRecording(req.user.id);
            return res.send( browserId );
        }

        logger.log('info', `Queued browser destruction job: ${jobId}, waiting for completion...`);

        try {
            const result = await waitForJobCompletion(jobId, 'destroy-browser', 15000);
            
            if (result) {
                logger.log('info', `Browser destruction job completed with result: ${result.success}`);
                return res.send(result.success);
            } else {
                logger.log('warn', 'Job completed but returned unexpected result');
                return res.send(false);
            }
        } catch (waitError: any) {
            logger.log('warn', `Error waiting for job completion: ${waitError.message}`);
            return res.send(false);
        }
    } catch (error: any) {
        logger.log('error', `Failed to stop browser: ${error.message}`);
        return res.status(500).send(false);
    }
});

/**
 * GET endpoint for getting the id of the active remote browser.
 */
router.get('/active', requireSignIn, (req: AuthenticatedRequest, res) => {
    if (!req.user) {
        return res.status(401).send('User not authenticated');
    }
    const id = getActiveBrowserId(req.user?.id);
    return res.send(id);
});

/**
 * GET endpoint for getting the current url of the active remote browser.
 */
router.get('/active/url', requireSignIn, (req: AuthenticatedRequest, res) => {
    if (!req.user) {
        return res.status(401).send('User not authenticated');
    }
    const id = getActiveBrowserId(req.user?.id);
    if (id) {
        const url = getRemoteBrowserCurrentUrl(id, req.user?.id);
        return res.send(url);
    }
    return res.send(null);
});

/**
 * GET endpoint for getting the current tabs of the active remote browser.
 */
router.get('/active/tabs', requireSignIn, (req: AuthenticatedRequest, res) => {
    if (!req.user) {
        return res.status(401).send('User not authenticated');
    }
    const id = getActiveBrowserId(req.user?.id);
    if (id) {
        const hosts = getRemoteBrowserCurrentTabs(id, req.user?.id);
        return res.send(hosts);
    }
    return res.send([]);
});

/**
 * GET endpoint for starting an interpretation of the currently generated workflow.
 */
router.get('/interpret', requireSignIn, async (req: AuthenticatedRequest, res) => {
    try {
        if (!req.user) {
            return res.status(401).send('User not authenticated');
        }
        await interpretWholeWorkflow(req.user?.id);
        return res.send('interpretation done');
    } catch (e) {
        return res.send('interpretation failed');
    }
});

/**
 * GET endpoint for stopping an ongoing interpretation of the currently generated workflow.
 */
router.get('/interpret/stop', requireSignIn, async (req: AuthenticatedRequest, res) => {
    if (!req.user) {
        return res.status(401).send('User not authenticated');
    }
    await stopRunningInterpretation(req.user?.id);
    return res.send('interpretation stopped');
});

export default router;