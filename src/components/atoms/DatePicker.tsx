import React, { useState } from 'react';
import { useSocketStore } from '../../context/socket';
import { Coordinates } from './canvas';

interface DatePickerProps {
  coordinates: Coordinates;
  selector: string;
  onClose: () => void;
}

const DatePicker: React.FC<DatePickerProps> = ({ coordinates, selector, onClose }) => {
  const { socket } = useSocketStore();
  const [selectedDate, setSelectedDate] = useState<string>('');

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedDate(e.target.value);
  };

  const handleConfirm = () => {
    if (socket && selectedDate) {
      socket.emit('input:date', {
        selector,
        value: selectedDate
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
          type="date"
          onChange={handleDateChange}
          value={selectedDate}
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
            disabled={!selectedDate}
            className={`px-3 py-1 text-sm rounded ${
              selectedDate 
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

export default DatePicker;