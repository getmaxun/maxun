import React, { memo, useState, useMemo, useEffect, FC } from "react";
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  TextField,
  Card,
  CardContent,
  Grid,
  InputAdornment,
  Divider,
  Chip,
  Pagination,
  Button,
} from "@mui/material";
import { Search as SearchIcon } from "@mui/icons-material";
import { GenericModal } from "../ui/GenericModal";
import { AutoRobotDetailModal } from "./AutoRobotDetailModal";
import { AUTO_ROBOTS } from "../../constants/autoRobots";

interface Data {
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

interface RecordingCardProps {
  row: Data;
  onUseRobot: (robot: Data) => void;
}

const RecordingCard: FC<RecordingCardProps> = memo(({ row, onUseRobot }) => {
  const { t } = useTranslation();

  const isPremium = row.access === 'premium';

  return (
    <Card
      sx={{
        height: "100%",
        display: 'flex',
        flexDirection: 'column',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
        },
        borderRadius: 2,
        overflow: 'visible',
        position: 'relative'
      }}
    >
      {isPremium && (
        <Chip
          label="Premium"
          size="small"
          color="secondary"
          sx={{
            position: 'absolute',
            top: 10,
            right: 10,
            backgroundColor: '#ff00c3',
            color: 'white',
            fontWeight: 'bold',
            height: '24px',
            fontSize: '0.7rem',
            zIndex: 1
          }}
        />
      )}

      <CardContent
        sx={{
          p: 3,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}
      >
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 2 }}>
            {row.logo && (
              <Box
                component="img"
                src={row.logo}
                alt={`${row.name} logo`}
                sx={{
                  width: 48,
                  height: 48,
                  objectFit: 'contain',
                  flexShrink: 0,
                  mt: 0.25,
                }}
              />
            )}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                variant="h6"
                component="h2"
                sx={{
                  fontWeight: 600,
                  mb: 0.5,
                  color: theme => theme.palette.text.primary,
                  lineHeight: 1.2,
                  height: '2.4em',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {row.name}
              </Typography>
            </Box>
          </Box>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              height: '4.5em',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginTop: '18px',
              fontSize: '16px',
              lineHeight: 1.5
            }}
          >
            {row.description || t('recordingtable.no_description')}
          </Typography>
        </Box>

        <Box>
          <Divider sx={{ mb: 2 }} />
          <Button
            variant="contained"
            color="primary"
            onClick={() => onUseRobot(row)}
            fullWidth
            sx={{
              borderRadius: 1.5,
              py: 1.2
            }}
          >
            {t('robot.use_this_robot', 'Use this robot')}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
});

export const AutoRobots: FC = () => {
  const { t } = useTranslation();
  const [page, setPage] = useState<number>(1);
  const [rowsPerPage] = useState<number>(6);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedRobot, setSelectedRobot] = useState<Data | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState<boolean>(false);
  const [cloudModalOpen, setCloudModalOpen] = useState<boolean>(false);

  const rows = AUTO_ROBOTS;

  const categories = useMemo(() => {
    const uniqueCategories = [...new Set(rows
      .map((row: any) => row.category)
      .filter(Boolean)
    )];
    return uniqueCategories;
  }, [rows]);

  function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);

    useEffect(() => {
      const handler = setTimeout(() => {
        setDebouncedValue(value);
      }, delay);

      return () => {
        clearTimeout(handler);
      };
    }, [value, delay]);

    return debouncedValue;
  }

  const debouncedSearchTerm = useDebounce<string>(searchTerm, 300);

  const filteredRows = useMemo<Data[]>(() => {
    let filtered = rows;

    if (selectedCategory) {
      filtered = filtered.filter(row => row.category === selectedCategory);
    }

    const searchLower = debouncedSearchTerm.toLowerCase();
    if (debouncedSearchTerm) {
      filtered = filtered.filter(row => row.name.toLowerCase().includes(searchLower));
    }

    return filtered;
  }, [rows, debouncedSearchTerm, selectedCategory]);

  const handlePageChange = (_event: React.ChangeEvent<unknown>, value: number): void => {
    setPage(value);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const paginatedRows = useMemo<Data[]>(() => {
    const startIndex = (page - 1) * rowsPerPage;
    return filteredRows.slice(startIndex, startIndex + rowsPerPage);
  }, [filteredRows, page, rowsPerPage]);

  const totalPages = Math.ceil(filteredRows.length / rowsPerPage);

  const handleUseRobotClick = (robot: Data): void => {
    setSelectedRobot(robot);
    setDetailModalOpen(true);
  };

  const handleAddToMyRobots = (robot: Data, config?: { parameters?: { [key: string]: string } }): void => {
    setDetailModalOpen(false);
    setCloudModalOpen(true);
  };

  return (
    <>
      <Box sx={{ padding: "30px" }}>
        <Box sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 3
        }}>
          <Typography variant="h6">
            {t('mainmenu.prebuilt_robots', 'Auto Robots')}
          </Typography>
          <TextField
            size="small"
            placeholder={t('recordingtable.search', 'Search')}
            value={searchTerm}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
            sx={{ width: '250px' }}
          />
        </Box>

        <Box sx={{
          display: 'flex',
          gap: 1,
          mb: 3,
          flexWrap: 'wrap'
        }}>
          <Chip
            label="All"
            onClick={() => setSelectedCategory('')}
            color={selectedCategory === '' ? 'primary' : 'default'}
            sx={{
              '&:hover': { backgroundColor: theme => selectedCategory === '' ? theme.palette.primary.main : theme.palette.action.hover }
            }}
          />
          {categories.map((category) => (
            <Chip
              key={category}
              label={category}
              onClick={() => setSelectedCategory(category)}
              color={selectedCategory === category ? 'primary' : 'default'}
              sx={{
                '&:hover': { backgroundColor: theme => selectedCategory === category ? theme.palette.primary.main : theme.palette.action.hover }
              }}
            />
          ))}
        </Box>

        <Grid container spacing={3}>
          {paginatedRows.map((row) => (
            <Grid item xs={12} sm={6} md={4} key={row.id}>
              <RecordingCard
                row={row}
                onUseRobot={handleUseRobotClick}
              />
            </Grid>
          ))}
        </Grid>

        {filteredRows.length === 0 ? (
          <Box sx={{
            textAlign: 'center',
            py: 8,
            bgcolor: 'background.paper',
            borderRadius: 1,
            mt: 3
          }}>
            <Typography color="text.secondary">
              {searchTerm
                ? t('recordingtable.no_results', 'No results found')
                : t('recordingtable.no_recordings', 'No robots available')}
            </Typography>
          </Box>
        ) : (
          <Box sx={{
            display: 'flex',
            justifyContent: 'center',
            mt: 4,
            mb: 2
          }}>
            <Pagination
              count={totalPages}
              page={page}
              onChange={handlePageChange}
              color="primary"
              size="large"
              showFirstButton
              showLastButton
            />
          </Box>
        )}
      </Box>

      <AutoRobotDetailModal
        open={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        robot={selectedRobot}
        onUseRobot={handleAddToMyRobots}
      />

      <GenericModal
        isOpen={cloudModalOpen}
        onClose={() => setCloudModalOpen(false)}
        modalStyle={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '500px',
          maxWidth: '90vw',
          padding: '32px',
          backgroundColor: 'background.paper',
          boxShadow: '0px 8px 24px rgba(0, 0, 0, 0.15)',
          borderRadius: '12px',
        }}
      >
        <Box>
          <Typography variant="h5" fontWeight={600} mb={2}>
            Available on Maxun Cloud
          </Typography>
          <Typography variant="body1" color="text.secondary" mb={3}>
            Auto Robots are available exclusively on Maxun Cloud. Sign up for free to access pre-built automation templates and start extracting data instantly.
          </Typography>
          <Box display="flex" gap={2}>
            <Button
              variant="contained"
              color="primary"
              fullWidth
              onClick={() => window.open('https://app.maxun.dev/prebuilt-robots', '_blank', 'noopener,noreferrer')}
            >
              Go to Maxun Cloud
            </Button>
            <Button
              variant="outlined"
              color="primary"
              fullWidth
              onClick={() => setCloudModalOpen(false)}
              sx={{
                color: '#ff00c3 !important',
                borderColor: '#ff00c3 !important',
              }}
            >
              Cancel
            </Button>
          </Box>
        </Box>
      </GenericModal>
    </>
  );
};

export default AutoRobots;
