import Run from '../../models/Run';
import { DocumentInterpreter } from '../../workflow-management/classes/DocumentInterpreter';
import { getDocumentFromMinio } from '../../storage/mino';
import { sendWebhook } from '../../routes/webhook';
import logger from '../../logger';
import { OutputFormats } from '../../constants/output-formats';

export async function executeDocumentParseRun(
  recording: any,
  run: Run,
  userId: string | number,
  serverIo: any
): Promise<void> {
  const robotMeta = recording.recording_meta;
  const robotRecording = recording.recording;
  const runId = run.runId;
  const finishedAt = new Date().toLocaleString();
  const outputFormats: OutputFormats[] = Array.isArray(robotRecording.outputFormats)
    ? robotRecording.outputFormats
    : [];

  try {
    const pdfBuffer = await getDocumentFromMinio(robotRecording.documentKey);
    const result = await DocumentInterpreter.parse(pdfBuffer, outputFormats);

    const serializableOutput: Record<string, any> = {};
    if (result.markdown !== undefined) serializableOutput.markdown = [{ content: result.markdown }];
    if (result.html !== undefined) serializableOutput.html = [{ content: result.html }];
    if (result.links !== undefined) serializableOutput.links = result.links;

    await run.update({
      status: 'success',
      finishedAt,
      serializableOutput: serializableOutput as any,
      log: `Parsed ${result.pageCount} page(s) successfully`,
    });

    logger.info(`[document-parse-run] Run ${runId} completed — ${result.pageCount} page(s)`);

    try {
      serverIo.of('/queued-run').to(`user-${userId}`).emit('run-completed', {
        runId,
        robotMetaId: robotMeta.id,
        robotName: robotMeta.name,
        status: 'success',
        finishedAt,
      });
    } catch (emitErr: any) {
      logger.warn(`[document-parse-run] Socket emit failed for run ${runId}: ${emitErr.message}`);
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
      logger.warn(`[document-parse-run] Webhook failed for run ${runId}: ${webhookErr.message}`);
    }
  } catch (err: any) {
    logger.error(`[document-parse-run] Parse failed for run ${runId}: ${err.message}`);

    try {
      await run.update({
        status: 'failed',
        finishedAt,
        log: `Parsing failed: ${err.message}`,
      });
    } catch (updateErr: any) {
      logger.error(`[document-parse-run] Failed to mark run ${runId} as failed: ${updateErr.message}`);
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
      logger.warn(`[document-parse-run] Socket emit (failure) failed for run ${runId}: ${emitErr.message}`);
    }
  }
}
