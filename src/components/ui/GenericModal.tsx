import React, { FC } from 'react';
import { Modal, IconButton, Box } from '@mui/material';
import { Clear } from "@mui/icons-material";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children?: JSX.Element;
  modalStyle?: React.CSSProperties;
  canBeClosed?: boolean;
}

export const GenericModal: FC<ModalProps> = (
  { isOpen, onClose, children, modalStyle, canBeClosed = true }) => {

  return (
    <Modal open={isOpen} onClose={canBeClosed ? onClose : () => { }} >
      <Box sx={modalStyle ? { ...modalStyle, boxShadow: 24, position: 'absolute', borderRadius: 5 } : defaultModalStyle}>
        {canBeClosed ?
          <IconButton onClick={onClose} sx={{ float: "right" }}>
            <Clear sx={{ fontSize: 20 }} />
          </IconButton>
          : null
        }
        {children}
      </Box>
    </Modal>
  );
};

const defaultModalStyle = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 1000,
  bgcolor: 'background.paper',
  boxShadow: 24,
  p: 4,
  height: '50%',
  display: 'block',
  overflow: 'scroll',
  padding: '5px 25px 10px 25px',
  zIndex: 3147483647,
  borderRadius: 4, // Added borderRadius for rounded corners
};