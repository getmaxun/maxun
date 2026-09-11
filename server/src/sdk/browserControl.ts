import type { Request } from 'express';
import type { ControlActor } from '../models/ControlLease';
import type { RemoteBrowser, RemoteBrowserControlCommand, RemoteBrowserControlResult, ControlCommandKind, ControlCommandMode } from '../browser-management/classes/RemoteBrowser';
import { ControlLeaseError } from './controlLease';
import {
  beginControlCommand,
  finishControlCommand,
  requireControlLease,
  type ControlLeaseResult,
  type ControlCommandInput,
} from './controlLease';
import { sanitizeBrowserUrl } from './urlPrivacy';

export interface BrowserControlExecution extends RemoteBrowserControlResult {
  readonly commandId: string;
  readonly controlEpoch: number;
  readonly observationEpoch: number;
  readonly observedAt: number;
}

const queues = new Map<string, Promise<unknown>>();
const CONTROL_COMMANDS: readonly ControlCommandKind[] = ['click', 'key', 'type', 'navigate', 'scroll', 'refresh', 'pause', 'resume', 'step', 'abort'];
const CONTROL_MODES: readonly ControlCommandMode[] = ['assist', 'record'];

export function normalizeControlCommand(body: any): RemoteBrowserControlCommand {
  const source = body?.command && typeof body.command === 'object' ? body.command : body;
  const kind = source?.kind;
  const mode = source?.mode ?? 'assist';
  if (!CONTROL_COMMANDS.includes(kind) || !CONTROL_MODES.includes(mode)) {
    throw new ControlLeaseError('invalid_control', 'Unsupported control command or mode');
  }
  const output: any = { kind, mode };
  if (source.coordinates !== undefined) {
    const x = Number(source.coordinates?.x);
    const y = Number(source.coordinates?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new ControlLeaseError('invalid_control', 'coordinates must be finite');
    output.coordinates = { x, y };
  }
  if (source.key !== undefined) output.key = String(source.key);
  if (source.text !== undefined) output.text = String(source.text);
  if (source.url !== undefined) output.url = String(source.url);
  if (source.selector !== undefined) output.selector = String(source.selector);
  return output;
}
const activeCommands = new Map<string, AbortController>();

const queueKey = (userId: number, browserSessionId: string): string => `${userId}:${browserSessionId}`;
const commandKey = (userId: number, browserSessionId: string, commandId: string): string => `${queueKey(userId, browserSessionId)}:${commandId}`;

/**
 * Serialize mutating commands per browser. A command is registered as
 * cancellable before lease admission and the lease is fenced again immediately
 * before dispatch, so handoff can abort an admitted command before Playwright.
 */
export async function executeBrowserControlCommand(
  userId: number,
  browser: RemoteBrowser,
  input: ControlCommandInput,
  command: RemoteBrowserControlCommand,
  signal: AbortSignal,
): Promise<BrowserControlExecution> {
  const key = queueKey(userId, input.browserSessionId);
  const previous = queues.get(key) ?? Promise.resolve();
  let run!: Promise<BrowserControlExecution>;
  run = previous.catch(() => undefined).then(async () => {
    if (signal.aborted) throw new Error('Control command cancelled before queue admission');
    const controller = new AbortController();
    const combinedController = new AbortController();
    const forwardAbort = () => combinedController.abort(signal.reason);
    const forwardInternalAbort = () => combinedController.abort(controller.signal.reason);
    const activeKey = commandKey(userId, input.browserSessionId, input.commandId);
    signal.addEventListener('abort', forwardAbort, { once: true });
    controller.signal.addEventListener('abort', forwardInternalAbort, { once: true });
    activeCommands.set(activeKey, controller);
    let admitted = false;
    try {
      await beginControlCommand(userId, input);
      admitted = true;
      // This is the dispatch fence. Handoff/release locks and advances the
      // lease epoch; no await occurs between this check and the browser call.
      await requireControlLease(userId, input);
      if (combinedController.signal.aborted) throw new Error('Control command cancelled before dispatch');
      const result = await browser.executeControlCommand(command, combinedController.signal);
      await finishControlCommand(userId, input.browserSessionId, input.commandId, 'completed');
      return {
        ...result,
        commandId: input.commandId,
        controlEpoch: input.controlEpoch,
        observationEpoch: input.controlEpoch,
        observedAt: Date.now(),
      };
    } catch (error) {
      // A cancellation after admission cannot know whether Playwright applied
      // the action before the abort reached the browser, so status is unknown.
      if (admitted) await finishControlCommand(userId, input.browserSessionId, input.commandId, 'unknown');
      throw error;
    } finally {
      signal.removeEventListener('abort', forwardAbort);
      controller.signal.removeEventListener('abort', forwardInternalAbort);
      activeCommands.delete(activeKey);
    }
  });
  queues.set(key, run);
  try {
    return await run;
  } finally {
    if (queues.get(key) === run) queues.delete(key);
  }
}

export function cancelBrowserControlCommand(userId: number, browserSessionId: string, commandId: string): boolean {
  const controller = activeCommands.get(commandKey(userId, browserSessionId, commandId));
  if (!controller) return false;
  controller.abort(new Error('control command cancelled'));
  return true;
}

export function cancelBrowserControlCommands(userId: number, browserSessionId: string): number {
  const prefix = `${queueKey(userId, browserSessionId)}:`;
  let cancelled = 0;
  for (const [key, controller] of activeCommands) {
    if (!key.startsWith(prefix)) continue;
    controller.abort(new Error('browser control ownership changed'));
    cancelled += 1;
  }
  return cancelled;
}

/** Compact observation returned after a control transition; no page payload. */
export function controlObservation(
  browserSessionId: string,
  lease: ControlLeaseResult,
  browserStatus: 'active' | 'gone',
  currentUrl: string | null,
): Record<string, string | number | boolean | null> {
  return {
    browserSessionId,
    browserStatus,
    currentUrl: sanitizeBrowserUrl(currentUrl),
    controlActor: lease.actor,
    controlEpoch: lease.controlEpoch,
    observedAt: Date.now(),
  };
}

/** Abort an in-flight command if its HTTP caller disappears. */
export function abortWhenRequestCloses(req: Request, controller: AbortController, responseEnded: () => boolean): () => void {
  const onAborted = () => controller.abort(new Error('control request cancelled'));
  const onClose = () => {
    if (!responseEnded()) controller.abort(new Error('control request disconnected'));
  };
  req.once('aborted', onAborted);
  req.once('close', onClose);
  return () => {
    req.off('aborted', onAborted);
    req.off('close', onClose);
  };
}

export async function requireActorControl(
  userId: number,
  input: { browserSessionId: string; ownerSessionId: string; actor: ControlActor; controlEpoch: number },
): Promise<ControlLeaseResult> {
  return requireControlLease(userId, input);
}
