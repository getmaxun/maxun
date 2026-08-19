import { UniqueConstraintError } from 'sequelize';
import { v4 as uuid } from 'uuid';
import sequelize from '../storage/db';
import ControlCommand, { type ControlCommandMode, type ControlCommandStatus } from '../models/ControlCommand';
import ControlLease, { type ControlActor } from '../models/ControlLease';
import { requireResourceClaim } from './resourceClaims';

export type { ControlActor } from '../models/ControlLease';

export type ControlErrorCode =
  | 'control_conflict'
  | 'control_not_found'
  | 'control_expired'
  | 'stale_control'
  | 'command_replay'
  | 'observation_required'
  | 'invalid_control';

export class ControlLeaseError extends Error {
  public constructor(
    public readonly code: ControlErrorCode,
    message: string,
    public readonly details?: { controlEpoch?: number; actor?: ControlActor; commandId?: string },
  ) {
    super(message);
    this.name = 'ControlLeaseError';
  }
}

export interface ControlLeaseResult {
  readonly browserSessionId: string;
  readonly ownerSessionId: string;
  readonly actor: ControlActor;
  readonly controlEpoch: number;
  readonly active: boolean;
  readonly expiresAt: string;
  readonly heartbeatAt: string;
  readonly existing: boolean;
  readonly observationEpoch: number;
  readonly observationReady: boolean;
}

export interface ControlCommandInput {
  readonly browserSessionId: string;
  readonly ownerSessionId: string;
  readonly actor: ControlActor;
  readonly controlEpoch: number;
  readonly commandId: string;
  readonly commandType: string;
  readonly mode: ControlCommandMode;
}

const CONTROL_LEASE_TTL_MS = 10 * 60 * 1000;

const validActor = (value: unknown): value is ControlActor => value === 'agent' || value === 'human';
const validMode = (value: unknown): value is ControlCommandMode => value === 'assist' || value === 'record';

function normalizeLeaseInput(input: {
  browserSessionId: unknown;
  ownerSessionId: unknown;
  actor: unknown;
}): { browserSessionId: string; ownerSessionId: string; actor: ControlActor } {
  const browserSessionId = typeof input.browserSessionId === 'string' ? input.browserSessionId.trim() : '';
  const ownerSessionId = typeof input.ownerSessionId === 'string' ? input.ownerSessionId.trim() : '';
  if (!browserSessionId || !ownerSessionId || !validActor(input.actor)) {
    throw new ControlLeaseError('invalid_control', 'browserSessionId, ownerSessionId, and actor are required');
  }
  return { browserSessionId, ownerSessionId, actor: input.actor };
}

function leaseResult(lease: ControlLease, existing: boolean): ControlLeaseResult {
  return {
    browserSessionId: lease.browserSessionId,
    ownerSessionId: lease.ownerSessionId,
    actor: lease.actor,
    controlEpoch: lease.controlEpoch,
    active: lease.active,
    expiresAt: lease.expiresAt.toISOString(),
    heartbeatAt: lease.heartbeatAt.toISOString(),
    existing,
    observationEpoch: lease.controlEpoch,
    observationReady: lease.observationReady,
  };
}

function assertEpoch(epoch: unknown): number {
  if (!Number.isSafeInteger(epoch) || Number(epoch) < 1) {
    throw new ControlLeaseError('invalid_control', 'controlEpoch must be a positive integer');
  }
  return Number(epoch);
}

/** Acquire or transition the control lease. Resource ownership is checked first. */
export async function acquireControl(
  userId: number,
  input: { browserSessionId: unknown; ownerSessionId: unknown; actor: unknown },
): Promise<ControlLeaseResult> {
  const normalized = normalizeLeaseInput(input);
  await requireResourceClaim(userId, {
    resourceType: 'browser',
    resourceId: normalized.browserSessionId,
    ownerSessionId: normalized.ownerSessionId,
  });

  const now = new Date();
  const expiresAt = new Date(now.getTime() + CONTROL_LEASE_TTL_MS);
  return sequelize.transaction(async transaction => {
    const current = await ControlLease.findOne({
      where: { userId, browserSessionId: normalized.browserSessionId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (current?.active && current.expiresAt.getTime() > now.getTime()) {
      if (current.ownerSessionId !== normalized.ownerSessionId) {
        throw new ControlLeaseError('control_conflict', 'Maxun browser control is owned by another Harness session', {
          controlEpoch: current.controlEpoch,
          actor: current.actor,
        });
      }
      if (current.actor === normalized.actor) return leaseResult(current, true);

      await current.update({
        actor: normalized.actor,
        controlEpoch: current.controlEpoch + 1,
        expiresAt,
        heartbeatAt: now,
        active: true,
        observationReady: normalized.actor === 'agent' ? false : true,
      }, { transaction });
      return leaseResult(current, false);
    }

    if (current) {
      await current.update({
        ownerSessionId: normalized.ownerSessionId,
        actor: normalized.actor,
        controlEpoch: current.controlEpoch + 1,
        expiresAt,
        heartbeatAt: now,
        active: true,
        observationReady: normalized.actor === 'agent' ? false : true,
      }, { transaction });
      return leaseResult(current, false);
    }

    const created = await ControlLease.create({
      id: uuid(),
      userId,
      browserSessionId: normalized.browserSessionId,
      ownerSessionId: normalized.ownerSessionId,
      actor: normalized.actor,
      controlEpoch: 1,
      active: true,
      observationReady: true,
      expiresAt,
      heartbeatAt: now,
    }, { transaction });
    return leaseResult(created, false);
  });
}

/** Require the currently active actor and epoch, failing closed on expiry. */
export async function requireControlLease(
  userId: number,
  input: { browserSessionId: unknown; ownerSessionId: unknown; actor: unknown; controlEpoch: unknown },
): Promise<ControlLeaseResult> {
  const normalized = normalizeLeaseInput(input);
  const controlEpoch = assertEpoch(input.controlEpoch);
  await requireResourceClaim(userId, {
    resourceType: 'browser',
    resourceId: normalized.browserSessionId,
    ownerSessionId: normalized.ownerSessionId,
  });
  const current = await ControlLease.findOne({ where: { userId, browserSessionId: normalized.browserSessionId } });
  if (!current || !current.active) {
    throw new ControlLeaseError('control_not_found', 'Maxun browser has no active control lease');
  }
  if (current.expiresAt.getTime() <= Date.now()) {
    await current.update({ active: false, controlEpoch: current.controlEpoch + 1 });
    throw new ControlLeaseError('control_expired', 'Maxun browser control lease has expired', { controlEpoch: current.controlEpoch });
  }
  if (current.ownerSessionId !== normalized.ownerSessionId || current.actor !== normalized.actor || current.controlEpoch !== controlEpoch) {
    throw new ControlLeaseError('stale_control', 'Maxun browser control lease is stale or owned by another actor', {
      controlEpoch: current.controlEpoch,
      actor: current.actor,
    });
  }
  if (normalized.actor === 'agent' && !current.observationReady) {
    throw new ControlLeaseError('observation_required', 'A fresh browser observation is required before agent control resumes', {
      controlEpoch: current.controlEpoch,
      actor: current.actor,
    });
  }
  return leaseResult(current, true);
}

/** Mark the post-handoff full snapshot as the current agent observation. */
export async function acknowledgeControlObservation(
  userId: number,
  input: { browserSessionId: unknown; ownerSessionId: unknown; actor: unknown; controlEpoch: unknown },
): Promise<ControlLeaseResult> {
  const normalized = normalizeLeaseInput(input);
  const controlEpoch = assertEpoch(input.controlEpoch);
  if (normalized.actor !== 'agent') throw new ControlLeaseError('invalid_control', 'Only agent control can acknowledge an observation');
  await requireResourceClaim(userId, {
    resourceType: 'browser',
    resourceId: normalized.browserSessionId,
    ownerSessionId: normalized.ownerSessionId,
  });
  return sequelize.transaction(async transaction => {
    const lease = await ControlLease.findOne({
      where: { userId, browserSessionId: normalized.browserSessionId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!lease || !lease.active || lease.ownerSessionId !== normalized.ownerSessionId || lease.actor !== 'agent' || lease.controlEpoch !== controlEpoch) {
      throw new ControlLeaseError('stale_control', 'Control observation acknowledgement is stale', {
        controlEpoch: lease?.controlEpoch,
        actor: lease?.actor,
      });
    }
    await lease.update({ observationReady: true }, { transaction });
    return leaseResult(lease, true);
  });
}

/** Extend a live lease without changing its epoch. */
export async function heartbeatControl(
  userId: number,
  input: { browserSessionId: unknown; ownerSessionId: unknown; actor: unknown; controlEpoch: unknown },
): Promise<ControlLeaseResult> {
  const normalized = normalizeLeaseInput(input);
  const controlEpoch = assertEpoch(input.controlEpoch);
  await requireResourceClaim(userId, {
    resourceType: 'browser',
    resourceId: normalized.browserSessionId,
    ownerSessionId: normalized.ownerSessionId,
  });
  const now = new Date();
  const lease = await ControlLease.findOne({ where: { userId, browserSessionId: normalized.browserSessionId } });
  if (!lease || !lease.active || lease.ownerSessionId !== normalized.ownerSessionId || lease.actor !== normalized.actor || lease.controlEpoch !== controlEpoch) {
    throw new ControlLeaseError('stale_control', 'Maxun browser control lease is stale or owned by another actor', {
      controlEpoch: lease?.controlEpoch,
      actor: lease?.actor,
    });
  }
  if (lease.expiresAt.getTime() <= now.getTime()) {
    await lease.update({ active: false, controlEpoch: lease.controlEpoch + 1 });
    throw new ControlLeaseError('control_expired', 'Maxun browser control lease has expired', { controlEpoch: lease.controlEpoch });
  }
  await lease.update({ heartbeatAt: now, expiresAt: new Date(now.getTime() + CONTROL_LEASE_TTL_MS) });
  return leaseResult(lease, true);
}

/** Release a lease and advance its epoch so queued commands cannot apply. */
export async function releaseControl(
  userId: number,
  input: { browserSessionId: unknown; ownerSessionId: unknown; actor: unknown; controlEpoch: unknown },
): Promise<{ controlEpoch: number }> {
  const normalized = normalizeLeaseInput(input);
  const controlEpoch = assertEpoch(input.controlEpoch);
  return sequelize.transaction(async transaction => {
    const lease = await ControlLease.findOne({
      where: { userId, browserSessionId: normalized.browserSessionId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!lease || !lease.active) return { controlEpoch: lease?.controlEpoch ?? controlEpoch + 1 };
    if (lease.ownerSessionId !== normalized.ownerSessionId || lease.actor !== normalized.actor || lease.controlEpoch !== controlEpoch) {
      throw new ControlLeaseError('stale_control', 'Maxun browser control lease is stale or owned by another actor', {
        controlEpoch: lease.controlEpoch,
        actor: lease.actor,
      });
    }
    const nextEpoch = lease.controlEpoch + 1;
    await lease.update({ active: false, controlEpoch: nextEpoch, heartbeatAt: new Date() }, { transaction });
    return { controlEpoch: nextEpoch };
  });
}

/** Record one command identity before executing it, rejecting replays atomically. */
export async function beginControlCommand(userId: number, input: ControlCommandInput): Promise<void> {
  if (!input.commandId.trim() || !input.commandType.trim() || !validMode(input.mode)) {
    throw new ControlLeaseError('invalid_control', 'commandId, commandType, and mode are required');
  }
  await requireControlLease(userId, input);
  try {
    await ControlCommand.create({
      id: uuid(),
      userId,
      browserSessionId: input.browserSessionId,
      ownerSessionId: input.ownerSessionId,
      actor: input.actor,
      controlEpoch: input.controlEpoch,
      commandId: input.commandId.trim(),
      commandType: input.commandType.trim(),
      mode: input.mode,
      status: 'running',
    });
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      throw new ControlLeaseError('command_replay', 'This control command has already been accepted', { commandId: input.commandId });
    }
    throw error;
  }
}

export async function getControlCommandStatus(
  userId: number,
  input: { browserSessionId: string; ownerSessionId: string; actor: ControlActor; controlEpoch: number; commandId: string },
): Promise<{ commandId: string; status: ControlCommandStatus; controlEpoch: number; commandType: string } | null> {
  await requireControlLease(userId, input);
  const command = await ControlCommand.findOne({ where: {
    userId,
    browserSessionId: input.browserSessionId,
    commandId: input.commandId,
  } });
  if (!command) return null;
  return {
    commandId: command.commandId,
    status: command.status,
    controlEpoch: command.controlEpoch,
    commandType: command.commandType,
  };
}

export async function finishControlCommand(
  userId: number,
  browserSessionId: string,
  commandId: string,
  status: Exclude<ControlCommandStatus, 'running'>,
): Promise<void> {
  const command = await ControlCommand.findOne({ where: { userId, browserSessionId, commandId } });
  if (!command) return;
  await command.update({ status, finishedAt: new Date() });
}

export const CONTROL_LEASE_TTL_SECONDS = CONTROL_LEASE_TTL_MS / 1000;
