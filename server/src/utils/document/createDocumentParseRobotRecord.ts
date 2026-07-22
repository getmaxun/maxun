import { v4 as uuid } from 'uuid';
import Robot from '../../models/Robot';
import { DocumentInterpreter, ParsedOutput } from '../../workflow-management/classes/DocumentInterpreter';
import { uploadDocumentToMinio } from '../../storage/mino';
import logger from '../../logger';
import { OutputFormats } from '../../constants/output-formats';
import {
  DOCUMENT_MIME_TO_EXT,
  DocumentMimeType,
} from '../../constants/document-types';

export interface CreateDocumentParseRobotParams {
  pdfBuffer: Buffer;
  originalFileName: string;
  robotName: string;
  outputFormats: OutputFormats[];
  userId: number;
  mimeType: DocumentMimeType;
}

export interface CreateDocumentParseRobotResult {
  robot: any;
  parsedOutput: ParsedOutput;
}

export async function createDocumentParseRobotRecord(
  params: CreateDocumentParseRobotParams
): Promise<CreateDocumentParseRobotResult> {
  const {
    pdfBuffer,
    originalFileName,
    robotName,
    outputFormats,
    userId,
    mimeType,
  } = params;

  const parsedOutput = await DocumentInterpreter.parse(
    pdfBuffer,
    outputFormats,
    mimeType,
  );

  const robotId = uuid();
  const now = new Date().toISOString();
  const documentKey = `documents/${robotId}/document.${DOCUMENT_MIME_TO_EXT[mimeType]}`;

  await uploadDocumentToMinio(documentKey, pdfBuffer, mimeType);

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
