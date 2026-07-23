import { v4 as uuid } from 'uuid';
import Robot from '../../models/Robot';
import { DocumentInterpreter, LLMConfig } from '../../workflow-management/classes/DocumentInterpreter';
import { uploadDocumentToMinio } from '../../storage/mino';
import logger from '../../logger';
import { getDocumentExtensionForMimeType } from './documentFile';

export interface CreateDocumentRobotParams {
  documentBuffer: Buffer;
  originalFileName: string;
  documentMimeType: string;
  prompt: string;
  robotName?: string;
  llmProvider?: 'anthropic' | 'openai' | 'ollama';
  llmModel?: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  userId: number;
}

export interface CreateDocumentRobotResult {
  robot: any;
  extractionSchema: Record<string, any>;
}

export async function createDocumentRobotRecord(
  params: CreateDocumentRobotParams
): Promise<CreateDocumentRobotResult> {
  const {
    documentBuffer,
    originalFileName,
    documentMimeType,
    prompt,
    robotName,
    llmProvider,
    llmModel,
    llmApiKey,
    llmBaseUrl,
    userId,
  } = params;

  const llmConfig: LLMConfig = {
    provider: llmProvider || 'ollama',
    model: llmModel,
    apiKey: llmApiKey,
    baseUrl: llmBaseUrl,
  };

  const { text: sampleText } = await DocumentInterpreter.extractText(documentBuffer, documentMimeType);
  if (!sampleText) throw new Error('Could not extract text from document');

  const extractionSchema = await DocumentInterpreter.generateExtractionSchema(prompt, sampleText, llmConfig);

  const robotId = uuid();
  const now = new Date().toISOString();
  const finalName = robotName?.trim() || `Document: ${prompt.substring(0, 50)}`;
  const documentExtension = getDocumentExtensionForMimeType(documentMimeType);
  const documentKey = `documents/${robotId}/document${documentExtension}`;

  await uploadDocumentToMinio(documentKey, documentBuffer, documentMimeType);

  const robot = await Robot.create({
    id: uuid(),
    userId,
    recording_meta: {
      name: finalName,
      id: robotId,
      createdAt: now,
      updatedAt: now,
      pairs: 0,
      params: [],
      type: 'doc-extract',
    },
    recording: {
      workflow: [],
      prompt: prompt.trim(),
      extractionSchema,
      documentKey,
      documentMimeType,
      documentFileName: originalFileName,
      llmProvider: llmProvider || 'ollama',
      llmModel: llmModel || null,
      llmApiKey: llmApiKey || null,
      llmBaseUrl: llmBaseUrl || null,
    },
  } as any);

  logger.info(`[document robot] Created robot ${robotId} for user ${userId}`);
  return { robot, extractionSchema };
}
