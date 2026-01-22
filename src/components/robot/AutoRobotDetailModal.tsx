import React, { FC } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  TextField,
  Button,
  Divider,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@mui/material';
import { GenericModal } from '../ui/GenericModal';

interface AutoRobotData {
  id: string;
  name: string;
  category?: string;
  description?: string;
  access?: string;
  sample?: any[];
  logo?: string;
  configOptions?: {
    parameters?: Array<{
      id: string;
      label: string;
      type: 'dropdown' | 'search' | 'url' | 'limit' | 'username' | 'path-segment';
      required?: boolean;
      placeholder?: string;
      queryParam: string;
      options?: Array<{ value: string; label: string; }>;
    }>;
  };
}

interface AutoRobotDetailModalProps {
  open: boolean;
  onClose: () => void;
  robot: AutoRobotData | null;
  onUseRobot: (robot: AutoRobotData, config?: { parameters?: { [key: string]: string } }) => void;
}

export const AutoRobotDetailModal: FC<AutoRobotDetailModalProps> = ({ open, onClose, robot, onUseRobot }) => {
  const { t } = useTranslation();

  if (!robot) return null;

  const sampleData = robot.sample || [];

  const columnHeaders = sampleData.length > 0
    ? Object.keys(sampleData[0])
    : [];

  const needsConfiguration = robot.configOptions?.parameters && robot.configOptions.parameters.length > 0;
  const parameters = robot.configOptions?.parameters || [];

  const handleUseRobot = () => {
    onUseRobot(robot);
  };

  return (
    <GenericModal
      isOpen={open}
      onClose={onClose}
      modalStyle={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '800px',
        maxWidth: '90vw',
        height: 'auto',
        maxHeight: '85vh',
        padding: '28px 32px',
        overflow: 'auto',
        backgroundColor: 'background.paper',
        boxShadow: '0px 8px 24px rgba(0, 0, 0, 0.15)',
        borderRadius: '12px',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(128, 128, 128, 0.3) transparent'
      }}
    >
      <Box sx={{ width: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3, mb: 3 }}>
          {robot.logo && (
            <Box
              component="img"
              src={robot.logo}
              alt={`${robot.name} logo`}
              sx={{
                width: 56,
                height: 56,
                objectFit: 'contain',
                flexShrink: 0,
                mt: 0.5,
              }}
            />
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="h4"
              component="h1"
              sx={{
                fontWeight: 600,
                color: 'text.primary',
                fontSize: '1.75rem',
                lineHeight: 1.2,
                mb: 1
              }}
            >
              {robot.name}
            </Typography>
            <Chip
              label={robot.category || t('recordingtable.no_category', 'Uncategorized')}
              size="small"
              color="primary"
              variant="outlined"
              sx={{
                height: '28px',
                fontSize: '0.8rem',
                borderRadius: '14px',
                fontWeight: 500
              }}
            />
          </Box>
        </Box>

        <Box
          sx={{
            mb: 4,
            backgroundColor: 'action.hover',
            borderRadius: '8px',
            p: 3
          }}
        >
          <Typography
            variant="subtitle1"
            sx={{
              mb: 1,
              fontWeight: 600,
              color: 'text.primary',
              display: 'flex',
              alignItems: 'center',
              gap: 1
            }}
          >
            {t('robot.description', 'Description')}
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: 'text.secondary',
              lineHeight: 1.6
            }}
          >
            {robot.description || t('recordingtable.no_description', 'No description available')}
          </Typography>
        </Box>

        <Divider sx={{
          my: 3,
          borderColor: 'divider'
        }} />

        {needsConfiguration && (
          <Box sx={{ mb: 4 }}>
            <Typography
              variant="subtitle1"
              sx={{
                mb: 2,
                fontWeight: 600,
                color: 'text.primary'
              }}
            >
              {t('robot.config.configuration', 'Configuration')}
            </Typography>

            <Typography
              variant="body2"
              sx={{
                mb: 2,
                color: 'text.secondary',
                fontStyle: 'italic'
              }}
            >
              {t('robot.config.info_message', 'The following fields will be required when you use this robot:')}
            </Typography>

            <Stack spacing={3}>
              {parameters.map((param) => {
                if (param.type === 'dropdown') {
                  return (
                    <FormControl 
                      key={param.id} 
                      fullWidth
                      sx={{
                        opacity: 0.7,
                        pointerEvents: 'none'
                      }}
                    >
                      <InputLabel>{param.label}{param.required ? ' *' : ''}</InputLabel>
                      <Select
                        value=""
                        label={`${param.label}${param.required ? ' *' : ''}`}
                        readOnly
                      >
                        {param.options?.map((option) => (
                          <MenuItem key={option.value} value={option.value}>
                            {option.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  );
                }

                if (param.type === 'search') {
                  return (
                    <TextField
                      key={param.id}
                      fullWidth
                      label={`${param.label}${param.required ? ' *' : ''}`}
                      placeholder={param.placeholder}
                      value=""
                      InputProps={{ readOnly: true }}
                      sx={{
                        opacity: 0.7,
                        pointerEvents: 'none'
                      }}
                    />
                  );
                }

                if (param.type === 'url') {
                  return (
                    <TextField
                      key={param.id}
                      fullWidth
                      type="url"
                      label={`${param.label}${param.required ? ' *' : ''}`}
                      placeholder={param.placeholder || 'https://example.com'}
                      value=""
                      InputProps={{ readOnly: true }}
                      sx={{
                        opacity: 0.7,
                        pointerEvents: 'none'
                      }}
                    />
                  );
                }

                if (param.type === 'limit') {
                  return (
                    <TextField
                      key={param.id}
                      fullWidth
                      type="number"
                      label={`${param.label}${param.required ? ' *' : ''}`}
                      placeholder={param.placeholder || '100'}
                      value=""
                      InputProps={{ readOnly: true }}
                      sx={{
                        opacity: 0.7,
                        pointerEvents: 'none'
                      }}
                    />
                  );
                }

                if (param.type === 'username') {
                  return (
                    <TextField
                      key={param.id}
                      fullWidth
                      label={`${param.label}${param.required ? ' *' : ''}`}
                      placeholder={param.placeholder || 'Enter username'}
                      value=""
                      InputProps={{ readOnly: true }}
                      sx={{
                        opacity: 0.7,
                        pointerEvents: 'none'
                      }}
                    />
                  );
                }

                if (param.type === 'path-segment') {
                  return (
                    <TextField
                      key={param.id}
                      fullWidth
                      label={`${param.label}${param.required ? ' *' : ''}`}
                      placeholder={param.placeholder || 'Enter path segment value'}
                      value=""
                      InputProps={{ readOnly: true }}
                      sx={{
                        opacity: 0.7,
                        pointerEvents: 'none'
                      }}
                    />
                  );
                }

                return null;
              })}
            </Stack>
          </Box>
        )}

        {needsConfiguration && (
          <Divider sx={{
            my: 3,
            borderColor: 'divider'
          }} />
        )}

        {sampleData.length > 0 && (
          <Box sx={{ mb: 4 }}>
            <Typography
              variant="subtitle1"
              sx={{
                mb: 2,
                fontWeight: 600,
                color: 'text.primary',
                display: 'flex',
                alignItems: 'center',
                gap: 1
              }}
            >
              {t('robot.sample_output', 'Sample Output')}
            </Typography>
            <Box
              sx={{
                width: '100%',
                borderRadius: '4px',
                overflow: 'auto'
              }}
            >
              <Table size="medium" sx={{ width: '100%' }}>
                <TableHead>
                  <TableRow sx={{ backgroundColor: '#242424' }}>
                    {columnHeaders.map((header, index) => (
                      <TableCell
                        key={index}
                        sx={{
                          fontWeight: 600,
                          color: 'white',
                          borderBottom: 'none',
                          py: 2,
                          px: 2,
                          whiteSpace: 'normal',
                          minWidth: '100px'
                        }}
                      >
                        {header}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sampleData.map((row, rowIndex) => (
                    <TableRow
                      key={rowIndex}
                      sx={{
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        '&:last-child': {
                          borderBottom: 'none'
                        }
                      }}
                    >
                      {columnHeaders.map((header, cellIndex) => (
                        <TableCell
                          key={`${rowIndex}-${cellIndex}`}
                          sx={{
                            py: 2.5,
                            px: 2,
                            color: 'text.secondary',
                            fontWeight: 'inherit',
                            borderBottom: 'none',
                            whiteSpace: 'normal',
                            minWidth: '100px'
                          }}
                        >
                          {row[header] !== null ? (typeof row[header] === 'object' ? JSON.stringify(row[header]) : String(row[header])) : '-'}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Box>
        )}

        <Box sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 2,
          mt: 5,
          mb: 1
        }}>
          <Button
            onClick={onClose}
            variant="outlined"
            sx={{
              color: '#ff00c3 !important',
              borderColor: '#ff00c3 !important',
              backgroundColor: 'white !important',
            }} >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={handleUseRobot}
            variant="contained"
            color="primary"
            sx={{
              borderRadius: '8px',
              px: 3,
              py: 1,
              boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.1)',
              textTransform: 'none',
              fontWeight: 500
            }}
          >
            {t('robot.add_to_my_robots', 'Use this robot')}
          </Button>
        </Box>
      </Box>
    </GenericModal>
  );
};

export default AutoRobotDetailModal;
