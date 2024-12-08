import React, { useState, useContext } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { 
  IconButton, 
  Menu, 
  MenuItem, 
  Typography, 
  Tooltip,
  Chip
} from "@mui/material";
import { 
  AccountCircle, 
  Logout, 
  Clear, 
  Brightness4, 
  Brightness7 
} from "@mui/icons-material";
import styled from "styled-components";

import { stopRecording } from "../../api/recording";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { AuthContext } from '../../context/auth';
import { SaveRecording } from '../molecules/SaveRecording';
import DiscordIcon from '../atoms/DiscordIcon';
import { apiUrl } from '../../apiConfig';
import MaxunLogo from "../../assets/maxunlogo.png";
import { useThemeMode } from '../../context/theme-provider';

interface NavBarProps {
  recordingName: string;
  isRecording: boolean;
}

export const NavBar: React.FC<NavBarProps> = ({ recordingName, isRecording }) => {
  const { notify, browserId, setBrowserId } = useGlobalInfoStore();
  const { state, dispatch } = useContext(AuthContext);
  const { user } = state;
  const navigate = useNavigate();
  const { darkMode, toggleTheme } = useThemeMode();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const logout = async () => {
    dispatch({ type: 'LOGOUT' });
    window.localStorage.removeItem('user');
    const { data } = await axios.get(`${apiUrl}/auth/logout`);
    notify('success', data.message);
    navigate('/login');
  };

  const goToMainMenu = async () => {
    if (browserId) {
      await stopRecording(browserId);
      notify('warning', 'Current Recording was terminated');
      setBrowserId(null);
    }
    navigate('/');
  };

  const renderBrandSection = () => (
    <BrandContainer>
      <LogoImage src={MaxunLogo} alt="Maxun Logo" />
      <ProjectName mode={darkMode ? 'dark' : 'light'}>Maxun</ProjectName>
      <Chip 
        label="beta" 
        variant="outlined" 
        sx={{ 
          marginTop: '10px',
          borderColor: '#ff00c3',
          color: '#ff00c3'
        }} 
      />
    </BrandContainer>
  );

  const renderSocialButtons = () => (
    <>
      <IconButton
        component="a"
        href="https://discord.gg/5GbPjBUkws"
        target="_blank"
        rel="noopener noreferrer"
        sx={{
          ...styles.socialButton,
          color: darkMode ? '#ffffff' : '#333333',
          '&:hover': {
            color: '#ff00c3'
          }
        }}
      >
        <DiscordIcon sx={{ marginRight: '5px' }} />
      </IconButton>
      <iframe 
        src="https://ghbtns.com/github-btn.html?user=getmaxun&repo=maxun&type=star&count=true&size=large" 
        frameBorder="0" 
        scrolling="0" 
        width="170" 
        height="30" 
        title="GitHub"
      />
    </>
  );

  const renderUserMenu = () => (
    <>
      <IconButton 
        onClick={handleMenuOpen} 
        sx={styles.userButton(darkMode)}
      >
        <AccountCircle sx={{ marginRight: '5px' }} />
        <Typography variant="body1">{user?.email}</Typography>
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            backgroundColor: darkMode ? '#1e2124' : '#ffffff',
            color: darkMode ? '#ffffff' : '#333333'
          }
        }}
      >
        <MenuItem onClick={() => { handleMenuClose(); logout(); }}>
          <Logout sx={{ marginRight: '5px' }} /> Logout
        </MenuItem>
      </Menu>
    </>
  );

  const renderThemeToggle = () => (
    <Tooltip title="Toggle light/dark theme">
      <IconButton 
        onClick={toggleTheme} 
        sx={{
          color: darkMode ? '#ffffff' : '#333333',
          '&:hover': {
            color: '#ff00c3'
          }
        }}
      >
        {darkMode ? <Brightness7 /> : <Brightness4 />}
      </IconButton>
    </Tooltip>
  );

  const renderRecordingControls = () => (
    <>
      <IconButton 
        onClick={goToMainMenu} 
        sx={styles.discardButton}
      >
        <Clear sx={{ marginRight: '5px' }} />
        Discard
      </IconButton>
      <SaveRecording fileName={recordingName} />
    </>
  );

  return (

    <NavBarWrapper mode={darkMode ? 'dark' : 'light'}>
      {renderBrandSection()}
      {user && (
        <ControlsContainer>
          {!isRecording ? (
            <>
              {renderSocialButtons()}
              {renderUserMenu()}
              {renderThemeToggle()}
            </>
          ) : (
            renderRecordingControls()
          )}
        </ControlsContainer>
      )}

   
    </NavBarWrapper>
  );
};

// Styles
const styles = {
  socialButton: {
    display: 'flex',
    alignItems: 'center',
    borderRadius: '5px',
    padding: '8px',
    marginRight: '30px',
    color: '#333333',
    '&:hover': {
      color: '#ff00c3'
    }
  },
  userButton: (darkMode: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    borderRadius: '5px',
    padding: '8px',
    marginRight: '10px',
    color: darkMode ? '#ffffff' : '#333333',
    '&:hover': { 
      backgroundColor: darkMode ? '#333' : '#F5F5F5', 
      color: '#ff00c3' 
    }
  }),
  discardButton: {
    borderRadius: '5px',
    padding: '8px',
    background: 'red',
    color: 'white',
    marginRight: '10px',
    '&:hover': { 
      color: 'white', 
      backgroundColor: '#ff0000' 
    }
  }
};

// Styled Components
const NavBarWrapper = styled.div<{ mode: 'light' | 'dark' }>`
  grid-area: navbar;
  background-color: ${({ mode }) => (mode === 'dark' ? '#1e2124' : '#ffffff')};
  padding: 5px;
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid ${({ mode }) => (mode === 'dark' ? '#333' : '#e0e0e0')};
`;

const BrandContainer = styled.div`
  display: flex;
  justify-content: flex-start;
`;

const LogoImage = styled.img.attrs({
  width: 45,
  height: 40,
})`
  border-radius: 5px;
  margin: 5px 0px 5px 15px;
`;

const ProjectName = styled.b<{ mode: 'light' | 'dark' }>`
  color: ${({ mode }) => (mode === 'dark' ? 'white' : '#333333')};
  font-size: 1.3em;
  padding: 11px;
`;

const ControlsContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
`;
