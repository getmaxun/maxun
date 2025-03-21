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
    const { socket } = useSocketStore();
    const { setLastAction, lastAction } = useGlobalInfoStore();
    const { getText, getList } = useActionContext();
    const getTextRef = useRef(getText);
    const getListRef = useRef(getList);

    const MOUSE_MOVE_THROTTLE = 16; // ~60fps
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
        getTextRef.current = getText;
        getListRef.current = getList;
    }, [getText, getList]);

    useEffect(() => {
        if (socket) {
            socket.on('showDatePicker', (info: { coordinates: Coordinates, selector: string }) => {
                const canvasCoords = coordinateMapper.mapBrowserToCanvas(info.coordinates);
                setDatePickerInfo({
                    ...info,
                    coordinates: canvasCoords
                });
            });

            socket.on('showDropdown', (info: {
                coordinates: Coordinates,
                selector: string,
                options: Array<{
                    value: string;
                    text: string;
                    disabled: boolean;
                    selected: boolean;
                }>;
            }) => {
                const canvasCoords = coordinateMapper.mapBrowserToCanvas(info.coordinates);
                setDropdownInfo({
                    ...info,
                    coordinates: canvasCoords
                });
            });

            socket.on('showTimePicker', (info: { coordinates: Coordinates, selector: string }) => {
                const canvasCoords = coordinateMapper.mapBrowserToCanvas(info.coordinates);
                setTimePickerInfo({
                    ...info,
                    coordinates: canvasCoords
                });
            });

            socket.on('showDateTimePicker', (info: { coordinates: Coordinates, selector: string }) => {
                const canvasCoords = coordinateMapper.mapBrowserToCanvas(info.coordinates);
                setDateTimeLocalInfo({
                    ...info,
                    coordinates: canvasCoords
                });
            });

            return () => {
                socket.off('showDatePicker');
                socket.off('showDropdown');
                socket.off('showTimePicker');
                socket.off('showDateTimePicker');
            };
        }
    }, [socket]);

    const onMouseEvent = useCallback((event: MouseEvent) => {
        if (socket && canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect();
            const clickCoordinates = {
                x: event.clientX - rect.left, // Use relative x coordinate
                y: event.clientY - rect.top, // Use relative y coordinate
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
                    if (dx > 1 || dy > 1) {
                        lastMousePosition.current = {
                            x: clickCoordinates.x,
                            y: clickCoordinates.y,
                        };
                        socket.emit('input:mousemove', browserCoordinates);
                        notifyLastAction('move');
                    }
                    break;
                }
                
                // Optimize wheel events
                case 'wheel': {
                    const wheelEvent = event as WheelEvent;
                    const deltaX = Math.round(wheelEvent.deltaX / 10) * 10;
                    const deltaY = Math.round(wheelEvent.deltaY / 10) * 10;
                    
                    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                        socket.emit('input:wheel', { deltaX, deltaY });
                        notifyLastAction('scroll');
                    }
                    break;
                }
                default:
                    console.log('Default mouseEvent registered');
                    return;
            }
        }
    }, [socket]);

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
                height={height}
                width={width}
                style={{ 
                    display: 'block',
                    imageRendering: 'crisp-edges', 
                    willChange: 'transform', 
                    transform: 'translateZ(0)' 
                }}
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