// Import core dependencies
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Page } from "playwright";

// Import local utilities and services
import { destroyRemoteBrowser } from '../browser-management/controller';
import logger from '../logger';
import { browserPool } from "../server";
import { googleSheetUpdateTasks, processGoogleSheetUpdates } from "./integrations/gsheet";
import { BinaryOutputService } from "../storage/mino";
import { capture } from "../utils/analytics";

// Import models and types
import Robot from "../models/Robot";
import Run from "../models/Run";
import { WorkflowFile } from "maxun-core";
import { io, Socket } from 'socket.io-client';

// Enable stealth mode for chromium
chromium.use(stealthPlugin());

async function readyForRunHandler(browserId: string, id: string) {
    try {
        const result = await executeRun(id);

        const socket = io(`${process.env.BACKEND_URL ? process.env.BACKEND_URL : 'http://localhost:8080'}/${browserId}`, {
            transports: ['websocket'],
            rejectUnauthorized: false
        });

        if (result && result.success) {
            logger.info(`Interpretation of ${id} succeeded`);
            socket.emit('run-completed', 'success');
            resetRecordingState(browserId, id);
            return result.interpretationInfo;
        } else {
            logger.error(`Interpretation of ${id} failed`);
            socket.emit('run-completed', 'failed');
            await destroyRemoteBrowser(browserId);
            resetRecordingState(browserId, id);
            return null;
        }

    } catch (error: any) {
        logger.error(`Error during readyForRunHandler: ${error.message}`);
        await destroyRemoteBrowser(browserId);
        return null;
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
}

async function executeRun(id: string) {
    try {
        const run = await Run.findOne({ where: { runId: id } });
        if (!run) {
            return {
                success: false,
                error: 'Run not found'
            };
        }

        const plainRun = run.toJSON();

        const recording = await Robot.findOne({
            where: { 'recording_meta.id': plainRun.robotMetaId },
            raw: true
        });
        if (!recording) {
            return {
                success: false,
                error: 'Recording not found'
            };
        }

        const browser = browserPool.getRemoteBrowser(plainRun.browserId);
        if (!browser) {
            throw new Error('Could not access browser');
        }

        let currentPage = await browser.getCurrentPage();
        if (!currentPage) {
            throw new Error('Could not create a new page');
        }

        const workflow = AddGeneratedFlags(recording.recording);
        const interpretationInfo = await browser.interpreter.InterpretRecording(
            workflow,
            currentPage,
            (newPage: Page) => currentPage = newPage,
            plainRun.interpreterSettings
        );

        const binaryOutputService = new BinaryOutputService('maxun-run-screenshots');
        const uploadedBinaryOutput = await binaryOutputService.uploadAndStoreBinaryOutput(
            run,
            interpretationInfo.binaryOutput
        );

        await destroyRemoteBrowser(plainRun.browserId);

        const updatedRun = await run.update({
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

        if (updatedRun.dataValues.binaryOutput && updatedRun.dataValues.binaryOutput["item-0"]) {
            extractedScreenshotsCount = 1;
        }

        if (updatedRun.dataValues.serializableOutput && updatedRun.dataValues.serializableOutput["item-0"]) {
            const itemsArray = updatedRun.dataValues.serializableOutput["item-0"];
            extractedItemsCount = itemsArray.length;
            totalRowsExtracted = itemsArray.reduce((total: number, item: any) => {
                return total + Object.keys(item).length;
            }, 0);
        }

        logger.info(`Extracted Items Count: ${extractedItemsCount}`);
        logger.info(`Extracted Screenshots Count: ${extractedScreenshotsCount}`);
        logger.info(`Total Rows Extracted: ${totalRowsExtracted}`);

        capture('maxun-oss-run-created-manual', {
            runId: id,
            created_at: new Date().toISOString(),
            status: 'success',
            extractedItemsCount,
            totalRowsExtracted,
            extractedScreenshotsCount,
        });

        // Handle Google Sheets integration
        try {
            googleSheetUpdateTasks[plainRun.runId] = {
                robotId: plainRun.robotMetaId,
                runId: plainRun.runId,
                status: 'pending',
                retries: 5,
            };
            await processGoogleSheetUpdates();
        } catch (err: any) {
            logger.error(`Failed to update Google Sheet for run: ${plainRun.runId}: ${err.message}`);
        }

        return {
            success: true,
            interpretationInfo: updatedRun.toJSON()
        };

    } catch (error: any) {
        logger.error(`Error running robot: ${error.message}`);
        const run = await Run.findOne({ where: { runId: id } });
        if (run) {
            await run.update({
                status: 'failed',
                finishedAt: new Date().toLocaleString(),
            });
        }

        capture('maxun-oss-run-created-manual', {
            runId: id,
            created_at: new Date().toISOString(),
            status: 'failed',
            error_message: error.message,
        });

        return {
            success: false,
            error: error.message,
        };
    }
}

/**
 * Main function to handle running a recording through the worker process
 */
export async function handleRunRecording(id: string, userId: string, runId: string) {
    try {
        if (!id || !runId || !userId) {
            throw new Error('browserId or runId or userId is undefined');
        }

        const socket = io(`${process.env.BACKEND_URL ? process.env.BACKEND_URL : 'http://localhost:8080'}/${id}`, {
            transports: ['websocket'],
            rejectUnauthorized: false
        });

        socket.on('ready-for-run', () => readyForRunHandler(id, runId));

        logger.info(`Running Robot: ${id}`);

        socket.on('disconnect', () => {
            cleanupSocketListeners(socket, id, runId);
        });

    } catch (error: any) {
        logger.error('Error running robot:', error);
        throw error;
    }
}

function cleanupSocketListeners(socket: Socket, browserId: string, id: string) {
    socket.off('ready-for-run', () => readyForRunHandler(browserId, id));
    logger.info(`Cleaned up listeners for browserId: ${browserId}, runId: ${id}`);
}
