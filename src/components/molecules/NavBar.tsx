import React, { useState, useContext } from 'react';
import axios from 'axios';
import styled from "styled-components";
import { stopRecording } from "../../api/recording";
import { useGlobalInfoStore } from "../../context/globalInfo";
import { IconButton, Menu, MenuItem, Typography, Avatar } from "@mui/material";
import { AccountCircle, Logout, Clear } from "@mui/icons-material";
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../../context/auth';
import { SaveRecording } from '../molecules/SaveRecording';
import DiscordIcon from '../atoms/DiscordIcon';
import { apiUrl } from '../../apiConfig';

interface NavBarProps {
  recordingName: string;
  isRecording: boolean;
}

export const NavBar: React.FC<NavBarProps> = ({ recordingName, isRecording }) => {
  const { notify, browserId, setBrowserId, recordingUrl } = useGlobalInfoStore();
  const { state, dispatch } = useContext(AuthContext);
  const { user } = state;
  const navigate = useNavigate();

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
    <NavBarWrapper>
      <div style={{
        display: 'flex',
        justifyContent: 'flex-start',
      }}>
        <img src="img/maxunlogo.png" width={45} height={40} style={{ borderRadius: '5px', margin: '5px 0px 5px 15px' }} />
        <div style={{ padding: '11px' }}><ProjectName>Maxun</ProjectName></div>
      </div>
      {
        user ? (
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
                  '&:hover': { backgroundColor: 'white', color: '#ff00c3' }
                }}>
                  <AccountCircle sx={{ marginRight: '5px' }} />
                  <Typography variant="body1">{user.email}</Typography>
                </IconButton>
                <Menu
                  anchorEl={anchorEl}
                  open={Boolean(anchorEl)}
                  onClose={handleMenuClose}
                  anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right',
                  }}
                  transformOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                  }}
                >
                  <MenuItem onClick={() => { handleMenuClose(); logout(); }}>
                    <Logout sx={{ marginRight: '5px' }} /> Logout
                  </MenuItem>
                </Menu>
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
        ) : ""
      }
    </NavBarWrapper>
  );
};

const NavBarWrapper = styled.div`
  grid-area: navbar;
  background-color: white;
  padding:5px;
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid #e0e0e0;
`;

const ProjectName = styled.b`
  color: #3f4853;
  font-size: 1.3em;
`;
