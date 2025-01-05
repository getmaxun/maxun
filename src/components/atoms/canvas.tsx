import React, { useCallback, useEffect, useRef, useMemo } from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { useSocketStore } from '../../context/socket';
import { useGlobalInfoStore } from "../../context/globalInfo";
import { useActionContext } from '../../context/browserActions';
import DatePicker from './DatePicker';
import Dropdown from './Dropdown';
import TimePicker from './TimePicker';
import DateTimeLocalPicker from './DateTimeLocalPicker';
import { FrontendPerformanceMonitor } from '../../../perf/performance';

// Optimized throttle with RAF
const rafThrottle = <T extends (...args: any[]) => any>(callback: T) => {
    let requestId: number | null = null;
    let lastArgs: Parameters<T>;

    const later = () => {
        requestId = null;
        callback.apply(null, lastArgs);
    };

    return (...args: Parameters<T>) => {
        lastArgs = args;
        if (requestId === null) {
            requestId = requestAnimationFrame(later);
        }
    };
};

// Cache DOM measurements
let measurementCache = new WeakMap<HTMLElement, DOMRect>();
const getBoundingClientRectCached = (element: HTMLElement) => {
    let rect = measurementCache.get(element);
    if (!rect) {
        rect = element.getBoundingClientRect();
        measurementCache.set(element, rect);
    }
    return rect;
};

// Types (kept the same)
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

// Batch updates helper
const batchedUpdates = (updates: Array<() => void>) => {
    unstable_batchedUpdates(() => {
        updates.forEach(update => update());
    });
};

const Canvas = React.memo(({ width, height, onCreateRef }: CanvasProps) => {
    const performanceMonitor = useRef(new FrontendPerformanceMonitor());
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { socket } = useSocketStore();
    const { setLastAction, lastAction } = useGlobalInfoStore();
    const { getText, getList } = useActionContext();
    
    // Use a single ref object to reduce memory allocations
    const refs = useRef({
        getText,
        getList,
        lastMousePosition: { x: 0, y: 0 },
        frameRequest: 0,
        eventQueue: [] as Array<() => void>,
        isProcessing: false
    });

    // Consolidated state using a single reducer
    const [state, dispatch] = React.useReducer((state: any, action: any) => {
        switch (action.type) {
            case 'BATCH_UPDATE':
                return { ...state, ...action.payload };
            default:
                return state;
        }
    }, {
        datePickerInfo: null,
        dropdownInfo: null,
        timePickerInfo: null,
        dateTimeLocalInfo: null
    });

    // Process events in batches
    const processEventQueue = useCallback(() => {
        if (refs.current.isProcessing || refs.current.eventQueue.length === 0) return;
        
        refs.current.isProcessing = true;
        const events = [...refs.current.eventQueue];
        refs.current.eventQueue = [];

        batchedUpdates(events.map(event => () => event()));

        refs.current.isProcessing = false;
        
        if (refs.current.eventQueue.length > 0) {
            requestAnimationFrame(processEventQueue);
        }
    }, []);

    // Optimized mouse move handler using RAF throttle
    const handleMouseMove = useMemo(
        () => rafThrottle((coordinates: Coordinates) => {
            if (!socket) return;

            const current = refs.current.lastMousePosition;
            if (current.x !== coordinates.x || current.y !== coordinates.y) {
                refs.current.lastMousePosition = coordinates;
                socket.emit('input:mousemove', coordinates);
                refs.current.eventQueue.push(() => setLastAction('move'));
                requestAnimationFrame(processEventQueue);
            }
        }),
        [socket, processEventQueue]
    );

    // Optimized event handler with better performance characteristics
    const onMouseEvent = useCallback((event: MouseEvent) => {
        if (!socket || !canvasRef.current) return;

        performanceMonitor.current.measureEventLatency(event);
        const rect = getBoundingClientRectCached(canvasRef.current);
        const coordinates = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };

        switch (event.type) {
            case 'mousedown':
                refs.current.eventQueue.push(() => {
                    if (refs.current.getText) {
                        console.log('Capturing Text...');
                    } else if (refs.current.getList) {
                        console.log('Capturing List...');
                    } else {
                        socket.emit('input:mousedown', coordinates);
                    }
                    setLastAction('click');
                });
                break;

            case 'mousemove':
                handleMouseMove(coordinates);
                break;

            case 'wheel':
                if (refs.current.frameRequest) {
                    cancelAnimationFrame(refs.current.frameRequest);
                }
                refs.current.frameRequest = requestAnimationFrame(() => {
                    const wheelEvent = event as WheelEvent;
                    socket.emit('input:wheel', {
                        deltaX: Math.round(wheelEvent.deltaX),
                        deltaY: Math.round(wheelEvent.deltaY)
                    });
                    refs.current.eventQueue.push(() => setLastAction('scroll'));
                });
                break;
        }

        requestAnimationFrame(processEventQueue);
    }, [socket, handleMouseMove, processEventQueue]);

    // Optimized keyboard handler
    const onKeyboardEvent = useMemo(
        () => rafThrottle((event: KeyboardEvent) => {
            if (!socket) return;

            refs.current.eventQueue.push(() => {
                switch (event.type) {
                    case 'keydown':
                        socket.emit('input:keydown', {
                            key: event.key,
                            coordinates: refs.current.lastMousePosition
                        });
                        setLastAction(`${event.key} pressed`);
                        break;
                    case 'keyup':
                        socket.emit('input:keyup', event.key);
                        break;
                }
            });
            requestAnimationFrame(processEventQueue);
        }),
        [socket, processEventQueue]
    );

    // Update refs
    useEffect(() => {
        refs.current.getText = getText;
        refs.current.getList = getList;
    }, [getText, getList]);

    // Socket event setup with optimized cleanup
    useEffect(() => {
        if (!socket) return;

        const handlers = {
            showDatePicker: (info: any) => dispatch({ type: 'BATCH_UPDATE', payload: { datePickerInfo: info } }),
            showDropdown: (info: any) => dispatch({ type: 'BATCH_UPDATE', payload: { dropdownInfo: info } }),
            showTimePicker: (info: any) => dispatch({ type: 'BATCH_UPDATE', payload: { timePickerInfo: info } }),
            showDateTimePicker: (info: any) => dispatch({ type: 'BATCH_UPDATE', payload: { dateTimeLocalInfo: info } })
        };

        Object.entries(handlers).forEach(([event, handler]) => {
            socket.on(event, handler);
        });

        return () => {
            Object.keys(handlers).forEach(event => {
                socket.off(event);
            });
        };
    }, [socket]);

    useEffect(() => {
        const monitor = performanceMonitor.current;
        const intervalId = setInterval(() => {
            console.log('Frontend Performance Report:', monitor.getPerformanceReport());
        }, 15000); // Increased to 15 seconds
    
        return () => {
            clearInterval(intervalId);
            if (refs.current.frameRequest) {
                cancelAnimationFrame(refs.current.frameRequest);
            }
    
            // Clear measurement cache on unmount
            measurementCache = new WeakMap(); // Reset the WeakMap
        };
    }, []);
    

    // Canvas setup with optimized event binding
    useEffect(() => {
        if (!canvasRef.current) return;

        onCreateRef(canvasRef);
        const canvas = canvasRef.current;

        const options = { passive: true };
        canvas.addEventListener('mousedown', onMouseEvent, options);
        canvas.addEventListener('mousemove', onMouseEvent, options);
        canvas.addEventListener('wheel', onMouseEvent, options);
        canvas.addEventListener('keydown', onKeyboardEvent, options);
        canvas.addEventListener('keyup', onKeyboardEvent, options);

        return () => {
            canvas.removeEventListener('mousedown', onMouseEvent);
            canvas.removeEventListener('mousemove', onMouseEvent);
            canvas.removeEventListener('wheel', onMouseEvent);
            canvas.removeEventListener('keydown', onKeyboardEvent);
            canvas.removeEventListener('keyup', onKeyboardEvent);
        };
    }, [onMouseEvent, onKeyboardEvent, onCreateRef]);

    const memoizedSize = useMemo(() => ({
        width: width || 900,
        height: height || 400
    }), [width, height]);

    return (
        <div className="relative bg-white rounded-b-md overflow-hidden">
            <canvas
                tabIndex={0}
                ref={canvasRef}
                height={memoizedSize.height}
                width={memoizedSize.width}
                className="block"
            />
            {state.datePickerInfo && (
                <DatePicker
                    coordinates={state.datePickerInfo.coordinates}
                    selector={state.datePickerInfo.selector}
                    onClose={() => dispatch({ 
                        type: 'BATCH_UPDATE', 
                        payload: { datePickerInfo: null } 
                    })}
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