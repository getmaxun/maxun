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
    getRemoteBrowserCurrentUrl, getRemoteBrowserCurrentTabs,
} from '../browser-management/controller'
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import logger from "../logger";
import { getDecryptedProxyConfig } from './proxy';
import { requireSignIn } from '../middlewares/auth';

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
 * returns session's id
 */
router.get('/start', requireSignIn, async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
        return res.status(401).send('User not authenticated');
    }
    const proxyConfig = await getDecryptedProxyConfig(req.user.id);
    // Prepare the proxy options dynamically based on the user's proxy configuration
    let proxyOptions: any = {}; // Default to no proxy

    if (proxyConfig.proxy_url) {
        // Set the server, and if username & password exist, set those as well
        proxyOptions = {
            server: proxyConfig.proxy_url,
            ...(proxyConfig.proxy_username && proxyConfig.proxy_password && {
                username: proxyConfig.proxy_username,
                password: proxyConfig.proxy_password,
            }),
        };
    }

    const id = initializeRemoteBrowserForRecording(req.user.id);
    return res.send(id);
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
router.get('/stop/:browserId', requireSignIn, async (req, res) => {
    const success = await destroyRemoteBrowser(req.params.browserId);
    return res.send(success);
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
        await interpretWholeWorkflow();
        return res.send('interpretation done');
    } catch (e) {
        return res.send('interpretation failed');
    }
});

/**
 * GET endpoint for stopping an ongoing interpretation of the currently generated workflow.
 */
router.get('/interpret/stop', requireSignIn, async (req, res) => {
    await stopRunningInterpretation();
    return res.send('interpretation stopped');
});
