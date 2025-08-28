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
import { useTranslation } from 'react-i18next';

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
  onArrowBack?: () => void; // Optional prop for custom back action
}

export const RobotConfigPage: React.FC<RobotConfigPageProps> = ({
  title,
  children,
  onSave,
  onCancel,
  saveButtonText,
  cancelButtonText,
  showSaveButton = true,
  showCancelButton = true,
  isLoading = false,
  icon,
  onBackToSelection,
  backToSelectionText,
  onArrowBack,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const { t } = useTranslation();

  const handleBack = () => {
    if (onCancel) {
      onCancel();
    } else {
      // Try to determine the correct path based on current URL
      const currentPath = location.pathname;
      const basePath = currentPath.includes('/prebuilt-robots') ? '/prebuilt-robots' : '/robots';
      navigate(basePath);
    }
  };

  return (
    <Box sx={{
      maxWidth: 1000,
      margin: '50px auto',
      maxHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      width: '1000px',
      height: '100%',
      overflowY: 'auto', // Allow scrolling if content exceeds height
    }}>
      {/* Header Section - Fixed Position */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        maxHeight: '64px',
        mb: 2,
        flexShrink: 0
      }}>
        <IconButton
          onClick={onArrowBack ? onArrowBack : handleBack}
          sx={{
            ml: -1,
            mr: 1,
            color: theme.palette.text.primary,
            backgroundColor: 'transparent !important',
            '&:hover': {
              backgroundColor: 'transparent !important',
            },
            '&:active': {
              backgroundColor: 'transparent !important',
            },
            '&:focus': {
              backgroundColor: 'transparent !important',
            },
            '&:focus-visible': {
              backgroundColor: 'transparent !important',
            },
          }}
          disableRipple
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

      {/* Content Section */}
      <Box sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        mt: 2,
        mb: 3,
      }}>
        {children}
      </Box>

      {/* Action Buttons */}
      {(showSaveButton || showCancelButton || onBackToSelection) && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: onBackToSelection ? 'space-between' : 'flex-start',
            gap: 2,
            pt: 3, // Reduce padding top to minimize space above
            borderTop: `1px solid ${theme.palette.divider}`,
            flexShrink: 0,
            width: '100%',
          }}
        >
          {/* Left side - Back to Selection button */}
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
              {backToSelectionText || t("buttons.back_arrow")}
            </Button>
          )}

          {/* Right side - Save/Cancel buttons */}
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
                {cancelButtonText || t("buttons.cancel")}
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
                {isLoading ? t("buttons.saving") : (saveButtonText || t("buttons.save"))}
              </Button>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};