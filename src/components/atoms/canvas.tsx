import React, { useCallback, useEffect, useRef, useMemo, Suspense } from 'react';
import { useSocketStore } from '../../context/socket';
import { useGlobalInfoStore } from "../../context/globalInfo";
import { useActionContext } from '../../context/browserActions';
import { FrontendPerformanceMonitor } from '../../../perf/performance';

const DatePicker = React.lazy(() => import('./DatePicker'));
const Dropdown = React.lazy(() => import('./Dropdown'));
const TimePicker = React.lazy(() => import('./TimePicker'));
const DateTimeLocalPicker = React.lazy(() => import('./DateTimeLocalPicker'));

class RAFScheduler {
    private queue: Set<() => void> = new Set();
    private isProcessing: boolean = false;
    private frameId: number | null = null;

    schedule(callback: () => void): void {
        this.queue.add(callback);
        if (!this.isProcessing) {
            this.process();
        }
    }

    private process = (): void => {
        this.isProcessing = true;
        this.frameId = requestAnimationFrame(() => {
            const callbacks = Array.from(this.queue);
            this.queue.clear();
            
            callbacks.forEach(callback => {
                try {
                    callback();
                } catch (error) {
                    console.error('RAF Scheduler error:', error);
                }
            });

            this.isProcessing = false;
            this.frameId = null;
            
            if (this.queue.size > 0) {
                this.process();
            }
        });
    }

    clear(): void {
        this.queue.clear();
        if (this.frameId !== null) {
            cancelAnimationFrame(this.frameId);
            this.frameId = null;
        }
        this.isProcessing = false;
    }
}

class EventDebouncer {
    private highPriorityQueue: Array<() => void> = [];
    private lowPriorityQueue: Array<() => void> = [];
    private processing: boolean = false;
    private scheduler: RAFScheduler;

    constructor(scheduler: RAFScheduler) {
        this.scheduler = scheduler;
    }

    add(callback: () => void, highPriority: boolean = false): void {
        if (highPriority) {
            this.highPriorityQueue.push(callback);
        } else {
            this.lowPriorityQueue.push(callback);
        }

        if (!this.processing) {
            this.process();
        }
    }

    private process(): void {
        this.processing = true;
        this.scheduler.schedule(() => {
            while (this.highPriorityQueue.length > 0) {
                const callback = this.highPriorityQueue.shift();
                callback?.();
            }

            if (this.lowPriorityQueue.length > 0) {
                const callback = this.lowPriorityQueue.shift();
                callback?.();
                
                if (this.lowPriorityQueue.length > 0) {
                    this.process();
                }
            }
            
            this.processing = false;
        });
    }

    clear(): void {
        this.highPriorityQueue = [];
        this.lowPriorityQueue = [];
        this.processing = false;
    }
}

// Optimized measurement cache with LRU
class MeasurementCache {
    private cache: Map<HTMLElement, DOMRect>;
    private maxSize: number;

    constructor(maxSize: number = 100) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }

    get(element: HTMLElement): DOMRect | undefined {
        const cached = this.cache.get(element);
        if (cached) {
            // Refresh the entry
            this.cache.delete(element);
            this.cache.set(element, cached);
        }
        return cached;
    }

    set(element: HTMLElement, rect: DOMRect): void {
        if (this.cache.size >= this.maxSize) {
            // Remove oldest entry
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }
        this.cache.set(element, rect);
    }

    clear(): void {
        this.cache.clear();
    }
}

interface CanvasProps {
    width: number;
    height: number;
    onCreateRef: (ref: React.RefObject<HTMLCanvasElement>) => void;
}

const Canvas = React.memo(({ width, height, onCreateRef }: CanvasProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { socket } = useSocketStore();
    const { setLastAction } = useGlobalInfoStore();
    const { getText, getList } = useActionContext();

    const scheduler = useRef(new RAFScheduler());
    const debouncer = useRef(new EventDebouncer(scheduler.current));
    const measurementCache = useRef(new MeasurementCache(50));
    const performanceMonitor = useRef(new FrontendPerformanceMonitor());

    const refs = useRef({
        getText,
        getList,
        lastMousePosition: { x: 0, y: 0 },
        lastFrameTime: 0,
        context: null as CanvasRenderingContext2D | null,
    });

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

    const getEventCoordinates = useCallback((event: MouseEvent): { x: number; y: number } => {
        if (!canvasRef.current) return { x: 0, y: 0 };

        let rect = measurementCache.current.get(canvasRef.current);
        if (!rect) {
            rect = canvasRef.current.getBoundingClientRect();
            measurementCache.current.set(canvasRef.current, rect);
        }

        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
    }, []);

    const handleMouseEvent = useCallback((event: MouseEvent) => {
        if (!socket || !canvasRef.current) return;

        performanceMonitor.current.measureEventLatency(event);
        const coordinates = getEventCoordinates(event);

        switch (event.type) {
            case 'mousedown':
                debouncer.current.add(() => {
                    if (refs.current.getText) {
                        console.log('Capturing Text...');
                    } else if (refs.current.getList) {
                        console.log('Capturing List...');
                    } else {
                        socket.emit('input:mousedown', coordinates);
                    }
                    setLastAction('click');
                }, true); // High priority
                break;

            case 'mousemove':
                if (refs.current.lastMousePosition.x !== coordinates.x ||
                    refs.current.lastMousePosition.y !== coordinates.y) {
                    debouncer.current.add(() => {
                        refs.current.lastMousePosition = coordinates;
                        socket.emit('input:mousemove', coordinates);
                        setLastAction('move');
                    });
                }
                break;

            case 'wheel':
                const wheelEvent = event as WheelEvent;
                debouncer.current.add(() => {
                    socket.emit('input:wheel', {
                        deltaX: Math.round(wheelEvent.deltaX),
                        deltaY: Math.round(wheelEvent.deltaY)
                    });
                    setLastAction('scroll');
                });
                break;
        }
    }, [socket, getEventCoordinates]);

    const handleKeyboardEvent = useCallback((event: KeyboardEvent) => {
        if (!socket) return;

        debouncer.current.add(() => {
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
        }, event.type === 'keydown'); // High priority for keydown
    }, [socket]);

    // Setup and cleanup
    useEffect(() => {
        if (!canvasRef.current) return;

        const canvas = canvasRef.current;
        refs.current.context = canvas.getContext('2d', {
            alpha: false,
            desynchronized: true
        });

        onCreateRef(canvasRef);

        const options = { passive: true };
        canvas.addEventListener('mousedown', handleMouseEvent, options);
        canvas.addEventListener('mousemove', handleMouseEvent, options);
        canvas.addEventListener('wheel', handleMouseEvent, options);
        canvas.addEventListener('keydown', handleKeyboardEvent, options);
        canvas.addEventListener('keyup', handleKeyboardEvent, options);

        return () => {
            canvas.removeEventListener('mousedown', handleMouseEvent);
            canvas.removeEventListener('mousemove', handleMouseEvent);
            canvas.removeEventListener('wheel', handleMouseEvent);
            canvas.removeEventListener('keydown', handleKeyboardEvent);
            canvas.removeEventListener('keyup', handleKeyboardEvent);
            
            scheduler.current.clear();
            debouncer.current.clear();
            measurementCache.current.clear();
        };
    }, [handleMouseEvent, handleKeyboardEvent, onCreateRef]);

    // Performance monitoring
    useEffect(() => {
        const intervalId = setInterval(() => {
            console.log('Performance Report:', performanceMonitor.current.getPerformanceReport());
        }, 20000);

        return () => clearInterval(intervalId);
    }, []);

    useEffect(() => {
        if (!socket) return;

        const handlers = {
            showDatePicker: (info: any) => dispatch({ type: 'BATCH_UPDATE', payload: { datePickerInfo: info } }),
            showDropdown: (info: any) => dispatch({ type: 'BATCH_UPDATE', payload: { dropdownInfo: info } }),
            showTimePicker: (info: any) => dispatch({ type: 'BATCH_UPDATE', payload: { timePickerInfo: info } }),
            showDateTimePicker: (info: any) => dispatch({ type: 'BATCH_UPDATE', payload: { dateTimeLocalInfo: info } })
        };

        Object.entries(handlers).forEach(([event, handler]) => socket.on(event, handler));
        return () => {
            Object.keys(handlers).forEach(event => socket.off(event));
        };
    }, [socket]);

    const memoizedDimensions = useMemo(() => ({
        width: width || 900,
        height: height || 400
    }), [width, height]);

    return (
        <div className="relative bg-white rounded-b-md overflow-hidden">
            <canvas
                tabIndex={0}
                ref={canvasRef}
                height={memoizedDimensions.height}
                width={memoizedDimensions.width}
                className="block"
            />
            <Suspense fallback={null}>
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
            </Suspense>
        </div>
    );
});

Canvas.displayName = 'Canvas';

export default Canvas;