import React, { useState } from 'react';
import { useSocketStore } from '../../context/socket';
import { Coordinates } from '../atoms/canvas';

interface DateTimeLocalPickerProps {
  coordinates: Coordinates;
  selector: string;
  onClose: () => void;
}

const DateTimeLocalPicker: React.FC<DateTimeLocalPickerProps> = ({ coordinates, selector, onClose }) => {
  const { socket } = useSocketStore();
  const [selectedDateTime, setSelectedDateTime] = useState<string>('');

  const handleDateTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedDateTime(e.target.value);
  };

  const handleConfirm = () => {
    if (socket && selectedDateTime) {
      socket.emit('input:datetime-local', {
        selector,
        value: selectedDateTime
      });
      onClose();
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: `${coordinates.x}px`,
        top: `${coordinates.y}px`,
        zIndex: 1000,
        backgroundColor: 'white',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        padding: '10px',
        borderRadius: '4px'
      }}
    >
      <div className="flex flex-col space-y-2">
        <input
          type="datetime-local"
          onChange={handleDateTimeChange}
          value={selectedDateTime}
          className="p-2 border rounded"
          autoFocus
        />
        <div className="flex justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800 border rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedDateTime}
            className={`px-3 py-1 text-sm rounded ${selectedDateTime
                ? 'bg-blue-500 text-white hover:bg-blue-600'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

export default DateTimeLocalPicker;