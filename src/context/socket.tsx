import React, { createContext, useCallback, useContext, useState, useRef, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { apiUrl } from "../apiConfig";

const SERVER_ENDPOINT = apiUrl;

interface SocketState {
  socket: Socket | null;
  queueSocket: Socket | null;
  id: string;
  setId: (id: string) => void;
  connectToQueueSocket: (userId: string, onRunCompleted?: (data: any) => void, onRunStarted?: (data: any) => void, onRunRecovered?: (data: any) => void, onRunScheduled?: (data: any) => void) => void;
  disconnectQueueSocket: () => void;
};

class SocketStore implements Partial<SocketState> {
  socket: Socket | null = null;
  queueSocket: Socket | null = null;
  id = '';
};

const socketStore = new SocketStore();
const socketStoreContext = createContext<SocketState>(socketStore as SocketState);

export const useSocketStore = () => useContext(socketStoreContext);

export const SocketProvider = ({ children }: { children: JSX.Element }) => {
  const [socket, setSocket] = useState<Socket | null>(socketStore.socket);
  const [queueSocket, setQueueSocket] = useState<Socket | null>(socketStore.queueSocket);
  const [id, setActiveId] = useState<string>(socketStore.id);
  const runCompletedCallbackRef = useRef<((data: any) => void) | null>(null);
  const runStartedCallbackRef = useRef<((data: any) => void) | null>(null);
  const runRecoveredCallbackRef = useRef<((data: any) => void) | null>(null);
  const runScheduledCallbackRef = useRef<((data: any) => void) | null>(null);

  const setId = useCallback((id: string) => {
    // the socket client connection is recomputed whenever id changes -> the new browser has been initialized
    const socket =
      io(`${SERVER_ENDPOINT}/${id}`, {
        transports: ["websocket"],
        rejectUnauthorized: false
      });

    socket.on('connect', () => console.log('connected to socket'));
    socket.on("connect_error", (err) => console.log(`connect_error due to ${err.message}`));

    setSocket(socket);
    setActiveId(id);
  }, [setSocket]);

  const connectToQueueSocket = useCallback((userId: string, onRunCompleted?: (data: any) => void, onRunStarted?: (data: any) => void, onRunRecovered?: (data: any) => void, onRunScheduled?: (data: any) => void) => {
    runCompletedCallbackRef.current = onRunCompleted || null;
    runStartedCallbackRef.current = onRunStarted || null;
    runRecoveredCallbackRef.current = onRunRecovered || null;
    runScheduledCallbackRef.current = onRunScheduled || null;

    const newQueueSocket = io(`${SERVER_ENDPOINT}/queued-run`, {
      transports: ["websocket"],
      rejectUnauthorized: false,
      query: { userId }
    });

    newQueueSocket.on('connect', () => {
      console.log('Queue socket connected for user:', userId);
    });

    newQueueSocket.on('connect_error', (error) => {
      console.log('Queue socket connection error:', error);
    });

    newQueueSocket.on('run-completed', (completionData) => {
      console.log('Run completed event received:', completionData);
      if (runCompletedCallbackRef.current) {
        runCompletedCallbackRef.current(completionData);
      }
    });

    newQueueSocket.on('run-started', (startedData) => {
      console.log('Run started event received:', startedData);
      if (runStartedCallbackRef.current) {
        runStartedCallbackRef.current(startedData);
      }
    });

    newQueueSocket.on('run-recovered', (recoveredData) => {
      console.log('Run recovered event received:', recoveredData);
      if (runRecoveredCallbackRef.current) {
        runRecoveredCallbackRef.current(recoveredData);
      }
    });

    newQueueSocket.on('run-scheduled', (scheduledData) => {
      console.log('Run scheduled event received:', scheduledData);
      if (runScheduledCallbackRef.current) {
        runScheduledCallbackRef.current(scheduledData);
      }
    });

    setQueueSocket(currentSocket => {
      if (currentSocket) {
        currentSocket.disconnect();
      }
      return newQueueSocket;
    });

    socketStore.queueSocket = newQueueSocket;
  }, []);

  const disconnectQueueSocket = useCallback(() => {
    setQueueSocket(currentSocket => {
      if (currentSocket) {
        currentSocket.disconnect();
      }
      return null;
    });

    socketStore.queueSocket = null;
    runStartedCallbackRef.current = null;
    runCompletedCallbackRef.current = null;
    runRecoveredCallbackRef.current = null;
    runScheduledCallbackRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (queueSocket) {
        queueSocket.disconnect();
      }
    };
  }, [queueSocket]);

  return (
    <socketStoreContext.Provider
      value={{
        socket,
        queueSocket,
        id,
        setId,
        connectToQueueSocket,
        disconnectQueueSocket,
      }}
    >
      {children}
    </socketStoreContext.Provider>
  );
};
