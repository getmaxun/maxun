import React, { useCallback, useEffect, useRef } from 'react';
import { useSocketStore } from '../../context/socket';
import { useGlobalInfoStore } from "../../context/globalInfo";
import { useActionContext } from '../../context/browserActions';
import DatePicker from '../pickers/DatePicker';
import Dropdown from '../pickers/Dropdown';
import TimePicker from '../pickers/TimePicker';
import DateTimeLocalPicker from '../pickers/DateTimeLocalPicker';

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
                setDatePickerInfo(info);
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
                setDropdownInfo(info);
            });

            socket.on('showTimePicker', (info: { coordinates: Coordinates, selector: string }) => {
                setTimePickerInfo(info);
            });

            socket.on('showDateTimePicker', (info: { coordinates: Coordinates, selector: string }) => {
                setDateTimeLocalInfo(info);
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
                height={400}
                width={900}
                style={{ display: 'block' }}
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


export default Canvas;