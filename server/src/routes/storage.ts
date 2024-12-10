import { Router } from 'express';
import logger from "../logger";
import { createRemoteBrowserForRun, destroyRemoteBrowser } from "../browser-management/controller";
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { browserPool } from "../server";
import { uuid } from "uuidv4";
import moment from 'moment-timezone';
import cron from 'node-cron';
import { googleSheetUpdateTasks, processGoogleSheetUpdates } from '../workflow-management/integrations/gsheet';
import { getDecryptedProxyConfig } from './proxy';
import { requireSignIn } from '../middlewares/auth';
import Robot from '../models/Robot';
import Run from '../models/Run';
import { BinaryOutputService } from '../storage/mino';
import { workflowQueue } from '../worker';
import { AuthenticatedRequest } from './record';
import { computeNextRun } from '../utils/schedule';
import { capture } from "../utils/analytics";
import { tryCatch } from 'bullmq';
import { WorkflowFile } from 'maxun-core';
import { Page } from 'playwright';
chromium.use(stealthPlugin());

export const router = Router();

/**
 * Logs information about recordings API.
 */
router.all('/', requireSignIn, (req, res, next) => {
  logger.log('debug', `The recordings API was invoked: ${req.url}`)
  next() // pass control to the next handler
})

/**
 * GET endpoint for getting an array of all stored recordings.
 */
router.get('/recordings', requireSignIn, async (req, res) => {
  try {
    const data = await Robot.findAll();
    return res.send(data);
  } catch (e) {
    logger.log('info', 'Error while reading robots');
    return res.send(null);
  }
});

/**
 * GET endpoint for getting a recording.
 */
router.get('/recordings/:id', requireSignIn, async (req, res) => {
  try {
    const data = await Robot.findOne({
      where: { 'recording_meta.id': req.params.id },
      raw: true
    }
    );
    return res.send(data);
  } catch (e) {
    logger.log('info', 'Error while reading robots');
    return res.send(null);
  }
})

router.get(('/recordings/:id/runs'), requireSignIn, async (req, res) => {
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
})

function formatRunResponse(run: any) {
  const formattedRun = {
      id: run.id,
      status: run.status,
      name: run.name,
      robotId: run.robotMetaId, // Renaming robotMetaId to robotId
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      runId: run.runId,
      runByUserId: run.runByUserId,
      runByScheduleId: run.runByScheduleId,
      runByAPI: run.runByAPI,
      data: {},
      screenshot: null,
  };

  if (run.serializableOutput && run.serializableOutput['item-0']) {
      formattedRun.data = run.serializableOutput['item-0'];
  } else if (run.binaryOutput && run.binaryOutput['item-0']) {
      formattedRun.screenshot = run.binaryOutput['item-0']; 
  }

  return formattedRun;
}

/**
 * PUT endpoint to update the name and limit of a robot.
 */
router.put('/recordings/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { name, limit } = req.body;

    // Validate input
    if (!name && limit === undefined) {
      return res.status(400).json({ error: 'Either "name" or "limit" must be provided.' });
    }

    // Fetch the robot by ID
    const robot = await Robot.findOne({ where: { 'recording_meta.id': id } });

    if (!robot) {
      return res.status(404).json({ error: 'Robot not found.' });
    }

    // Update fields if provided
    if (name) {
      robot.set('recording_meta', { ...robot.recording_meta, name });
    }

    // Update the limit
    if (limit !== undefined) {
      const workflow = [...robot.recording.workflow]; // Create a copy of the workflow

      // Ensure the workflow structure is valid before updating
      if (
        workflow.length > 0 &&
        workflow[0]?.what?.[0]
      ) {
        // Create a new workflow object with the updated limit
        const updatedWorkflow = workflow.map((step, index) => {
          if (index === 0) { // Assuming you want to update the first step
            return {
              ...step,
              what: step.what.map((action, actionIndex) => {
                if (actionIndex === 0) { // Assuming the first action needs updating
                  return {
                    ...action,
                    args: (action.args ?? []).map((arg, argIndex) => {
                      if (argIndex === 0) { // Assuming the first argument needs updating
                        return { ...arg, limit };
                      }
                      return arg;
                    }),
                  };
                }
                return action;
              }),
            };
          }
          return step;
        });

        // Replace the workflow in the recording object
        robot.set('recording', { ...robot.recording, workflow: updatedWorkflow });
      } else {
        return res.status(400).json({ error: 'Invalid workflow structure for updating limit.' });
      }
    }

    await robot.save();

    const updatedRobot = await Robot.findOne({ where: { 'recording_meta.id': id } });

    logger.log('info', `Robot with ID ${id} was updated successfully.`);

    return res.status(200).json({ message: 'Robot updated successfully', robot });
  } catch (error) {
    // Safely handle the error type
    if (error instanceof Error) {
      logger.log('error', `Error updating robot with ID ${req.params.id}: ${error.message}`);
      return res.status(500).json({ error: error.message });
    } else {
      logger.log('error', `Unknown error updating robot with ID ${req.params.id}`);
      return res.status(500).json({ error: 'An unknown error occurred.' });
    }
  }
});


/**
 * POST endpoint to duplicate a robot and update its target URL.
 */
router.post('/recordings/:id/duplicate', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { targetUrl } = req.body;

    if (!targetUrl) {
      return res.status(400).json({ error: 'The "targetUrl" field is required.' });
    }

    const originalRobot = await Robot.findOne({ where: { 'recording_meta.id': id } });

    if (!originalRobot) {
      return res.status(404).json({ error: 'Original robot not found.' });
    }

    const lastWord = targetUrl.split('/').filter(Boolean).pop() || 'Unnamed';

    const workflow = originalRobot.recording.workflow.map((step) => {
      if (step.where?.url && step.where.url !== "about:blank") {
        step.where.url = targetUrl;
      }

      step.what.forEach((action) => {
        if (action.action === "goto" && action.args?.length) {
          action.args[0] = targetUrl; 
        }
      });

      return step;
    });

    const currentTimestamp = new Date().toISOString();

    const newRobot = await Robot.create({
      id: uuid(), 
      userId: originalRobot.userId, 
      recording_meta: {
        ...originalRobot.recording_meta,
        id: uuid(),
        name: `${originalRobot.recording_meta.name} (${lastWord})`,
        createdAt: currentTimestamp, 
        updatedAt: currentTimestamp, 
      }, 
      recording: { ...originalRobot.recording, workflow }, 
      google_sheet_email: null, 
      google_sheet_name: null,
      google_sheet_id: null,
      google_access_token: null,
      google_refresh_token: null,
      schedule: null, 
    });

    logger.log('info', `Robot with ID ${id} duplicated successfully as ${newRobot.id}.`);

    return res.status(201).json({
      message: 'Robot duplicated and target URL updated successfully.',
      robot: newRobot,
    });
  } catch (error) {
    if (error instanceof Error) {
      logger.log('error', `Error duplicating robot with ID ${req.params.id}: ${error.message}`);
      return res.status(500).json({ error: error.message });
    } else {
      logger.log('error', `Unknown error duplicating robot with ID ${req.params.id}`);
      return res.status(500).json({ error: 'An unknown error occurred.' });
    }
  }
});

/**
 * DELETE endpoint for deleting a recording from the storage.
 */
router.delete('/recordings/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return res.status(401).send({ error: 'Unauthorized' });
  }
  try {
    await Robot.destroy({
      where: { 'recording_meta.id': req.params.id }
    });
    capture(
      'maxun-oss-robot-deleted',
      {
        robotId: req.params.id,
        user_id: req.user?.id,
        deleted_at: new Date().toISOString(),
      }
    )
    return res.send(true);
  } catch (e) {
    const { message } = e as Error;
    logger.log('info', `Error while deleting a recording with name: ${req.params.fileName}.json`);
    return res.send(false);
  }
});

/**
 * GET endpoint for getting an array of runs from the storage.
 */
router.get('/runs', requireSignIn, async (req, res) => {
  try {
    const data = await Run.findAll();
    return res.send(data);
  } catch (e) {
    logger.log('info', 'Error while reading runs');
    return res.send(null);
  }
});

/**
 * DELETE endpoint for deleting a run from the storage.
 */
router.delete('/runs/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return res.status(401).send({ error: 'Unauthorized' });
  }
  try {
    await Run.destroy({ where: { runId: req.params.id } });
    capture(
      'maxun-oss-run-deleted',
      {
        runId: req.params.id,
        user_id: req.user?.id,
        deleted_at: new Date().toISOString(),
      }
    )
    return res.send(true);
  } catch (e) {
    const { message } = e as Error;
    logger.log('info', `Error while deleting a run with name: ${req.params.fileName}.json`);
    return res.send(false);
  }
});

/**
 * PUT endpoint for starting a remote browser instance and saving run metadata to the storage.
 * Making it ready for interpretation and returning a runId.
 */
router.put('/runs/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    const recording = await Robot.findOne({
      where: {
        'recording_meta.id': req.params.id
      },
      raw: true
    });

    if (!recording || !recording.recording_meta || !recording.recording_meta.id) {
      return res.status(404).send({ error: 'Recording not found' });
    }

    if (!req.user) {
      return res.status(401).send({ error: 'Unauthorized' });
    }

    const proxyConfig = await getDecryptedProxyConfig(req.user.id);
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

    console.log(`Proxy config for run: ${JSON.stringify(proxyOptions)}`)

    const id = createRemoteBrowserForRun(req.user.id);

    const runId = uuid();

    const run = await Run.create({
      status: 'running',
      name: recording.recording_meta.name,
      robotId: recording.id,
      robotMetaId: recording.recording_meta.id,
      startedAt: new Date().toLocaleString(),
      finishedAt: '',
      browserId: id,
      interpreterSettings: req.body,
      log: '',
      runId,
      runByUserId: req.user.id,
      serializableOutput: {},
      binaryOutput: {},
    });

    const plainRun = run.toJSON();

    return res.send({
      browserId: id,
      runId: plainRun.runId,
    });
  } catch (e) {
    const { message } = e as Error;
    logger.log('info', `Error while creating a run with robot id: ${req.params.id} - ${message}`);
    return res.send('');
  }
});

/**
 * GET endpoint for getting a run from the storage.
 */
router.get('/runs/run/:id', requireSignIn, async (req, res) => {
  try {
    const run = await Run.findOne({ where: { runId: req.params.runId }, raw: true });
    if (!run) {
      return res.status(404).send(null);
    }
    return res.send(run);
  } catch (e) {
    const { message } = e as Error;
    logger.log('error', `Error ${message} while reading a run with id: ${req.params.id}.json`);
    return res.send(null);
  }
});

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

/**
 * PUT endpoint for finishing a run and saving it to the storage.
 */
router.post('/runs/run/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) { return res.status(401).send({ error: 'Unauthorized' }); }

    const run = await Run.findOne({ where: { runId: req.params.id } });
    if (!run) {
      return res.status(404).send(false);
    }

    const plainRun = run.toJSON();

    const recording = await Robot.findOne({ where: { 'recording_meta.id': plainRun.robotMetaId }, raw: true });
    if (!recording) {
      return res.status(404).send(false);
    }

    // interpret the run in active browser
    const browser = browserPool.getRemoteBrowser(plainRun.browserId);
    let currentPage = browser?.getCurrentPage();
    if (browser && currentPage) {
      const workflow = AddGeneratedFlags(recording.recording);
      const interpretationInfo = await browser.interpreter.InterpretRecording(
        workflow, currentPage, (newPage: Page) => currentPage = newPage, plainRun.interpreterSettings);
      const binaryOutputService = new BinaryOutputService('maxun-run-screenshots');
      const uploadedBinaryOutput = await binaryOutputService.uploadAndStoreBinaryOutput(run, interpretationInfo.binaryOutput);
      await destroyRemoteBrowser(plainRun.browserId);
      await run.update({
        ...run,
        status: 'success',
        finishedAt: new Date().toLocaleString(),
        browserId: plainRun.browserId,
        log: interpretationInfo.log.join('\n'),
        serializableOutput: interpretationInfo.serializableOutput,
        binaryOutput: uploadedBinaryOutput,
      });

      let totalRowsExtracted = 0;
      let extractedScreenshotsCount = 0;
      let extractedItemsCount = 0;

      if (run.dataValues.binaryOutput && run.dataValues.binaryOutput["item-0"]) {
        extractedScreenshotsCount = 1;
      }

      if (run.dataValues.serializableOutput && run.dataValues.serializableOutput["item-0"]) {
        const itemsArray = run.dataValues.serializableOutput["item-0"];
        extractedItemsCount = itemsArray.length;

        totalRowsExtracted = itemsArray.reduce((total, item) => {
          return total + Object.keys(item).length;
        }, 0);
      }

      console.log(`Extracted Items Count: ${extractedItemsCount}`);
      console.log(`Extracted Screenshots Count: ${extractedScreenshotsCount}`);
      console.log(`Total Rows Extracted: ${totalRowsExtracted}`);

      capture(
        'maxun-oss-run-created-manual',
        {
          runId: req.params.id,
          user_id: req.user?.id,
          created_at: new Date().toISOString(),
          status: 'success',
          totalRowsExtracted,
          extractedItemsCount,
          extractedScreenshotsCount,
        }
      )
      try {
        googleSheetUpdateTasks[plainRun.runId] = {
          robotId: plainRun.robotMetaId,
          runId: plainRun.runId,
          status: 'pending',
          retries: 5,
        };
        processGoogleSheetUpdates();
      } catch (err: any) {
        logger.log('error', `Failed to update Google Sheet for run: ${plainRun.runId}: ${err.message}`);
      }
      return res.send(true);
    } else {
      throw new Error('Could not destroy browser');
    }
  } catch (e) {
    const { message } = e as Error;
    // If error occurs, set run status to failed
    const run = await Run.findOne({ where: { runId: req.params.id } });
    if (run) {
      await run.update({
        status: 'failed',
        finishedAt: new Date().toLocaleString(),
      });
    }
    logger.log('info', `Error while running a robot with id: ${req.params.id} - ${message}`);
    capture(
      'maxun-oss-run-created-manual',
      {
        runId: req.params.id,
        user_id: req.user?.id,
        created_at: new Date().toISOString(),
        status: 'failed',
        error_message: message,
      }
    );
    return res.send(false);
  }
});

router.put('/schedule/:id/', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { runEvery, runEveryUnit, startFrom, dayOfMonth, atTimeStart, atTimeEnd, timezone } = req.body;

    const robot = await Robot.findOne({ where: { 'recording_meta.id': id } });
    if (!robot) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    // Validate required parameters
    if (!runEvery || !runEveryUnit || !startFrom || !atTimeStart || !atTimeEnd || !timezone) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Validate time zone
    if (!moment.tz.zone(timezone)) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }

    // Validate and parse start and end times
    const [startHours, startMinutes] = atTimeStart.split(':').map(Number);
    const [endHours, endMinutes] = atTimeEnd.split(':').map(Number);

    if (isNaN(startHours) || isNaN(startMinutes) || isNaN(endHours) || isNaN(endMinutes) ||
      startHours < 0 || startHours > 23 || startMinutes < 0 || startMinutes > 59 ||
      endHours < 0 || endHours > 23 || endMinutes < 0 || endMinutes > 59) {
      return res.status(400).json({ error: 'Invalid time format' });
    }

    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    if (!days.includes(startFrom)) {
      return res.status(400).json({ error: 'Invalid start day' });
    }

    // Build cron expression based on run frequency and starting day
    let cronExpression;
    const dayIndex = days.indexOf(startFrom);

    switch (runEveryUnit) {
      case 'MINUTES':
        cronExpression = `${startMinutes} */${runEvery} * * *`;
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
        // todo: handle leap year
        cronExpression = `0 ${atTimeStart} ${dayOfMonth} * *`;
        if (startFrom !== 'SUNDAY') {
          cronExpression += ` ${dayIndex}`;
        }
        break;
      default:
        return res.status(400).json({ error: 'Invalid runEveryUnit' });
    }

    // Validate cron expression
    if (!cronExpression || !cron.validate(cronExpression)) {
      return res.status(400).json({ error: 'Invalid cron expression generated' });
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Create the job in the queue with the cron expression
    const job = await workflowQueue.add(
      'run workflow',
      { id, runId: uuid(), userId: req.user.id },
      {
        repeat: {
          pattern: cronExpression,
          tz: timezone,
        },
      }
    );

    const nextRunAt = computeNextRun(cronExpression, timezone);

    await robot.update({
      schedule: {
        runEvery,
        runEveryUnit,
        startFrom,
        dayOfMonth,
        atTimeStart,
        atTimeEnd,
        timezone,
        cronExpression,
        lastRunAt: undefined,
        nextRunAt: nextRunAt || undefined,
      },
    });

    capture(
      'maxun-oss-robot-scheduled',
      {
        robotId: id,
        user_id: req.user.id,
        scheduled_at: new Date().toISOString(),
      }
    )

    // Fetch updated schedule details after setting it
    const updatedRobot = await Robot.findOne({ where: { 'recording_meta.id': id } });

    res.status(200).json({
      message: 'success',
      robot: updatedRobot,
    });
  } catch (error) {
    console.error('Error scheduling workflow:', error);
    res.status(500).json({ error: 'Failed to schedule workflow' });
  }
});


// Endpoint to get schedule details
router.get('/schedule/:id', requireSignIn, async (req, res) => {
  try {
    const robot = await Robot.findOne({ where: { 'recording_meta.id': req.params.id }, raw: true });

    if (!robot) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    return res.status(200).json({
      schedule: robot.schedule
    });

  } catch (error) {
    console.error('Error getting schedule:', error);
    res.status(500).json({ error: 'Failed to get schedule' });
  }
});

// Endpoint to delete schedule
router.delete('/schedule/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const robot = await Robot.findOne({ where: { 'recording_meta.id': id } });
    if (!robot) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    // Remove existing job from queue if it exists
    const existingJobs = await workflowQueue.getJobs(['delayed', 'waiting']);
    for (const job of existingJobs) {
      if (job.data.id === id) {
        await job.remove();
      }
    }

    // Delete the schedule from the robot
    await robot.update({
      schedule: null
    });

    capture(
      'maxun-oss-robot-schedule-deleted',
      {
        robotId: id,
        user_id: req.user?.id,
        unscheduled_at: new Date().toISOString(),
      }
    )

    res.status(200).json({ message: 'Schedule deleted successfully' });

  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

/**
 * POST endpoint for aborting a current interpretation of the run.
 */
router.post('/runs/abort/:id', requireSignIn, async (req, res) => {
  try {
    const run = await Run.findOne({ where: { runId: req.params.id } });
    if (!run) {
      return res.status(404).send(false);
    }
    const plainRun = run.toJSON();

    const browser = browserPool.getRemoteBrowser(plainRun.browserId);
    const currentLog = browser?.interpreter.debugMessages.join('/n');
    const serializableOutput = browser?.interpreter.serializableData.reduce((reducedObject, item, index) => {
      return {
        [`item-${index}`]: item,
        ...reducedObject,
      }
    }, {});
    const binaryOutput = browser?.interpreter.binaryData.reduce((reducedObject, item, index) => {
      return {
        [`item-${index}`]: item,
        ...reducedObject,
      }
    }, {});
    await run.update({
      ...run,
      status: 'aborted',
      finishedAt: new Date().toLocaleString(),
      browserId: plainRun.browserId,
      log: currentLog,
      serializableOutput,
      binaryOutput,
    });
    return res.send(true);
  } catch (e) {
    const { message } = e as Error;
    logger.log('info', `Error while running a robot with name: ${req.params.fileName}_${req.params.runId}.json`);
    return res.send(false);
  }
});