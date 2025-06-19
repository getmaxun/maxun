import React, { memo, useCallback, useEffect, useRef } from 'react';
import { useSocketStore } from '../../context/socket';
import { useGlobalInfoStore } from "../../context/globalInfo";
import { useActionContext } from '../../context/browserActions';
import DatePicker from '../pickers/DatePicker';
import Dropdown from '../pickers/Dropdown';
import TimePicker from '../pickers/TimePicker';
import DateTimeLocalPicker from '../pickers/DateTimeLocalPicker';
import { coordinateMapper } from '../../helpers/coordinateMapper';

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
    const contextRef = useRef<CanvasRenderingContext2D | null>(null);
    const imageDataRef = useRef<ImageData | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    const { socket } = useSocketStore();
    const { setLastAction, lastAction } = useGlobalInfoStore();
    const { getText, getList } = useActionContext();
    const getTextRef = useRef(getText);
    const getListRef = useRef(getList);

    const MOUSE_MOVE_THROTTLE = 8;
    const lastMouseMoveTime = useRef(0);

    const [datePickerInfo, setDatePickerInfo] = React.useState<{
        coordinates: Coordinates;
        selector: string;
    } | null>(null);

    const [dropdownInfo, setDropdownInfo] = React.useState<{
        coordinates: Coordinates;
        selector: string;
        options: Array<{
            value: string;
            text: string;
            disabled: boolean;
            selected: boolean;
        }>;
    } | null>(null);

    const [timePickerInfo, setTimePickerInfo] = React.useState<{
        coordinates: Coordinates;
        selector: string;
    } | null>(null);

    const [dateTimeLocalInfo, setDateTimeLocalInfo] = React.useState<{
        coordinates: Coordinates;
        selector: string;
    } | null>(null);

    const notifyLastAction = (action: string) => {
        if (lastAction !== action) {
            setLastAction(action);
        }
    };

    const lastMousePosition = useRef<Coordinates>({ x: 0, y: 0 });

    useEffect(() => {
        if (canvasRef.current && !contextRef.current) {
            const ctx = canvasRef.current.getContext('2d', {
                alpha: false,           
                desynchronized: true,   
                willReadFrequently: false 
            });
            
            if (ctx) {                
                contextRef.current = ctx;
                
                imageDataRef.current = ctx.createImageData(width, height);
            }
        }
    }, [width, height]);

    useEffect(() => {
        getTextRef.current = getText;
        getListRef.current = getList;
    }, [getText, getList]);

    useEffect(() => {
        if (socket) {
            const handleDatePicker = (info: { coordinates: Coordinates, selector: string }) => {
                const canvasCoords = coordinateMapper.mapBrowserToCanvas(info.coordinates);
                setDatePickerInfo({ ...info, coordinates: canvasCoords });
            };

            const handleDropdown = (info: {
                coordinates: Coordinates,
                selector: string,
                options: Array<{ value: string; text: string; disabled: boolean; selected: boolean; }>;
            }) => {
                const canvasCoords = coordinateMapper.mapBrowserToCanvas(info.coordinates);
                setDropdownInfo({ ...info, coordinates: canvasCoords });
            };

            const handleTimePicker = (info: { coordinates: Coordinates, selector: string }) => {
                const canvasCoords = coordinateMapper.mapBrowserToCanvas(info.coordinates);
                setTimePickerInfo({ ...info, coordinates: canvasCoords });
            };

            const handleDateTimePicker = (info: { coordinates: Coordinates, selector: string }) => {
                const canvasCoords = coordinateMapper.mapBrowserToCanvas(info.coordinates);
                setDateTimeLocalInfo({ ...info, coordinates: canvasCoords });
            };

            socket.on('showDatePicker', handleDatePicker);
            socket.on('showDropdown', handleDropdown);
            socket.on('showTimePicker', handleTimePicker);
            socket.on('showDateTimePicker', handleDateTimePicker);

            return () => {
                socket.off('showDatePicker', handleDatePicker);
                socket.off('showDropdown', handleDropdown);
                socket.off('showTimePicker', handleTimePicker);
                socket.off('showDateTimePicker', handleDateTimePicker);
            };
        }
    }, [socket]);

    const onMouseEvent = useCallback((event: MouseEvent) => {
        if (!socket || !canvasRef.current) return;

        const rect = canvasRef.current.getBoundingClientRect();
        const clickCoordinates = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };

        const browserCoordinates = coordinateMapper.mapCanvasToBrowser(clickCoordinates);

        switch (event.type) {
            case 'mousedown':
                if (getTextRef.current === true) {
                    console.log('Capturing Text...');
                } else if (getListRef.current === true) {
                    console.log('Capturing List...');
                } else {
                    socket.emit('input:mousedown', browserCoordinates);
                }
                notifyLastAction('click');
                break;
                
            case 'mousemove': {
                const now = performance.now();
                if (now - lastMouseMoveTime.current < MOUSE_MOVE_THROTTLE) {
                    return; 
                }
                lastMouseMoveTime.current = now;
                
                const dx = Math.abs(lastMousePosition.current.x - clickCoordinates.x);
                const dy = Math.abs(lastMousePosition.current.y - clickCoordinates.y);
                
                if (dx > 0.5 || dy > 0.5) {
                    lastMousePosition.current = clickCoordinates;
                    socket.emit('input:mousemove', browserCoordinates);
                    notifyLastAction('move');
                }
                break;
            }
            
            case 'wheel': {
                const wheelEvent = event as WheelEvent;
                const deltaX = Math.round(wheelEvent.deltaX / 5) * 5;
                const deltaY = Math.round(wheelEvent.deltaY / 5) * 5;
                
                if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
                    socket.emit('input:wheel', { deltaX, deltaY });
                    notifyLastAction('scroll');
                }
                break;
            }
            default:
                return;
        }
    }, [socket, notifyLastAction]);

    const onKeyboardEvent = useCallback((event: KeyboardEvent) => {
        if (socket) {
            const browserCoordinates = coordinateMapper.mapCanvasToBrowser(lastMousePosition.current);

            switch (event.type) {
                case 'keydown':
                    socket.emit('input:keydown', { key: event.key, coordinates: browserCoordinates });
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
    }, [socket, notifyLastAction]);


    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        onCreateRef(canvasRef);

        const options = { passive: true };
        
        canvas.addEventListener('mousedown', onMouseEvent, options);
        canvas.addEventListener('mousemove', onMouseEvent, options);
        canvas.addEventListener('wheel', onMouseEvent, options);
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

    useEffect(() => {
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, []);

    const containerStyle = React.useMemo<React.CSSProperties>(() => ({
        borderRadius: '0px 0px 5px 5px',
        overflow: 'hidden',
        backgroundColor: 'white',
        contain: 'layout style paint', 
        isolation: 'isolate' as React.CSSProperties['isolation'] 
    }), []);

    const canvasStyle = React.useMemo(() => ({
        display: 'block',
        imageRendering: 'crisp-edges' as const,
        willChange: 'contents', 
        backfaceVisibility: 'hidden' as const, 
        transform: 'translateZ(0)', 
        maxWidth: '100%',
        maxHeight: '100%'
    }), []);

    return (
        <div style={containerStyle}>
            <canvas
                tabIndex={0}
                ref={canvasRef}
                height={height}
                width={width}
                style={canvasStyle}
            />
            {datePickerInfo && (
                <DatePicker
                    coordinates={datePickerInfo.coordinates}
                    selector={datePickerInfo.selector}
                    onClose={() => setDatePickerInfo(null)}
                />
            )}
            {dropdownInfo && (
                <Dropdown
                    coordinates={dropdownInfo.coordinates}
                    selector={dropdownInfo.selector}
                    options={dropdownInfo.options}
                    onClose={() => setDropdownInfo(null)}
                />
            )}
            {timePickerInfo && (
                <TimePicker
                    coordinates={timePickerInfo.coordinates}
                    selector={timePickerInfo.selector}
                    onClose={() => setTimePickerInfo(null)}
                />
            )}
            {dateTimeLocalInfo && (
                <DateTimeLocalPicker
                    coordinates={dateTimeLocalInfo.coordinates}
                    selector={dateTimeLocalInfo.selector}
                    onClose={() => setDateTimeLocalInfo(null)}
                />
            )}
        </div>
    );

};


export default memo(Canvas);