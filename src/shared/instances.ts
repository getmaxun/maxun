import { BrowserPool } from "../../server/src/browser-management/classes/BrowserPool"
import { Server } from "socket.io";
import http from 'http';

/**
 * Shared browser pool instance
 */
export const browserPool = new BrowserPool();

/**
 * Shared socket.io instance - will be initialized by the main server
 */
export let io: Server;

/**
 * Initialize the socket.io instance (called only by main server)
 */
export function initializeSocketIO(server: http.Server): Server {
  io = new Server(server);
  return io;
}