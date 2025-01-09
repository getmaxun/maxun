import React from 'react';
import { Box, Button, IconButton, Stack, Typography } from "@mui/material";

interface ConfirmationBoxProps {
  selector: string;
  onYes: () => void;
  onNo: () => void;
}

export const ConfirmationBox = ({ selector, onYes, onNo }: ConfirmationBoxProps) => {
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography variant="h6" component="h2" gutterBottom>
        Confirmation
      </Typography>
      <Typography variant="body1" gutterBottom>
        Do you want to interact with the element: {selector}?
      </Typography>
      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center', gap: 2 }}>
        <Button variant="contained" color="primary" onClick={onYes}>
          Yes
        </Button>
        <Button variant="contained" color="secondary" onClick={onNo}>
          No
        </Button>
      </Box>
    </Box>
  );
};