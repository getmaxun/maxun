import * as React from 'react';
import Box from '@mui/material/Box';

interface BoxProps {
  width: number | string,
  height: number | string,
  background: string,
  radius: string,
  children?: JSX.Element,
};

export const SimpleBox = ({ width, height, background, radius, children }: BoxProps) => {
  return (
    <Box
      sx={{
        width: width,
        height: height,
        backgroundColor: background,
        borderRadius: radius,
      }}
    >
      {children}
    </Box>
  );
}
