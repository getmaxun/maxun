import React, { useState } from 'react';
import { useSocketStore } from '../../context/socket';
import { Coordinates } from './canvas';

interface TimePickerProps {
    coordinates: Coordinates;
    selector: string;
    onClose: () => void;
}

const TimePicker = ({ coordinates, selector, onClose }: TimePickerProps) => {
    const { socket } = useSocketStore();
    const [hoveredHour, setHoveredHour] = useState<number | null>(null);
    const [hoveredMinute, setHoveredMinute] = useState<number | null>(null);
    const [selectedHour, setSelectedHour] = useState<number | null>(null);
    const [selectedMinute, setSelectedMinute] = useState<number | null>(null);

    const handleHourSelect = (hour: number) => {
        setSelectedHour(hour);
        // If minute is already selected, complete the selection
        if (selectedMinute !== null) {
            const formattedHour = hour.toString().padStart(2, '0');
            const formattedMinute = selectedMinute.toString().padStart(2, '0');
            if (socket) {
                socket.emit('input:time', {
                    selector,
                    value: `${formattedHour}:${formattedMinute}`
                });
            }
            onClose();
        }
    };

    const handleMinuteSelect = (minute: number) => {
        setSelectedMinute(minute);
        // If hour is already selected, complete the selection
        if (selectedHour !== null) {
            const formattedHour = selectedHour.toString().padStart(2, '0');
            const formattedMinute = minute.toString().padStart(2, '0');
            if (socket) {
                socket.emit('input:time', {
                    selector,
                    value: `${formattedHour}:${formattedMinute}`
                });
            }
            onClose();
        }
    };

    const containerStyle: React.CSSProperties = {
        position: 'absolute',
        left: coordinates.x,
        top: coordinates.y,
        zIndex: 1000,
        display: 'flex',
        backgroundColor: 'white',
        border: '1px solid rgb(169, 169, 169)',
        boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
    };

    const columnStyle: React.CSSProperties = {
        width: '60px',
        maxHeight: '180px',
        overflowY: 'auto',
        overflowX: 'hidden',
        borderRight: '1px solid rgb(169, 169, 169)',
    };

    const getOptionStyle = (value: number, isHour: boolean): React.CSSProperties => {
        const isHovered = isHour ? hoveredHour === value : hoveredMinute === value;
        const isSelected = isHour ? selectedHour === value : selectedMinute === value;

        return {
            fontSize: '13.333px',
            lineHeight: '18px',
            padding: '0 3px',
            cursor: 'default',
            backgroundColor: isSelected ? '#0078D7' : isHovered ? '#0078D7' : 'white',
            color: (isSelected || isHovered) ? 'white' : 'black',
            userSelect: 'none',
        };
    };

    const hours = Array.from({ length: 24 }, (_, i) => i);
    const minutes = Array.from({ length: 60 }, (_, i) => i);

    return (
        <div
            className="fixed inset-0"
            onClick={onClose}
        >
            <div
                style={containerStyle}
                onClick={e => e.stopPropagation()}
            >
                {/* Hours column */}
                <div style={columnStyle}>
                    {hours.map((hour) => (
                        <div
                            key={hour}
                            style={getOptionStyle(hour, true)}
                            onMouseEnter={() => setHoveredHour(hour)}
                            onMouseLeave={() => setHoveredHour(null)}
                            onClick={() => handleHourSelect(hour)}
                        >
                            {hour.toString().padStart(2, '0')}
                        </div>
                    ))}
                </div>

                {/* Minutes column */}
                <div style={{ ...columnStyle, borderRight: 'none' }}>
                    {minutes.map((minute) => (
                        <div
                            key={minute}
                            style={getOptionStyle(minute, false)}
                            onMouseEnter={() => setHoveredMinute(minute)}
                            onMouseLeave={() => setHoveredMinute(null)}
                            onClick={() => handleMinuteSelect(minute)}
                        >
                            {minute.toString().padStart(2, '0')}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default TimePicker;