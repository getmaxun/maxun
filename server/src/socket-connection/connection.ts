import { Namespace, Socket } from 'socket.io';
import { IncomingMessage } from 'http';
import { verify, JwtPayload } from 'jsonwebtoken';
import logger from "../logger";
import registerInputHandlers from '../browser-management/inputHandlers';

interface AuthenticatedIncomingMessage extends IncomingMessage {
  user?: JwtPayload | string;
}

interface AuthenticatedSocket extends Socket {
  request: AuthenticatedIncomingMessage;
}

/**
 * Socket.io middleware for authentication
 * This is a socket.io specific auth handler that doesn't rely on Express middleware
 */
const socketAuthMiddleware = (socket: Socket, next: (err?: Error) => void) => {
    const cookies = socket.handshake.headers.cookie;
    if (!cookies) {
        return next(new Error('Authentication required'));
    }
    
    const tokenMatch = cookies.split(';').find(c => c.trim().startsWith('token='));
    if (!tokenMatch) {
        return next(new Error('Authentication required'));
    }
    
    const token = tokenMatch.split('=')[1];
    if (!token) {
        return next(new Error('Authentication required'));
    }
    
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        return next(new Error('Server configuration error'));
    }
    
    verify(token, secret, (err: any, user: any) => {
        if (err) {
            logger.log('warn', 'JWT verification error:', err);
            return next(new Error('Authentication failed'));
        }
        
        // Normalize payload key
        if (user.userId && !user.id) {
            user.id = user.userId;
            delete user.userId; // temporary: del the old key for clarity
        }
        
        // Attach user to socket request
        const authSocket = socket as AuthenticatedSocket;
        authSocket.request.user = user;
        next();
    });
};

/**
 * Opens a websocket canal for duplex data transfer and registers all handlers for this data for the recording session.
 * Uses socket.io dynamic namespaces for multiplexing the traffic from different running remote browser instances.
 * @param io dynamic namespace on the socket.io server
 * @param callback function called after the connection is created providing the socket resource
 * @category BrowserManagement
 */
export const createSocketConnection = (
    io: Namespace,
    callback: (socket: Socket) => void,
) => {
    io.use(socketAuthMiddleware);

    const onConnection = async (socket: Socket) => {
        logger.log('info', "Client connected " + socket.id);
        registerInputHandlers(socket);
        socket.on('disconnect', () => logger.log('info', "Client disconnected " + socket.id));
        callback(socket);
    }

    io.on('connection', onConnection);
};

/**
 * Opens a websocket canal for duplex data transfer for the recording run.
 * Uses socket.io dynamic namespaces for multiplexing the traffic from different running remote browser instances.
 * @param io dynamic namespace on the socket.io server
 * @param callback function called after the connection is created providing the socket resource
 * @category BrowserManagement
 */
export const createSocketConnectionForRun = (
    io: Namespace,
    callback: (socket: Socket) => void,
) => {
    io.use(socketAuthMiddleware);

    const onConnection = async (socket: Socket) => {
        logger.log('info', "Client connected " + socket.id);
        socket.on('disconnect', () => logger.log('info', "Client disconnected " + socket.id));
        callback(socket);
    }

    io.on('connection', onConnection);
};