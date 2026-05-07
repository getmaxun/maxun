import { io, Socket } from "socket.io-client";
import { apiUrl } from "../apiConfig";

const socketCache = new Map<string, Socket>();
const refCounts = new Map<string, number>();

/**
 * Gets an existing socket connection for the browser or creates a new one.
 * Uses reference counting to share a single connection across multiple components.
 */
export function getOrCreateBrowserSocket(browserId: string): Socket {
  if (socketCache.has(browserId)) {
    const count = refCounts.get(browserId) || 0;
    refCounts.set(browserId, count + 1);
    return socketCache.get(browserId)!;
  }

  const socket = io(`${apiUrl}/${browserId}`, {
    transports: ["websocket", "polling"],
    rejectUnauthorized: false,
  });

  socketCache.set(browserId, socket);
  refCounts.set(browserId, 1);
  return socket;
}

/**
 * Decrements the reference count for a browser socket.
 * If the reference count reaches 0, the socket is disconnected and removed from cache.
 */
export function releaseBrowserSocket(browserId: string) {
  const count = (refCounts.get(browserId) || 0) - 1;
  
  if (count <= 0) {
    const socket = socketCache.get(browserId);
    if (socket) {
      socket.disconnect();
      socketCache.delete(browserId);
    }
    refCounts.delete(browserId);
  } else {
    refCounts.set(browserId, count);
  }
}
