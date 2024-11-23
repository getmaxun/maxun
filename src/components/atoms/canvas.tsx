import React, { useCallback, useEffect, useRef } from 'react';
import { useSocketStore } from '../../context/socket';
import { getMappedCoordinates } from "../../helpers/inputHelpers";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { useActionContext } from '../../context/browserActions';

interface CreateRefCallback {
    (ref: React.RefObject<HTMLCanvasElement>): void;
}

interface CanvasProps {
    width: number;
    height: number;
    onCreateRef: CreateRefCallback;
}

/**
 * Interface for mouse's x,y coordinates
 */
export interface Coordinates {
    x: number;
    y: number;
};

const Canvas = ({ width, height, onCreateRef }: CanvasProps) => {

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { socket } = useSocketStore();
    const { setLastAction, lastAction } = useGlobalInfoStore();
    const { getText, getList } = useActionContext();
    const getTextRef = useRef(getText);
    const getListRef = useRef(getList);

    const notifyLastAction = (action: string) => {
        if (lastAction !== action) {
            setLastAction(action);
        }
    };

    const lastMousePosition = useRef<Coordinates>({ x: 0, y: 0 });

    useEffect(() => {
        getTextRef.current = getText;
        getListRef.current = getList;
    }, [getText, getList]);

    const onMouseEvent = useCallback((event: MouseEvent) => {
        if (socket && canvasRef.current) {
            // Get the canvas bounding rectangle
            const rect = canvasRef.current.getBoundingClientRect();
            const clickCoordinates = {
                x: event.clientX - rect.left, // Use relative x coordinate
                y: event.clientY - rect.top, // Use relative y coordinate
            };

            switch (event.type) {
                case 'mousedown':
                    if (getTextRef.current === true) {
                        console.log('Capturing Text...');
                    } else if (getListRef.current === true) {
                        console.log('Capturing List...');
                    } else {
                        socket.emit('input:mousedown', clickCoordinates);
                    }
                    notifyLastAction('click');
                    break;
                case 'mousemove':
                    if (lastMousePosition.current.x !== clickCoordinates.x ||
                        lastMousePosition.current.y !== clickCoordinates.y) {
                        lastMousePosition.current = {
                            x: clickCoordinates.x,
                            y: clickCoordinates.y,
                        };
                        socket.emit('input:mousemove', {
                            x: clickCoordinates.x,
                            y: clickCoordinates.y,
                        });
                        notifyLastAction('move');
                    }
                    break;
                case 'wheel':
                    const wheelEvent = event as WheelEvent;
                    const deltas = {
                        deltaX: Math.round(wheelEvent.deltaX),
                        deltaY: Math.round(wheelEvent.deltaY),
                    };
                    socket.emit('input:wheel', deltas);
                    notifyLastAction('scroll');
                    break;
                default:
                    console.log('Default mouseEvent registered');
                    return;
            }
        }
    }, [socket]);

    const onKeyboardEvent = useCallback((event: KeyboardEvent) => {
        if (socket) {
            switch (event.type) {
                case 'keydown':
                    socket.emit('input:keydown', { key: event.key, coordinates: lastMousePosition.current });
                    notifyLastAction(`${event.key} pressed`);
                    break;
                case 'keyup':
                    socket.emit('input:keyup', event.key);
                    break;
                default:
                    console.log('Default keyEvent registered');
                    return;
            }
        }
    }, [socket]);


    useEffect(() => {
        if (canvasRef.current) {
            onCreateRef(canvasRef);
            canvasRef.current.addEventListener('mousedown', onMouseEvent);
            canvasRef.current.addEventListener('mousemove', onMouseEvent);
            canvasRef.current.addEventListener('wheel', onMouseEvent, { passive: true });
            canvasRef.current.addEventListener('keydown', onKeyboardEvent);
            canvasRef.current.addEventListener('keyup', onKeyboardEvent);

            return () => {
                if (canvasRef.current) {
                    canvasRef.current.removeEventListener('mousedown', onMouseEvent);
                    canvasRef.current.removeEventListener('mousemove', onMouseEvent);
                    canvasRef.current.removeEventListener('wheel', onMouseEvent);
                    canvasRef.current.removeEventListener('keydown', onKeyboardEvent);
                    canvasRef.current.removeEventListener('keyup', onKeyboardEvent);
                }

            };
        } else {
            console.log('Canvas not initialized');
        }

    }, [onMouseEvent]);

    return (
        <div style={{ borderRadius: '0px 0px 5px 5px', overflow: 'hidden', backgroundColor: 'white' }}>
            <canvas
                tabIndex={0}
                ref={canvasRef}
                height={1000}
                width={900}
                style={{ display: 'block' }}
            />
        </div>
    );

};


export default Canvas;