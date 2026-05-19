import Run from '../../models/Run';
import { DocumentInterpreter, LLMConfig } from '../../workflow-management/classes/DocumentInterpreter';
import { getDocumentFromMinio } from '../../storage/mino';
import { sendWebhook } from '../../routes/webhook';
import logger from '../../logger';

export async function executeDocumentRun(
  recording: any,
  run: Run,
  userId: string | number,
  serverIo: any
): Promise<void> {
  const robotMeta = recording.recording_meta;
  const robotRecording = recording.recording;
  const runId = run.runId;
  const finishedAt = new Date().toLocaleString();

  const llmConfig: LLMConfig = {
    provider: robotRecording.llmProvider || 'ollama',
    model: robotRecording.llmModel || undefined,
    apiKey: robotRecording.llmApiKey || undefined,
    baseUrl: robotRecording.llmBaseUrl || undefined,
  };

  try {
    const pdfBuffer = await getDocumentFromMinio(robotRecording.documentKey);

    const result = await DocumentInterpreter.extractData(
      pdfBuffer,
      robotRecording.prompt || '',
      robotRecording.extractionSchema || {},
      llmConfig
    );

    const serializableOutput = {
      scrapeDoc: {
        data: result.data,
        tabName: result.tabName,
        pageCount: result.pageCount,
        model: result.model,
        extractedAt: result.extractedAt,
      },
    };

    await run.update({
      status: 'success',
      finishedAt,
      serializableOutput: serializableOutput as any,
      log: `Extracted ${result.pageCount} page(s) — model: ${result.model}`,
    });

    logger.info(`[document-run] Run ${runId} completed — model: ${result.model}`);

    try {
      serverIo.of('/queued-run').to(`user-${userId}`).emit('run-completed', {
        runId,
        robotMetaId: robotMeta.id,
        robotName: robotMeta.name,
        status: 'success',
        finishedAt,
      });
    } catch (emitErr: any) {
      logger.warn(`[document-run] Socket emit failed for run ${runId}: ${emitErr.message}`);
    }

    try {
      await sendWebhook(robotMeta.id, 'run_completed', {
        robot_id: robotMeta.id,
        run_id: runId,
        robot_name: robotMeta.name,
        status: 'success',
        finished_at: finishedAt,
      });
    } catch (webhookErr: any) {
      logger.warn(`[document-run] Webhook failed for run ${runId}: ${webhookErr.message}`);
    }
  } catch (err: any) {
    logger.error(`[document-run] Extraction failed for run ${runId}: ${err.message}`);

    try {
      await run.update({
        status: 'failed',
        finishedAt,
        log: `Extraction failed: ${err.message}`,
      });
    } catch (updateErr: any) {
      logger.error(`[document-run] Failed to mark run ${runId} as failed: ${updateErr.message}`);
    }

    try {
      serverIo.of('/queued-run').to(`user-${userId}`).emit('run-completed', {
        runId,
        robotMetaId: robotMeta.id,
        robotName: robotMeta.name,
        status: 'failed',
        finishedAt,
      });
    } catch (emitErr: any) {
      logger.warn(`[document-run] Socket emit (failure) failed for run ${runId}: ${emitErr.message}`);
    }
  }
}
