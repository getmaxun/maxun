import { v4 as uuid } from 'uuid';
import Robot from '../../models/Robot';
import { DocumentInterpreter, ParsedOutput } from '../../workflow-management/classes/DocumentInterpreter';
import { uploadDocumentToMinio } from '../../storage/mino';
import logger from '../../logger';
import { OutputFormats } from '../../constants/output-formats';

export interface CreateDocumentParseRobotParams {
  pdfBuffer: Buffer;
  originalFileName: string;
  robotName: string;
  outputFormats: OutputFormats[];
  userId: number;
}

export interface CreateDocumentParseRobotResult {
  robot: any;
  parsedOutput: ParsedOutput;
}

export async function createDocumentParseRobotRecord(
  params: CreateDocumentParseRobotParams
): Promise<CreateDocumentParseRobotResult> {
  const { pdfBuffer, originalFileName, robotName, outputFormats, userId } = params;

  const parsedOutput = await DocumentInterpreter.parse(pdfBuffer, outputFormats);

  const robotId = uuid();
  const now = new Date().toISOString();
  const documentKey = `documents/${robotId}/document.pdf`;

  await uploadDocumentToMinio(documentKey, pdfBuffer);

  const robot = await Robot.create({
    id: uuid(),
    userId,
    recording_meta: {
      name: robotName.trim(),
      id: robotId,
      createdAt: now,
      updatedAt: now,
      pairs: 0,
      params: [],
      type: 'doc-parse',
    },
    recording: {
      workflow: [],
      outputFormats,
      documentKey,
      documentFileName: originalFileName,
      parsedOutput,
    },
  } as any);

  logger.info(`[document-parse robot] Created robot ${robotId} for user ${userId}`);
  return { robot, parsedOutput };
}
