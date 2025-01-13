import * as React from 'react';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert, { AlertProps } from '@mui/material/Alert';
import { useGlobalInfoStore } from "../../context/globalInfo";

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(function Alert(
  props,
  ref,
) {
  return <MuiAlert elevation={6} ref={ref} variant="filled" {...props} />;
});

export interface AlertSnackbarProps {
  severity: 'error' | 'warning' | 'info' | 'success',
  message: string,
  isOpen: boolean,
};

export const AlertSnackbar = ({ severity, message, isOpen }: AlertSnackbarProps) => {
  const [open, setOpen] = React.useState(isOpen);

  const { closeNotify } = useGlobalInfoStore();

  const handleClose = (event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') {
      return;
    }

    closeNotify();
    setOpen(false);
  };

  return (
    <Snackbar anchorOrigin={{ vertical: 'top', horizontal: 'center' }} open={open} autoHideDuration={5000} onClose={handleClose}>
      <Alert onClose={handleClose} severity={severity} sx={{ width: '100%' }}>
        {message}
      </Alert>
    </Snackbar>
  );
}
