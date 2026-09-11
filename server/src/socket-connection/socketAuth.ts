import { verify, type JwtPayload } from 'jsonwebtoken';
import { Socket } from 'socket.io';
import { requireResourceClaim } from '../sdk/resourceClaims';
import { requireControlLease, type ControlActor } from '../sdk/controlLease';

export interface MaxunStreamCapability {
  readonly browserId: string;
  readonly ownerSessionId: string;
  readonly epoch: number;
}

export interface MaxunControlCapability {
  readonly browserId: string;
  readonly ownerSessionId: string;
  readonly controlEpoch: number;
  readonly actor: ControlActor;
}

export interface MaxunInternalRunCapability {
  readonly browserId: string;
}

/**
 * Reads the session JWT from the handshake cookie header.
 *
 * The token cookie is httpOnly, so the browser attaches it to the socket
 * handshake but page scripts cannot read it to pass explicitly. Parsed here
 * rather than via cookie-parser because the handshake is not an Express
 * request and never passes through the middleware stack.
 */
const readTokenFromCookieHeader = (cookieHeader?: string): string | null => {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== 'token') continue;

    const value = part.slice(separator + 1).trim();
    if (!value) return null;

    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
};

/**
 * Handshake middleware giving socket connections the same gate as the HTTP
 * routes. Without it every namespace accepted anonymous connections, so the
 * identity a client claimed was whatever it put in the handshake query.
 *
 * The verified id is stored on `socket.data.userId`; nothing downstream should
 * take a user id from client-supplied handshake data.
 */
export const authenticateSocket = async (socket: Socket, next: (err?: Error) => void): Promise<void> => {
  const suppliedToken = socket.handshake.auth && (socket.handshake.auth as any).token;
  const token = suppliedToken || readTokenFromCookieHeader(socket.handshake.headers.cookie);

  if (!token) {
    next(new Error('Unauthorized'));
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    next(new Error('Unauthorized'));
    return;
  }

  try {
    const decoded = verify(token, secret) as JwtPayload & Record<string, unknown>;
    const userId = decoded && (decoded.id ?? decoded.userId ?? decoded.sub);

    if (userId === undefined || userId === null || userId === '') {
      next(new Error('Unauthorized'));
      return;
    }

    if (decoded.purpose !== undefined) {
      const browserId = typeof decoded.browserId === 'string' ? decoded.browserId : '';
      const namespaceBrowserId = socket.nsp.name.replace(/^\//, '');
      if (!browserId || namespaceBrowserId !== browserId) {
        next(new Error('Unauthorized'));
        return;
      }

      if (decoded.purpose === 'maxun-browser-stream') {
        const ownerSessionId = typeof decoded.ownerSessionId === 'string' ? decoded.ownerSessionId : '';
        if (!ownerSessionId) {
          next(new Error('Unauthorized'));
          return;
        }
        const epoch = typeof decoded.epoch === 'number' ? decoded.epoch : NaN;
        if (!Number.isSafeInteger(epoch) || epoch < 1) {
          next(new Error('Unauthorized'));
          return;
        }
        try {
          const claim = await requireResourceClaim(Number(userId), {
            resourceType: 'browser', resourceId: browserId, ownerSessionId,
          });
          if (claim.epoch !== epoch) {
            next(new Error('Unauthorized'));
            return;
          }
        } catch {
          next(new Error('Unauthorized'));
          return;
        }
        socket.data.maxunStreamCapability = { browserId, ownerSessionId, epoch } satisfies MaxunStreamCapability;
      } else if (decoded.purpose === 'maxun-internal-run') {
        if (typeof decoded.browserId !== 'string' || decoded.browserId !== namespaceBrowserId) {
          next(new Error('Unauthorized'));
          return;
        }
        socket.data.maxunInternalRunCapability = { browserId: decoded.browserId } satisfies MaxunInternalRunCapability;
      } else if (decoded.purpose === 'maxun-browser-control') {
        const ownerSessionId = typeof decoded.ownerSessionId === 'string' ? decoded.ownerSessionId : '';
        if (!ownerSessionId) {
          next(new Error('Unauthorized'));
          return;
        }
        const controlEpoch = typeof decoded.controlEpoch === 'number' ? decoded.controlEpoch : NaN;
        const actor = decoded.actor === 'agent' || decoded.actor === 'human' ? decoded.actor : null;
        if (!actor || !Number.isSafeInteger(controlEpoch) || controlEpoch < 1) {
          next(new Error('Unauthorized'));
          return;
        }
        try {
          await requireControlLease(Number(userId), {
            browserSessionId: browserId,
            ownerSessionId,
            actor,
            controlEpoch,
          });
        } catch {
          next(new Error('Unauthorized'));
          return;
        }
        socket.data.maxunControlCapability = { browserId, ownerSessionId, controlEpoch, actor } satisfies MaxunControlCapability;
      } else {
        next(new Error('Unauthorized'));
        return;
      }
    }

    socket.data.userId = String(userId);
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
};

/**
 * True when the connected socket owns the resource the namespace belongs to.
 */
export const socketOwns = (socket: Socket, ownerId: string | number): boolean =>
  String(socket.data.userId) === String(ownerId);
