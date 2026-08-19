import { UniqueConstraintError } from 'sequelize';
import { v4 as uuid } from 'uuid';
import ResourceClaim, { type ResourceClaimType } from '../models/ResourceClaim';

export type ResourceClaimErrorCode = 'claim_conflict' | 'claim_not_found' | 'invalid_claim';

export class ResourceClaimError extends Error {
  public constructor(
    public readonly code: ResourceClaimErrorCode,
    message: string,
    public readonly details?: { ownerSessionId?: string; epoch?: number },
  ) {
    super(message);
    this.name = 'ResourceClaimError';
  }
}

const validType = (value: unknown): value is ResourceClaimType => value === 'draft' || value === 'browser';

const normalizeInput = (input: {
  resourceType: unknown;
  resourceId: unknown;
  ownerSessionId: unknown;
}): { resourceType: ResourceClaimType; resourceId: string; ownerSessionId: string } => {
  if (!validType(input.resourceType)) throw new ResourceClaimError('invalid_claim', 'resourceType must be draft or browser');
  const resourceId = typeof input.resourceId === 'string' ? input.resourceId.trim() : '';
  const ownerSessionId = typeof input.ownerSessionId === 'string' ? input.ownerSessionId.trim() : '';
  if (!resourceId || !ownerSessionId) throw new ResourceClaimError('invalid_claim', 'resourceId and ownerSessionId are required');
  return { resourceType: input.resourceType, resourceId, ownerSessionId };
};

type ClaimResult = {
  resourceType: ResourceClaimType;
  resourceId: string;
  ownerSessionId: string;
  epoch: number;
  existing: boolean;
};

/**
 * Claim one resource with an epoch that increases after every release. The
 * unique resource index serializes competing sessions; the conditional update
 * prevents a stale owner from reclaiming an inactive row during a race.
 */
export async function claimResource(
  userId: number,
  input: { resourceType: unknown; resourceId: unknown; ownerSessionId: unknown },
): Promise<ClaimResult> {
  const normalized = normalizeInput(input);
  const where = { userId, resourceType: normalized.resourceType, resourceId: normalized.resourceId };
  const current = await ResourceClaim.findOne({ where });
  if (current?.active) {
    if (current.ownerSessionId !== normalized.ownerSessionId) {
      throw new ResourceClaimError('claim_conflict', 'Maxun resource is already claimed by another Harness session');
    }
    return { ...normalized, epoch: current.epoch, existing: true };
  }

  if (current) {
    const nextEpoch = current.epoch + 1;
    const [updated] = await ResourceClaim.update(
      { ownerSessionId: normalized.ownerSessionId, active: true, epoch: nextEpoch },
      { where: { id: current.id, active: false, epoch: current.epoch } },
    );
    if (updated === 0) return claimResource(userId, input);
    return { ...normalized, epoch: nextEpoch, existing: false };
  }

  try {
    const created = await ResourceClaim.create({
      id: uuid(),
      ...where,
      ownerSessionId: normalized.ownerSessionId,
      epoch: 1,
      active: true,
    });
    return { ...normalized, epoch: created.epoch, existing: false };
  } catch (error) {
    if (!(error instanceof UniqueConstraintError)) throw error;
    return claimResource(userId, input);
  }
}

/** Release is idempotent for an already released row but rejects stale epochs. */
export async function requireResourceClaim(
  userId: number,
  input: { resourceType: unknown; resourceId: unknown; ownerSessionId: unknown },
): Promise<{ epoch: number }> {
  const normalized = normalizeInput(input);
  const current = await ResourceClaim.findOne({
    where: { userId, resourceType: normalized.resourceType, resourceId: normalized.resourceId },
  });
  if (!current || !current.active || current.ownerSessionId !== normalized.ownerSessionId) {
    throw new ResourceClaimError('claim_conflict', 'Maxun resource requires an explicit claim by this Harness session');
  }
  return { epoch: current.epoch };
}

export async function releaseResource(
  userId: number,
  input: { resourceType: unknown; resourceId: unknown; ownerSessionId: unknown; epoch: unknown },
): Promise<void> {
  const normalized = normalizeInput(input);
  const epoch = typeof input.epoch === 'number' ? input.epoch : NaN;
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new ResourceClaimError('invalid_claim', 'epoch must be a positive integer');
  const current = await ResourceClaim.findOne({ where: { userId, resourceType: normalized.resourceType, resourceId: normalized.resourceId } });
  if (!current || !current.active) return;
  if (current.ownerSessionId !== normalized.ownerSessionId || current.epoch !== epoch) {
    throw new ResourceClaimError('claim_conflict', 'Maxun resource claim is owned by another session or epoch');
  }
  await current.update({ active: false, ownerSessionId: '' });
}
