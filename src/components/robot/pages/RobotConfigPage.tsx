import React from 'react';
import { 
  Box, 
  Typography, 
  Button, 
  IconButton,
  Divider,
  useTheme
} from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';

interface RobotConfigPageProps {
  title: string;
  children: React.ReactNode;
  onSave?: () => void;
  onCancel?: () => void;
  saveButtonText?: string;
  cancelButtonText?: string;
  showSaveButton?: boolean;
  showCancelButton?: boolean;
  isLoading?: boolean;
  icon?: React.ReactNode;
  onBackToSelection?: () => void;
  backToSelectionText?: string;
}

export const RobotConfigPage: React.FC<RobotConfigPageProps> = ({
  title,
  children,
  onSave,
  onCancel,
  saveButtonText = "Save",
  cancelButtonText = "Cancel",
  showSaveButton = true,
  showCancelButton = true,
  isLoading = false,
  icon,
  onBackToSelection,
  backToSelectionText = "← Back"
}) => {
  const theme = useTheme();

  const handleBack = () => {
    if (onCancel) {
      onCancel();
    }
  };

  return (
    <Box sx={{ 
      maxWidth: 1000, 
      margin: 'auto', 
      px: 4,
      py: 3,
      minHeight: '80vh',
      display: 'flex',
      flexDirection: 'column',
      width: '1000px',
    }}>
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        minHeight: '64px',
        mb: 2,
        flexShrink: 0
      }}>
        <IconButton
          onClick={handleBack}
          sx={{
            mr: 2,
            color: theme.palette.text.primary,
            '&:hover': {
              bgcolor: theme.palette.action.hover
            }
          }}
        >
          <ArrowBack />
        </IconButton>
        {icon && (
          <Box sx={{ mr: 2, color: theme.palette.text.primary }}>
            {icon}
          </Box>
        )}
        <Typography 
          variant="h4" 
          sx={{ 
            fontWeight: 600,
            color: theme.palette.text.primary,
            lineHeight: 1.2
          }}
        >
          {title}
        </Typography>
      </Box>
      <Divider sx={{ mb: 4, flexShrink: 0 }} />

      <Box sx={{ 
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }}>
        {children}
      </Box>

      {(showSaveButton || showCancelButton || onBackToSelection) && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: onBackToSelection ? 'space-between' : 'flex-end',
            gap: 2,
            pt: 3,
            mt: 2,
            borderTop: `1px solid ${theme.palette.divider}`,
            flexShrink: 0,
            width: '100%',
            px: 3
          }}
        >
          {onBackToSelection && (
            <Button
              variant="outlined"
              onClick={onBackToSelection}
              disabled={isLoading}
              sx={{
                color: '#ff00c3 !important',
                borderColor: '#ff00c3 !important',
                backgroundColor: 'white !important',
              }} >
              {backToSelectionText}
            </Button>
          )}

          <Box sx={{ display: 'flex', gap: 2 }}>
          {showCancelButton && (
            <Button
              variant="outlined"
              onClick={handleBack}
              disabled={isLoading}
              sx={{
                color: '#ff00c3 !important',
                borderColor: '#ff00c3 !important',
                backgroundColor: 'white !important',
              }} >
              {cancelButtonText}
            </Button>
          )}
          {showSaveButton && onSave && (
            <Button
              variant="contained"
              onClick={onSave}
              disabled={isLoading}
              sx={{
                bgcolor: '#ff00c3',
                '&:hover': {
                  bgcolor: '#cc0099',
                  boxShadow: 'none',
                },
                textTransform: 'none',
                fontWeight: 500,
                px: 3,
                boxShadow: 'none',
              }}
            >
              {isLoading ? 'Saving...' : saveButtonText}
            </Button>
          )}
          </Box>
        </Box>
      )}
    </Box>
  );
};