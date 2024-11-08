import React, { useState, useContext } from 'react';
import axios from 'axios';
import styled from "styled-components";
import { stopRecording } from "../../api/recording";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { IconButton, Menu, MenuItem, Typography, Avatar, Tooltip } from "@mui/material";
import { AccountCircle, Logout, Clear, Brightness4, Brightness7 } from "@mui/icons-material";
import { useNavigate } from 'react-router-dom';
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

  return (
    <NavBarWrapper mode={darkMode ? 'dark' : 'light'}>
      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <img src={MaxunLogo} width={45} height={40} style={{ borderRadius: '5px', margin: '5px 0px 5px 15px' }} />
        <div style={{ padding: '11px' }}>
          <ProjectName mode={darkMode ? 'dark' : 'light'}>Maxun</ProjectName>
        </div>
      </div>
      {user ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          {!isRecording ? (
            <>
              <IconButton
                component="a"
                href="https://discord.gg/NFhWDCdb"
                target="_blank"
                rel="noopener noreferrer"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: '5px',
                  padding: '8px',
                  marginRight: '10px',
                }}
              >
                <DiscordIcon sx={{ marginRight: '5px' }} />
              </IconButton>
              <iframe src="https://ghbtns.com/github-btn.html?user=getmaxun&repo=maxun&type=star&count=true&size=large" frameBorder="0" scrolling="0" width="170" height="30" title="GitHub"></iframe>
              <IconButton onClick={handleMenuOpen} sx={{
                display: 'flex',
                alignItems: 'center',
                borderRadius: '5px',
                padding: '8px',
                marginRight: '10px',
                '&:hover': { backgroundColor: darkMode ? '#333':'#F5F5F5', color: '#ff00c3' }
              }}>
                <AccountCircle sx={{ marginRight: '5px' }} />
                <Typography variant="body1">{user.email}</Typography>
              </IconButton>
              <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={handleMenuClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              >
                <MenuItem onClick={() => { handleMenuClose(); logout(); }}>
                  <Logout sx={{ marginRight: '5px' }} /> Logout
                </MenuItem>
              </Menu>
              {/* Theme Toggle Button */}
              <Tooltip title="Toggle light/dark theme">
                <IconButton onClick={toggleTheme} color="inherit">
                  {darkMode ? <Brightness7 /> : <Brightness4 />}
                </IconButton>
              </Tooltip>
            </>
          ) : (
            <>
              <IconButton onClick={goToMainMenu} sx={{
                borderRadius: '5px',
                padding: '8px',
                background: 'red',
                color: 'white',
                marginRight: '10px',
                '&:hover': { color: 'white', backgroundColor: 'red' }
              }}>
                <Clear sx={{ marginRight: '5px' }} />
                Discard
              </IconButton>
              <SaveRecording fileName={recordingName} />
            </>
          )}
        </div>
      ) : null}
    </NavBarWrapper>
  );
};

const NavBarWrapper = styled.div<{ mode: 'light' | 'dark' }>`
  grid-area: navbar;
  background-color: ${({ mode }) => (mode === 'dark' ? '#1e2124' : '#ffffff')};
  padding: 5px;
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid ${({ mode }) => (mode === 'dark' ? '#333' : '#e0e0e0')};
`;

const ProjectName = styled.b<{ mode: 'light' | 'dark' }>`
  color: ${({ mode }) => (mode === 'dark' ? 'white' : 'black')};
  font-size: 1.3em;
`;
