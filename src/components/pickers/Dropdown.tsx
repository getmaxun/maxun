import React, { useState } from 'react';
import { useSocketStore } from '../../context/socket';
import { Coordinates } from '../recorder/Canvas';

interface DropdownProps {
    coordinates: Coordinates;
    selector: string;
    options: Array<{
        value: string;
        text: string;
        disabled: boolean;
        selected: boolean;
    }>;
    onClose: () => void;
}

const Dropdown = ({ coordinates, selector, options, onClose }: DropdownProps) => {
    const { socket } = useSocketStore();
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

    const updateDOMElement = (selector: string, value: string) => {
        try {
            let iframeElement = document.querySelector('#dom-browser-iframe') as HTMLIFrameElement;
            
            if (!iframeElement) {
                iframeElement = document.querySelector('#browser-window iframe') as HTMLIFrameElement;
            }

            if (!iframeElement) {
                const browserWindow = document.querySelector('#browser-window');
                if (browserWindow) {
                    iframeElement = browserWindow.querySelector('iframe') as HTMLIFrameElement;
                }
            }

            if (!iframeElement) {
                console.error('Could not find iframe element for DOM update');
                return;
            }

            const iframeDoc = iframeElement.contentDocument;
            if (!iframeDoc) {
                console.error('Could not access iframe document');
                return;
            }

            const selectElement = iframeDoc.querySelector(selector) as HTMLSelectElement;
            if (selectElement) {
                selectElement.value = value;
                
                const optionElements = selectElement.querySelectorAll('option');
                optionElements.forEach(option => {
                    if (option.value === value) {
                        option.selected = true;
                        option.setAttribute('selected', 'selected');
                    } else {
                        option.selected = false;
                        option.removeAttribute('selected');
                    }
                });
                
                const changeEvent = new Event('change', { bubbles: true });
                selectElement.dispatchEvent(changeEvent);
                
                const inputEvent = new Event('input', { bubbles: true });
                selectElement.dispatchEvent(inputEvent);
            } else {
                console.warn(`Could not find select element with selector: ${selector}`);
            }
        } catch (error) {
            console.error('Error updating DOM select element:', error);
        }
    };

    const handleSelect = (value: string) => {
        if (socket) {
            socket.emit('input:dropdown', { selector, value });
            
            updateDOMElement(selector, value);
        }
        onClose();
    };

    const containerStyle: React.CSSProperties = {
        position: 'absolute',
        left: coordinates.x,
        top: coordinates.y,
        zIndex: 1000,
        width: '200px',
        backgroundColor: 'white',
        border: '1px solid rgb(169, 169, 169)',
        boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
    };

    const scrollContainerStyle: React.CSSProperties = {
        maxHeight: '180px',
        overflowY: 'auto',
        overflowX: 'hidden',
    };

    const getOptionStyle = (option: any, index: number): React.CSSProperties => ({
        fontSize: '13.333px',
        lineHeight: '18px',
        padding: '0 3px',
        cursor: option.disabled ? 'default' : 'default',
        backgroundColor: hoveredIndex === index ? '#0078D7' :
            option.selected ? '#0078D7' :
                option.disabled ? '#f8f8f8' : 'white',
        color: (hoveredIndex === index || option.selected) ? 'white' :
            option.disabled ? '#a0a0a0' : 'black',
        userSelect: 'none',
    });

    return (
        <div
            className="fixed inset-0"
            onClick={onClose}
        >
            <div
                style={containerStyle}
                onClick={e => e.stopPropagation()}
            >
                <div style={scrollContainerStyle}>
                    {options.map((option, index) => (
                        <div
                            key={index}
                            style={getOptionStyle(option, index)}
                            onMouseEnter={() => !option.disabled && setHoveredIndex(index)}
                            onMouseLeave={() => setHoveredIndex(null)}
                            onClick={() => !option.disabled && handleSelect(option.value)}
                        >
                            {option.text}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default Dropdown;