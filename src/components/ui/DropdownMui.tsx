import React from 'react';
import { FormControl, InputLabel, Select } from "@mui/material";
import { SelectChangeEvent } from "@mui/material/Select/Select";
import { SxProps } from '@mui/system';

interface DropdownProps {
  id: string;
  label: string;
  value: string | undefined;
  handleSelect: (event: SelectChangeEvent) => void;
  children?: React.ReactNode;
  sx?: SxProps;
};

export const Dropdown = ({ id, label, value, handleSelect, children, sx }: DropdownProps) => {
  return (
    <FormControl sx={sx} size="small">
      <InputLabel id={id}>{label}</InputLabel>
      <Select
        labelId={id}
        name={id}
        value={value}
        label={label}
        onChange={handleSelect}
        size='small'
        sx={sx}
      >
        {children}
      </Select>
    </FormControl>
  );
};
