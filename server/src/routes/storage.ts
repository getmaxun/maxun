/* ============================================================
   RUNS API (OPTIMIZED - LAZY LOAD OUTPUT - SECURE VERSION)
   ============================================================ */

import { Router } from 'express';
import { Run } from '../models/Run';
import { requireSignIn } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import logger from '../utils/logger';
import { capture } from '../utils/analytics';

const router = Router();

/* ============================================================
   GET /runs
   Lightweight list (EXCLUDES heavy output fields)
   ============================================================ */
router.get('/runs', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await Run.findAndCountAll({
      where: {
        runByUserId: req.user.id   // 🔐 Ownership enforcement
      },
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
      messageCode: "success",
      runs: {
        totalCount: count,
        page,
        pageSize: limit,
        items: rows
      }
    });

  } catch (error) {
    logger.log('error', `Error while reading runs: ${error}`);
    return res.status(500).json({
      statusCode: 500,
      messageCode: "error",
      message: "Failed to retrieve runs"
    });
  }
});


/* ============================================================
   GET /runs/:runId/output
   Lazy-load heavy output fields ONLY
   ============================================================ */
router.get('/runs/:runId/output', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const run = await Run.findOne({
      where: {
        runId: req.params.runId,
        runByUserId: req.user.id   // 🔐 Ownership enforcement
      },
      attributes: ['serializableOutput', 'binaryOutput'],
      raw: true
    });

    if (!run) {
      return res.status(404).json({
        statusCode: 404,
        messageCode: "not_found",
        message: "Run not found"
      });
    }

    return res.status(200).json({
      statusCode: 200,
      messageCode: "success",
      output: {
        serializableOutput: run.serializableOutput || {},
        binaryOutput: run.binaryOutput || {}
      }
    });

  } catch (error) {
    logger.log('error', `Error fetching run output: ${error}`);
    return res.status(500).json({
      statusCode: 500,
      messageCode: "error",
      message: "Failed to fetch run output"
    });
  }
});


/* ============================================================
   GET /runs/run/:id
   Full run data (includes heavy fields)
   Use only if absolutely necessary
   ============================================================ */
router.get('/runs/run/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const run = await Run.findOne({
      where: {
        runId: req.params.id,
        runByUserId: req.user.id   // 🔐 Ownership enforcement
      },
      raw: true
    });

    if (!run) {
      return res.status(404).json({
        statusCode: 404,
        messageCode: "not_found",
        message: "Run not found"
      });
    }

    return res.status(200).json({
      statusCode: 200,
      messageCode: "success",
      run
    });

  } catch (error) {
    logger.log('error', `Error reading run ${req.params.id}: ${error}`);
    return res.status(500).json({
      statusCode: 500,
      messageCode: "error",
      message: "Failed to retrieve run"
    });
  }
});


/* ============================================================
   DELETE /runs/:id
   Secure deletion with ownership verification
   ============================================================ */
router.delete('/runs/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const deletedCount = await Run.destroy({
      where: {
        runId: req.params.id,
        runByUserId: req.user.id   // 🔐 Ownership enforcement
      }
    });

    if (!deletedCount) {
      return res.status(404).json({
        success: false,
        message: "Run not found"
      });
    }

    capture(
      'maxun-oss-run-deleted',
      {
        runId: req.params.id,
        user_id: req.user.id,
        deleted_at: new Date().toISOString(),
      }
    );

    return res.status(200).json({
      success: true,
      message: "Run deleted successfully"
    });

  } catch (error) {
    logger.log('error', `Error deleting run ${req.params.id}: ${error}`);
    return res.status(500).json({
      success: false,
      message: "Failed to delete run"
    });
  }
});

export default router;
