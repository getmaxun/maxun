import { Namespace, Socket } from 'socket.io';
import logger from "../logger";
import { registerInputHandlers, removeInputHandlers } from '../browser-management/inputHandlers';

/**
 * Opens a websocket canal for duplex data transfer and registers all handlers for this data for the recording session.
 * Uses socket.io dynamic namespaces for multiplexing the traffic from different running remote browser instances.
 * @param io dynamic namespace on the socket.io server
 * @param callback function called after the connection is created providing the socket resource
 * @category BrowserManagement
 */
export const createSocketConnection = (
    io: Namespace,
    userId: string,
    callback: (socket: Socket) => void,
) => {
    const onConnection = async (socket: Socket) => {
        logger.log('info', "Client connected " + socket.id);
        registerInputHandlers(socket, userId);
        socket.on('disconnect', () => {
            logger.log('info', "Client disconnected " + socket.id);
            removeInputHandlers(socket);
            logger.log('debug', "Input handlers cleaned up for socket " + socket.id);
        });
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
    const onConnection = async (socket: Socket) => {
        logger.log('info', "Client connected " + socket.id);
        socket.on('disconnect', () => logger.log('info', "Client disconnected " + socket.id));
        callback(socket);
    }

    io.on('connection', onConnection);
};