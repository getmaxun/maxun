/* ============================================================
   RUNS API (OPTIMIZED - LAZY LOAD OUTPUT)
   ============================================================ */


/**
 * GET endpoint for getting an array of runs (LIGHTWEIGHT).
 * This excludes heavy fields like serializableOutput & binaryOutput.
 */
router.get('/runs', requireSignIn, async (req, res) => {
  try {
    const runs = await Run.findAll({
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
      order: [['startedAt', 'DESC']]
    });

    return res.status(200).json({
      statusCode: 200,
      messageCode: "success",
      runs: {
        totalCount: runs.length,
        items: runs
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


/**
 * GET endpoint for fetching HEAVY run output ON DEMAND.
 * Called only when user expands a run in UI.
 */
router.get('/runs/:runId/output', requireSignIn, async (req, res) => {
  try {
    const run = await Run.findOne({
      where: { runId: req.params.runId },
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


/**
 * GET endpoint for retrieving FULL run data (includes heavy fields).
 * Use only if absolutely necessary.
 */
router.get('/runs/run/:id', requireSignIn, async (req, res) => {
  try {
    const run = await Run.findOne({
      where: { runId: req.params.id },   // ✅ Corrected param
      raw: true
    });

    if (!run) {
      return res.status(404).json({
        statusCode: 404,
        messageCode: "not_found",
        message: "Run not found"
      });
    }

    return res.status(200).json(run);

  } catch (error) {
    logger.log('error', `Error reading run ${req.params.id}: ${error}`);
    return res.status(500).json({
      statusCode: 500,
      messageCode: "error",
      message: "Failed to retrieve run"
    });
  }
});


/**
 * DELETE endpoint for deleting a run from storage.
 */
router.delete('/runs/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await Run.destroy({
      where: { runId: req.params.id }
    });

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
