// Canvas.tsx
import React, { useCallback, useEffect, useRef, useMemo } from 'react';
import { useSocketStore } from '../../context/socket';
import { useGlobalInfoStore } from "../../context/globalInfo";
import { useActionContext } from '../../context/browserActions';
import DatePicker from './DatePicker';
import Dropdown from './Dropdown';
import TimePicker from './TimePicker';
import DateTimeLocalPicker from './DateTimeLocalPicker';
import { FrontendPerformanceMonitor } from '../../../perf/performance';

// Types
interface CreateRefCallback {
    (ref: React.RefObject<HTMLCanvasElement>): void;
}

interface CanvasProps {
    width: number;
    height: number;
    onCreateRef: CreateRefCallback;
}

export interface Coordinates {
    x: number;
    y: number;
}

interface DropdownOption {
    value: string;
    text: string;
    disabled: boolean;
    selected: boolean;
}

interface CanvasState {
    datePickerInfo: {
        coordinates: Coordinates;
        selector: string;
    } | null;
    dropdownInfo: {
        coordinates: Coordinates;
        selector: string;
        options: DropdownOption[];
    } | null;
    timePickerInfo: {
        coordinates: Coordinates;
        selector: string;
    } | null;
    dateTimeLocalInfo: {
        coordinates: Coordinates;
        selector: string;
    } | null;
}

type CanvasAction = 
    | { type: 'SET_DATE_PICKER'; payload: CanvasState['datePickerInfo'] }
    | { type: 'SET_DROPDOWN'; payload: CanvasState['dropdownInfo'] }
    | { type: 'SET_TIME_PICKER'; payload: CanvasState['timePickerInfo'] }
    | { type: 'SET_DATETIME_PICKER'; payload: CanvasState['dateTimeLocalInfo'] };

// Helper functions
const throttle = <T extends (...args: any[]) => any>(func: T, limit: number): T => {
    let inThrottle = false;
    return ((...args: Parameters<T>): ReturnType<T> | void => {
        if (!inThrottle) {
            func.apply(null, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }) as T;
};

const createOffscreenCanvas = (width: number, height: number) => {
    if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(width, height);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
};

// Reducer
const canvasReducer = (state: CanvasState, action: CanvasAction): CanvasState => {
    switch (action.type) {
        case 'SET_DATE_PICKER':
            return { ...state, datePickerInfo: action.payload };
        case 'SET_DROPDOWN':
            return { ...state, dropdownInfo: action.payload };
        case 'SET_TIME_PICKER':
            return { ...state, timePickerInfo: action.payload };
        case 'SET_DATETIME_PICKER':
            return { ...state, dateTimeLocalInfo: action.payload };
        default:
            return state;
    }
};

// Main Component
const Canvas = React.memo(({ width, height, onCreateRef }: CanvasProps) => {
    // Refs
    const performanceMonitor = useRef(new FrontendPerformanceMonitor());
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const lastMousePosition = useRef<Coordinates>({ x: 0, y: 0 });
    const frameRequest = useRef<number>();
    const renderingContext = useRef<CanvasRenderingContext2D | null>(null);
    const offscreenCanvas = useRef<HTMLCanvasElement | OffscreenCanvas>(
        createOffscreenCanvas(width || 900, height || 400)
    );

    // Hooks
    const { socket } = useSocketStore();
    const { setLastAction, lastAction } = useGlobalInfoStore();
    const { getText, getList } = useActionContext();
    const getTextRef = useRef(getText);
    const getListRef = useRef(getList);

    // State
    const [state, dispatch] = React.useReducer(canvasReducer, {
        datePickerInfo: null,
        dropdownInfo: null,
        timePickerInfo: null,
        dateTimeLocalInfo: null
    });

    // Memoized values
    const canvasSize = useMemo(() => ({
        width: width || 900,
        height: height || 400
    }), [width, height]);

    const notifyLastAction = useCallback((action: string) => {
        if (lastAction !== action) {
            setLastAction(action);
        }
    }, [lastAction, setLastAction]);

    // Socket event handlers
    const socketHandlers = useMemo(() => ({
        showDatePicker: (info: CanvasState['datePickerInfo']) => {
            dispatch({ type: 'SET_DATE_PICKER', payload: info });
        },
        showDropdown: (info: CanvasState['dropdownInfo']) => {
            dispatch({ type: 'SET_DROPDOWN', payload: info });
        },
        showTimePicker: (info: CanvasState['timePickerInfo']) => {
            dispatch({ type: 'SET_TIME_PICKER', payload: info });
        },
        showDateTimePicker: (info: CanvasState['dateTimeLocalInfo']) => {
            dispatch({ type: 'SET_DATETIME_PICKER', payload: info });
        }
    }), []);

    // Event handlers
    const handleMouseMove = useCallback(
        throttle((coordinates: Coordinates) => {
            if (!socket) return;

            if (
                lastMousePosition.current.x !== coordinates.x ||
                lastMousePosition.current.y !== coordinates.y
            ) {
                lastMousePosition.current = coordinates;
                socket.emit('input:mousemove', coordinates);
                notifyLastAction('move');
            }
        }, 16),
        [socket, notifyLastAction]
    );

    const onMouseEvent = useCallback((event: MouseEvent) => {
        performanceMonitor.current.measureEventLatency(event);
        if (!socket || !canvasRef.current) return;

        const rect = canvasRef.current.getBoundingClientRect();
        const clickCoordinates = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };

        switch (event.type) {
            case 'mousedown':
                if (getTextRef.current) {
                    console.log('Capturing Text...');
                } else if (getListRef.current) {
                    console.log('Capturing List...');
                } else {
                    socket.emit('input:mousedown', clickCoordinates);
                }
                notifyLastAction('click');
                break;

            case 'mousemove':
                handleMouseMove(clickCoordinates);
                break;

            case 'wheel':
                if (frameRequest.current) {
                    cancelAnimationFrame(frameRequest.current);
                }
                frameRequest.current = requestAnimationFrame(() => {
                    const wheelEvent = event as WheelEvent;
                    socket.emit('input:wheel', {
                        deltaX: Math.round(wheelEvent.deltaX),
                        deltaY: Math.round(wheelEvent.deltaY),
                    });
                    notifyLastAction('scroll');
                });
                break;
        }
    }, [socket, handleMouseMove, notifyLastAction]);

    const onKeyboardEvent = useCallback((event: KeyboardEvent) => {
        if (!socket) return;

        switch (event.type) {
            case 'keydown':
                socket.emit('input:keydown', {
                    key: event.key,
                    coordinates: lastMousePosition.current
                });
                notifyLastAction(`${event.key} pressed`);
                break;

            case 'keyup':
                socket.emit('input:keyup', event.key);
                break;
        }
    }, [socket, notifyLastAction]);

    // Effects
    useEffect(() => {
        getTextRef.current = getText;
        getListRef.current = getList;
    }, [getText, getList]);

    useEffect(() => {
        if (!socket) return;

        Object.entries(socketHandlers).forEach(([event, handler]) => {
            socket.on(event, handler);
        });

        return () => {
            Object.keys(socketHandlers).forEach(event => {
                socket.off(event);
            });
        };
    }, [socket, socketHandlers]);

    useEffect(() => {
        const monitor = performanceMonitor.current;
        const intervalId = setInterval(() => {
            const report = monitor.getPerformanceReport();
            console.log('Frontend Performance Report:', report);
        }, 10000);

        return () => {
            clearInterval(intervalId);
            if (frameRequest.current) {
                cancelAnimationFrame(frameRequest.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!canvasRef.current) return;

        renderingContext.current = canvasRef.current.getContext('2d');
        onCreateRef(canvasRef);

        const canvas = canvasRef.current;
        canvas.addEventListener('mousedown', onMouseEvent);
        canvas.addEventListener('mousemove', onMouseEvent);
        canvas.addEventListener('wheel', onMouseEvent, { passive: true });
        canvas.addEventListener('keydown', onKeyboardEvent);
        canvas.addEventListener('keyup', onKeyboardEvent);

        return () => {
            canvas.removeEventListener('mousedown', onMouseEvent);
            canvas.removeEventListener('mousemove', onMouseEvent);
            canvas.removeEventListener('wheel', onMouseEvent);
            canvas.removeEventListener('keydown', onKeyboardEvent);
            canvas.removeEventListener('keyup', onKeyboardEvent);
        };
    }, [onMouseEvent, onKeyboardEvent, onCreateRef]);

    return (
        <div className="relative bg-white rounded-b-md overflow-hidden">
            <canvas
                tabIndex={0}
                ref={canvasRef}
                height={canvasSize.height}
                width={canvasSize.width}
                className="block"
            />
            {state.datePickerInfo && (
                <DatePicker
                    coordinates={state.datePickerInfo.coordinates}
                    selector={state.datePickerInfo.selector}
                    onClose={() => dispatch({ type: 'SET_DATE_PICKER', payload: null })}
                />
            )}
            {state.dropdownInfo && (
                <Dropdown
                    coordinates={state.dropdownInfo.coordinates}
                    selector={state.dropdownInfo.selector}
                    options={state.dropdownInfo.options}
                    onClose={() => dispatch({ type: 'SET_DROPDOWN', payload: null })}
                />
            )}
            {state.timePickerInfo && (
                <TimePicker
                    coordinates={state.timePickerInfo.coordinates}
                    selector={state.timePickerInfo.selector}
                    onClose={() => dispatch({ type: 'SET_TIME_PICKER', payload: null })}
                />
            )}
            {state.dateTimeLocalInfo && (
                <DateTimeLocalPicker
                    coordinates={state.dateTimeLocalInfo.coordinates}
                    selector={state.dateTimeLocalInfo.selector}
                    onClose={() => dispatch({ type: 'SET_DATETIME_PICKER', payload: null })}
                />
            )}
        </div>
    );
});

Canvas.displayName = 'Canvas';

export default Canvas;