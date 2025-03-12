/**
 * RESTful API endpoints handling currently generated workflow management.
 */

import { Router } from 'express';
import logger from "../logger";
import { browserPool } from "../server";
import { requireSignIn } from '../middlewares/auth';
import Robot from '../models/Robot';
import { AuthenticatedRequest } from './record';

export const router = Router();

/**
 * Logs information about workflow API.
 */
router.all('/', requireSignIn, (req, res, next) => {
  logger.log('debug', `The workflow API was invoked: ${req.url}`)
  next() // pass control to the next handler
})

/**
 * GET endpoint for a recording linked to a remote browser instance.
 * returns session's id
 */
router.get('/:browserId', requireSignIn, (req, res) => {
  const activeBrowser = browserPool.getRemoteBrowser(req.params.browserId);
  let workflowFile = null;
  if (activeBrowser && activeBrowser.generator) {
    workflowFile = activeBrowser.generator.getWorkflowFile();
  }
  return res.send(workflowFile);
});

/**
 * Get endpoint returning the parameter array of the recording associated with the browserId browser instance.
 */
router.get('/params/:browserId', requireSignIn, (req, res) => {
  const activeBrowser = browserPool.getRemoteBrowser(req.params.browserId);
  let params = null;
  if (activeBrowser && activeBrowser.generator) {
    params = activeBrowser.generator.getParams();
  }
  return res.send(params);
});

/**
 * DELETE endpoint for deleting a pair from the generated workflow.
 */
router.delete('/pair/:index', requireSignIn, (req: AuthenticatedRequest, res) => {
  if (!req.user) { return res.status(401).send('User not authenticated'); }
  const id = browserPool.getActiveBrowserId(req.user?.id, "recording");
  if (id) {
    const browser = browserPool.getRemoteBrowser(id);
    if (browser) {
      browser.generator?.removePairFromWorkflow(parseInt(req.params.index));
      const workflowFile = browser.generator?.getWorkflowFile();
      return res.send(workflowFile);
    }
  }
  return res.send(null);
});

/**
 * POST endpoint for adding a pair to the generated workflow.
 */
router.post('/pair/:index', requireSignIn, (req: AuthenticatedRequest, res) => {
  if (!req.user) { return res.status(401).send('User not authenticated'); }
  const id = browserPool.getActiveBrowserId(req.user?.id, "recording");
  if (id) {
    const browser = browserPool.getRemoteBrowser(id);
    logger.log('debug', `Adding pair to workflow`);
    if (browser) {
      logger.log('debug', `Adding pair to workflow: ${JSON.stringify(req.body)}`);
      if (req.body.pair) {
        browser.generator?.addPairToWorkflow(parseInt(req.params.index), req.body.pair);
        const workflowFile = browser.generator?.getWorkflowFile();
        return res.send(workflowFile);
      }
    }
  }
  return res.send(null);
});

/**
 * PUT endpoint for updating a pair in the generated workflow.
 */
router.put('/pair/:index', requireSignIn, (req: AuthenticatedRequest, res) => {
  if (!req.user) { return res.status(401).send('User not authenticated'); }
  const id = browserPool.getActiveBrowserId(req.user?.id, "recording");
  if (id) {
    const browser = browserPool.getRemoteBrowser(id);
    logger.log('debug', `Updating pair in workflow`);
    if (browser) {
      logger.log('debug', `New value: ${JSON.stringify(req.body)}`);
      if (req.body.pair) {
        browser.generator?.updatePairInWorkflow(parseInt(req.params.index), req.body.pair);
        const workflowFile = browser.generator?.getWorkflowFile();
        return res.send(workflowFile);
      }
    }
  }
  return res.send(null);
});

/**
 * PUT endpoint for updating the currently generated workflow file from the one in the storage.
 */
router.put('/:browserId/:id', requireSignIn, async (req, res) => {
  try {
    const browser = browserPool.getRemoteBrowser(req.params.browserId);
    logger.log('debug', `Updating workflow for Robot: ${req.params.id}`);

    if (browser && browser.generator) {
      const robot = await Robot.findOne({
        where: {
          'recording_meta.id': req.params.id
        },
        raw: true
      });

      if (!robot) {
        logger.log('info', `Robot not found with ID: ${req.params.id}`);
        return res.status(404).send({ error: 'Robot not found' });
      }

      const { recording, recording_meta } = robot;

      if (recording && recording.workflow) {
        browser.generator.updateWorkflowFile(recording, recording_meta);
        const workflowFile = browser.generator.getWorkflowFile();
        return res.send(workflowFile);
      } else {
        logger.log('info', `Invalid recording data for Robot ID: ${req.params.id}`);
        return res.status(400).send({ error: 'Invalid recording data' });
      }
    }

    logger.log('info', `Browser or generator not available for ID: ${req.params.id}`);
    return res.status(400).send({ error: 'Browser or generator not available' });
  } catch (e) {
    const { message } = e as Error;
    logger.log('error', `Error while updating workflow for Robot ID: ${req.params.id}. Error: ${message}`);
    return res.status(500).send({ error: 'Internal server error' });
  }
});

export default router;