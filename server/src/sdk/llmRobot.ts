import { v4 as uuid } from 'uuid';
import { Op } from 'sequelize';
import Robot from '../models/Robot';
import sequelizeInstance from '../storage/db';
import logger from '../logger';
import { capture } from '../utils/analytics';
import { LLMConfig } from './browserAgent';
import { WorkflowEnricher } from './workflowEnricher';

export type LlmRobotErrorCode =
  | 'invalid_url'
  | 'workflow_generation_failed'
  | 'robot_name_conflict';

export class LlmRobotError extends Error {
  public constructor(
    public readonly code: LlmRobotErrorCode,
    message: string,
    public readonly details?: string[],
  ) {
    super(message);
    this.name = 'LlmRobotError';
  }
}

export interface CreateLlmRobotOptions {
  url: string;
  prompt: string;
  userId: number | string;
  robotName?: string;
  llmConfig: LLMConfig;
}

export interface CreatedLlmRobot {
  robot: Robot;
  workflow: any[];
  existing: boolean;
}

export interface ListWorkflowSummary {
  fields: string[];
  pagination: Record<string, unknown> | null;
  limit: number | null;
}

const normalizeUrl = (raw: string): string => {
  try {
    const url = new URL(raw);
    url.search = url.searchParams.toString();
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/$/, '')}${url.search}`;
  } catch {
    return raw.toLowerCase().trim();
  }
};

export const normalizeRobotUrl = (rawUrl: string): string => {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new LlmRobotError('invalid_url', 'Invalid URL format');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new LlmRobotError('invalid_url', 'Only http and https URLs are supported');
  }

  const hostname = url.hostname;
  const isPlausibleHost = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(hostname)
    || hostname === 'localhost'
    || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
    || /^\[[0-9a-f:]+\]$/i.test(hostname);
  if (!isPlausibleHost) {
    throw new LlmRobotError('invalid_url', 'URL hostname is not reachable');
  }

  url.search = url.searchParams.toString();
  return url.toString();
};

export const normalizeWorkflowUrls = (workflow: any[] = []): any[] =>
  workflow.map((pair: any) => ({
    ...pair,
    where: pair?.where
      ? {
          ...pair.where,
          ...(typeof pair.where.url === 'string' && pair.where.url !== 'about:blank'
            ? { url: normalizeRobotUrl(pair.where.url) }
            : {}),
        }
      : pair?.where,
    what: Array.isArray(pair?.what)
      ? pair.what.map((action: any) => {
          if (
            action.action === 'goto'
            && Array.isArray(action.args)
            && typeof action.args[0] === 'string'
            && action.args[0] !== 'about:blank'
          ) {
            return { ...action, args: [normalizeRobotUrl(action.args[0]), ...action.args.slice(1)] };
          }

          if (
            (action.action === 'scrape' || action.action === 'crawl')
            && Array.isArray(action.args)
            && action.args[0]
            && typeof action.args[0] === 'object'
            && typeof action.args[0].url === 'string'
            && action.args[0].url !== 'about:blank'
          ) {
            return {
              ...action,
              args: [{ ...action.args[0], url: normalizeRobotUrl(action.args[0].url) }, ...action.args.slice(1)],
            };
          }

          return action;
        })
      : pair?.what,
  }));

export const findExistingRobotByName = async (name: string, userId: number | string): Promise<Robot | null> => Robot.findOne({
  where: {
    userId,
    [Op.and]: sequelizeInstance.where(
      sequelizeInstance.fn('trim', sequelizeInstance.literal("recording_meta->>'name'")),
      name.trim(),
    ),
  } as any,
});

const getListAction = (workflow: any[]): any | null => workflow
  .flatMap(pair => pair?.what || [])
  .find(action => action?.action === 'scrapeList') || null;

export const summarizeListWorkflow = (workflow: any[]): ListWorkflowSummary => {
  const listAction = getListAction(workflow);
  const config = listAction?.args?.[0];
  const fields = config?.fields && typeof config.fields === 'object'
    ? Object.keys(config.fields)
    : [];
  const pagination = config?.pagination && typeof config.pagination === 'object'
    ? config.pagination as Record<string, unknown>
    : null;
  const limit = typeof config?.limit === 'number' ? config.limit : null;
  return { fields, pagination, limit };
};

export interface PersistNativeRobotOptions {
  url: string;
  userId: number | string;
  robotName?: string;
  description?: string;
  workflow: any[];
  isLLM?: boolean;
  prompt?: string;
}

/**
 * Persist a workflow using Maxun's normal native robot record shape.
 * Both the Goal-1 one-shot seam and the semantic Recorder Draft compiler use
 * this helper so persistence stays in one server-owned path.
 */
export async function persistNativeRobot(options: PersistNativeRobotOptions): Promise<CreatedLlmRobot> {
  const url = normalizeRobotUrl(options.url);
  const workflow = normalizeWorkflowUrls(options.workflow);
  const description = options.description?.trim() || undefined;
  const name = options.robotName?.trim() || 'Recorder Draft';
  const existingRobot = await findExistingRobotByName(name, options.userId);

  if (existingRobot) {
    const meta = existingRobot.recording_meta;
    const sameDescription = description === undefined || (meta as any).description === description;
    const sameUrl = normalizeUrl(meta.url || '') === normalizeUrl(url);
    if (sameDescription && sameUrl) {
      return {
        robot: existingRobot,
        workflow: existingRobot.recording?.workflow || [],
        existing: true,
      };
    }
    throw new LlmRobotError('robot_name_conflict', `A robot named "${name}" already exists with a different configuration`);
  }

  const metaId = uuid();
  const robot = await Robot.create({
    id: uuid(),
    userId: Number(options.userId),
    recording_meta: {
      name,
      id: metaId,
      ...(description ? { description } : {}),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pairs: workflow.length,
      params: [],
      type: 'extract',
      url,
      isLLM: options.isLLM ?? false,
      status: 'ready',
    },
    recording: { workflow },
  });

  logger.info(`[SDK] Persistent native robot created: ${metaId}`);
  capture(options.isLLM ? 'maxun-oss-llm-robot-created' : 'maxun-oss-recorder-draft-compiled', {
    robot_meta: robot.recording_meta,
    recording: robot.recording,
    ...(options.prompt ? { prompt: options.prompt } : {}),
  });

  return { robot, workflow, existing: false };
}

export async function createLlmRobot(options: CreateLlmRobotOptions): Promise<CreatedLlmRobot> {
  const url = normalizeRobotUrl(options.url);
  const prompt = options.prompt.trim();
  const name = options.robotName?.trim() || `LLM Extract: ${prompt.substring(0, 50)}`;

  const workflowResult = await WorkflowEnricher.generateWorkflowFromPrompt(
    url,
    prompt,
    String(options.userId),
    options.llmConfig,
  );
  if (!workflowResult.success || !workflowResult.workflow) {
    throw new LlmRobotError(
      'workflow_generation_failed',
      'Failed to generate workflow from prompt',
      workflowResult.errors,
    );
  }

  return persistNativeRobot({
    url,
    userId: options.userId,
    robotName: name,
    description: prompt,
    workflow: workflowResult.workflow,
    isLLM: true,
    prompt,
  });
}

export const getTrustedAgentLlmConfig = (): LLMConfig => ({
  provider: (process.env.MAXUN_AGENT_LLM_PROVIDER || 'openai') as LLMConfig['provider'],
  model: process.env.MAXUN_AGENT_LLM_MODEL,
  apiKey: process.env.MAXUN_AGENT_LLM_API_KEY || process.env.OPENCODE_API_KEY || process.env.OPENAI_API_KEY,
  baseUrl: process.env.MAXUN_AGENT_LLM_BASE_URL || process.env.OPENAI_BASE_URL,
});
