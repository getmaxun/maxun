import { sign, verify } from 'jsonwebtoken';
import { Socket } from 'socket.io';

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
 * Lifetime of a server-minted socket token.
 *
 * It is used once, immediately, by a connection opened in the same tick. A
 * login token is deliberately long-lived because it backs a session; this backs
 * a handshake, so it expires almost at once.
 */
const INTERNAL_SOCKET_TOKEN_TTL_SECONDS = 60;

/**
 * Mint a token for a socket connection the backend opens to itself.
 *
 * The backend joins its own namespace as a client whenever a run is started by
 * something other than a browser: API, SDK and scheduled runs all take that
 * path. Those connections carry no cookie, so once `authenticateSocket` was
 * applied to every namespace they were refused - and because the refusal
 * surfaces as `connect_error` rather than as a failed run, the run simply
 * waited for a `ready-for-run` that could never arrive.
 *
 * Signed with the same secret and the same `id` claim the HTTP login issues, so
 * the gate needs no special case and `socketOwns` keeps working unchanged: the
 * connection authenticates as the user the run already belongs to, rather than
 * as a privileged internal caller.
 */
export const mintInternalSocketToken = (userId: string | number): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set, so an internal socket connection cannot authenticate.');
  }

  return sign({ id: String(userId) }, secret, {
    expiresIn: INTERNAL_SOCKET_TOKEN_TTL_SECONDS,
  });
};

/**
 * Handshake middleware giving socket connections the same gate as the HTTP
 * routes. Without it every namespace accepted anonymous connections, so the
 * identity a client claimed was whatever it put in the handshake query.
 *
 * The verified id is stored on `socket.data.userId`; nothing downstream should
 * take a user id from client-supplied handshake data.
 */
export const authenticateSocket = (socket: Socket, next: (err?: Error) => void): void => {
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
    const decoded = verify(token, secret) as any;
    const userId = decoded && (decoded.id ?? decoded.userId);

    if (userId === undefined || userId === null || userId === '') {
      next(new Error('Unauthorized'));
      return;
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
