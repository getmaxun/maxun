/* ============================================================
   RUNS API (OPTIMIZED - LAZY LOAD OUTPUT - SECURE VERSION)
   ============================================================ */

import { Router } from 'express';
import { Run } from '../models/Run.js';
import { requireSignIn } from '../middleware/auth.js';
import { AuthenticatedRequest } from '../types/index.js';
import logger from '../utils/logger.js';
import { capture } from '../utils/analytics.js';
import { Op } from 'sequelize';

const router = Router();

/* ============================================================
   GET /runs
   Lightweight list (EXCLUDES heavy output fields)
   ============================================================ */
router.get('/runs', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const pageParam = parseInt(String(req.query.page ?? ''), 10);
    const limitParam = parseInt(String(req.query.limit ?? ''), 10);

    const page =
       Number.isFinite(pageParam) && pageParam > 0
         ? pageParam
         : 1;

    const limit =
      Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, 100)
      : 20;

    const offset = (page - 1) * limit;

    const { count, rows } = await Run.findAndCountAll({
      where: { runByUserId: req.user.id },
      attributes: [
        'id',
        'status',
        'name',
        'robotMetaId',
        'startedAt',
        'finishedAt',
        'runId',
        'runByUserId',
        'runByScheduleId',
        'runByAPI'
      ],
      order: [['startedAt', 'DESC']],
      limit,
      offset
    });

    return res.status(200).json({
      statusCode: 200,
      messageCode: 'success',
      runs: {
        totalCount: count,
        page,
        pageSize: limit,
        items: rows
      }
    });

  } catch (error) {
    logger.error('Error fetching runs', error instanceof Error ? error.message : error);
    return res.status(500).json({
      statusCode: 500,
      messageCode: 'error',
      message: 'Failed to retrieve runs'
    });
  }
});


/* ============================================================
   GET /runs/:runId/output
   Lazy-load heavy output fields
   ============================================================ */
router.get('/runs/:runId/output', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const run = await Run.findOne({
      where: {
        runId: req.params.runId,
        runByUserId: req.user.id
      },
      attributes: ['serializableOutput', 'binaryOutput'],
      raw: true
    }) as { serializableOutput?: any; binaryOutput?: any };

    if (!run) {
      return res.status(404).json({
        statusCode: 404,
        messageCode: 'not_found',
        message: 'Run not found'
      });
    }

    return res.status(200).json({
      statusCode: 200,
      messageCode: 'success',
      output: {
        serializableOutput: run.serializableOutput ?? {},
        binaryOutput: run.binaryOutput ?? {}
      }
    });

  } catch (error) {
    logger.error('Error fetching run output', error instanceof Error ? error.message : error);
    return res.status(500).json({
      statusCode: 500,
      messageCode: 'error',
      message: 'Failed to fetch run output'
    });
  }
});


/* ============================================================
   GET /runs/run/:id
   Full run data
   ============================================================ */
router.get('/runs/run/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const run = await Run.findOne({
      where: {
        runId: req.params.id,
        runByUserId: req.user.id
      },
      raw: true
    });

    if (!run) {
      return res.status(404).json({
        statusCode: 404,
        messageCode: 'not_found',
        message: 'Run not found'
      });
    }

    return res.status(200).json({
      statusCode: 200,
      messageCode: 'success',
      run
    });

  } catch (error) {
    logger.error(`Error retrieving run ${req.params.id}`, error instanceof Error ? error.message : error);
    return res.status(500).json({
      statusCode: 500,
      messageCode: 'error',
      message: 'Failed to retrieve run'
    });
  }
});


/* ============================================================
   DELETE /runs/:id
   Secure deletion with ownership verification
   ============================================================ */
router.delete('/runs/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const deletedCount = await Run.destroy({
      where: {
        runId: req.params.id,
        runByUserId: req.user.id
      }
    });

    if (!deletedCount) {
      return res.status(404).json({
        success: false,
        message: 'Run not found'
      });
    }

    capture('maxun-oss-run-deleted', {
      runId: req.params.id,
      user_id: req.user.id,
      deleted_at: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      message: 'Run deleted successfully'
    });

  } catch (error) {
    logger.error(`Error deleting run ${req.params.id}`, error instanceof Error ? error.message : error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete run'
    });
  }
});

/* ============================================================
   Background worker helpers
   ============================================================ */

export async function processQueuedRuns(): Promise<void> {
  try {
    logger.info("Checking for queued runs...");

    const queuedRuns = await Run.findAll({
      where: { status: "queued" },
      attributes: ["runId"],
      raw: true
    });

    if (!queuedRuns.length) {
      logger.info("No queued runs found");
      return;
    }

    logger.info(`Found ${queuedRuns.length} queued runs`);

    for (const run of queuedRuns) {
      logger.info(`Queued run waiting for processing: ${run.runId}`);
    }

  } catch (error) {
    logger.error("processQueuedRuns failed", error);
  }
}


export async function recoverOrphanedRuns(): Promise<void> {
  try {
    logger.info("Checking for orphaned runs...");

    const timeoutMinutes = 30;
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);

    const orphanedRuns = await Run.findAll({
      where: {
        status: "running",
        startedAt: { [Op.lt]: cutoff }
      },
      attributes: ["runId"],
      raw: true
    });

    if (!orphanedRuns.length) {
      logger.info("No orphaned runs detected");
      return;
    }

    logger.warn(`Recovering ${orphanedRuns.length} orphaned runs`);

    const runIds = orphanedRuns.map((r: any) => r.runId);

    await Run.update(
       { status: "failed" },
       { where: { runId: { [Op.in]: runIds } } }
    );

    logger.warn(`Marked ${runIds.length} orphaned runs as failed`);

  } catch (error) {
    logger.error("recoverOrphanedRuns failed", error);
  }
}

export default router;
