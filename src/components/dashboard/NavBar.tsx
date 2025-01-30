import { useTranslation } from "react-i18next";
import React, { useState, useContext, useEffect } from 'react';
import axios from 'axios';
import styled from "styled-components";
import { stopRecording } from "../../api/recording";
import { useGlobalInfoStore } from "../../context/globalInfo";
import {
  IconButton,
  Menu,
  MenuItem,
  Typography,
  Chip,
  Button,
  Modal,
  Tabs,
  Tab,
  Box,
  Snackbar,
  Tooltip
} from "@mui/material";
import {
  AccountCircle,
  Logout,
  Clear,
  YouTube,
  X,
  GitHub,
  Update,
  Close,
  Language,
  Description,
  LightMode,
  DarkMode
} from "@mui/icons-material";
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../../context/auth';
import { SaveRecording } from '../recorder/SaveRecording';
import DiscordIcon from '../icons/DiscordIcon';
import { apiUrl } from '../../apiConfig';
import MaxunLogo from "../../assets/maxunlogo.png";
import { useThemeMode } from '../../context/theme-provider';
import packageJson from "../../../package.json"

interface NavBarProps {
  recordingName: string;
  isRecording: boolean;
}

export const NavBar: React.FC<NavBarProps> = ({
  recordingName,
  isRecording,
}) => {
  const { notify, browserId, setBrowserId } = useGlobalInfoStore();
  const { state, dispatch } = useContext(AuthContext);
  const { user } = state;
  const navigate = useNavigate();
  const { darkMode, toggleTheme } = useThemeMode();
  const { t, i18n } = useTranslation();

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const [langAnchorEl, setLangAnchorEl] = useState<null | HTMLElement>(null);

  const currentVersion = packageJson.version;

  const [open, setOpen] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);

  const fetchLatestVersion = async (): Promise<string | null> => {
    try {
      const response = await fetch("https://api.github.com/repos/getmaxun/maxun/releases/latest");
      const data = await response.json();
      const version = data.tag_name.replace(/^v/, ""); // Remove 'v' prefix
      return version;
    } catch (error) {
      console.error("Failed to fetch latest version:", error);
      return null;
    }
  };

  const handleUpdateOpen = () => {
    setOpen(true);
    fetchLatestVersion();
  };

  const handleUpdateClose = () => {
    setOpen(false);
    setTab(0); // Reset tab to the first tab
  };

  const handleUpdateTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTab(newValue);
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleLangMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setLangAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setLangAnchorEl(null);
  };

  const logout = async () => {
    dispatch({ type: "LOGOUT" });
    window.localStorage.removeItem("user");
    const { data } = await axios.get(`${apiUrl}/auth/logout`);
    notify("success", data.message);
    navigate("/login");
  };

  const goToMainMenu = async () => {
    if (browserId) {
      await stopRecording(browserId);
      notify("warning", t('browser_recording.notifications.terminated'));
      setBrowserId(null);
    }
    navigate("/");
  };

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem("language", lang);
  };

  const renderThemeToggle = () => (
    <Tooltip title="Toggle Mode">
      <IconButton
        onClick={toggleTheme}
        sx={{
          color: darkMode ? '#ffffff' : '#0000008A',
          '&:hover': {
            color: '#ff00c3'
          }
        }}
      >
        {darkMode ? <LightMode /> : <DarkMode />}
      </IconButton>
    </Tooltip>
  );

  useEffect(() => {
    const checkForUpdates = async () => {
      const latestVersion = await fetchLatestVersion();
      setLatestVersion(latestVersion);
      if (latestVersion && latestVersion !== currentVersion) {
        setIsUpdateAvailable(true);
      }
    };
    checkForUpdates();
  }, []);

  return (
    <>
      {isUpdateAvailable && (
        <Snackbar
          open={isUpdateAvailable}
          onClose={() => setIsUpdateAvailable(false)}
          message={
            `${t('navbar.upgrade.modal.new_version_available', { version: latestVersion })} ${t('navbar.upgrade.modal.view_updates')}`
          }
          action={
            <>
              <Button
                color="primary"
                size="small"
                onClick={handleUpdateOpen}
                style={{
                  backgroundColor: '#ff00c3',
                  color: 'white',
                  fontWeight: 'bold',
                  textTransform: 'none',
                  marginRight: '8px',
                  borderRadius: '5px',
                }}
              >
                {t('navbar.upgrade.button')}
              </Button>
              <IconButton
                size="small"
                aria-label="close"
                color="inherit"
                onClick={() => setIsUpdateAvailable(false)}
                style={{ color: 'black' }}
              >
                <Close />
              </IconButton>
            </>
          }
          ContentProps={{
            sx: {
              background: "white",
              color: "black",
            }
          }}
        />
      )}
      <NavBarWrapper mode={darkMode ? 'dark' : 'light'}>
        <div style={{
          display: 'flex',
          justifyContent: 'flex-start',
        }}>
          <img src={MaxunLogo} width={45} height={40} style={{ borderRadius: '5px', margin: '5px 0px 5px 15px' }} />
          <div style={{ padding: '11px' }}><ProjectName mode={darkMode ? 'dark' : 'light'}>{t('navbar.project_name')}</ProjectName></div>
          <Chip
            label={`${currentVersion}`}
            color="primary"
            variant="outlined"
            sx={{ marginTop: '10px' }}
          />
        </div>
        {
          user ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
              {!isRecording ? (
                <>
                  <Button variant="outlined" onClick={handleUpdateOpen} sx={{
                    marginRight: '40px',
                    color: "#00000099",
                    border: "#00000099 1px solid",
                    '&:hover': { color: '#ff00c3', border: '#ff00c3 1px solid' }
                  }}>
                    <Update sx={{ marginRight: '5px' }} /> {t('navbar.upgrade.button')}
                  </Button>
                  <Modal open={open} onClose={handleUpdateClose}>
                    <Box
                      sx={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        width: 500,
                        bgcolor: "background.paper",
                        boxShadow: 24,
                        p: 4,
                        borderRadius: 2,
                      }}
                    >
                      {latestVersion === null ? (
                        <Typography>Checking for updates...</Typography>
                      ) : currentVersion === latestVersion ? (
                        <Typography variant="h6" textAlign="center">
                          {t('navbar.upgrade.modal.up_to_date')}
                        </Typography>
                      ) : (
                        <>
                          <Typography variant="body1" textAlign="left" sx={{ marginLeft: '30px' }}>
                            {t('navbar.upgrade.modal.new_version_available', { version: latestVersion })}
                            <br />
                            {t('navbar.upgrade.modal.view_updates')}
                            <a href="https://github.com/getmaxun/maxun/releases/" target="_blank" style={{ textDecoration: 'none' }}>{' '}here.</a>
                          </Typography>
                          <Tabs
                            value={tab}
                            onChange={handleUpdateTabChange}
                            sx={{ marginTop: 2, marginBottom: 2 }}
                            centered
                          >
                            <Tab label={t('navbar.upgrade.modal.tabs.manual_setup')} />
                            <Tab label={t('navbar.upgrade.modal.tabs.docker_setup')} />
                          </Tabs>
                          {tab === 0 && (
                            <Box sx={{ marginLeft: '30px', background: '#cfd0d1', padding: 1, borderRadius: 3 }}>
                              <code style={{ color: 'black' }}>
                                <p>Run the commands below</p>
                                # cd to project directory (eg: maxun)
                                <br />
                                cd maxun
                                <br />
                                <br />
                                # pull latest changes
                                <br />
                                git pull origin master
                                <br />
                                <br />
                                # install dependencies
                                <br />
                                npm install
                                <br />
                                <br />
                                # start maxun
                                <br />
                                npm run start
                              </code>
                            </Box>
                          )}
                          {tab === 1 && (
                            <Box sx={{ marginLeft: '30px', background: '#cfd0d1', padding: 1, borderRadius: 3 }}>
                              <code style={{ color: 'black' }}>
                                <p>Run the commands below</p>
                                # cd to project directory (eg: maxun)
                                <br />
                                cd maxun
                                <br />
                                <br />
                                # stop the working containers
                                <br />
                                docker-compose down
                                <br />
                                <br />
                                # pull latest docker images
                                <br />
                                docker-compose pull
                                <br />
                                <br />
                                # start maxun
                                <br />
                                docker-compose up -d
                              </code>
                            </Box>
                          )}
                        </>
                      )}
                    </Box>
                  </Modal>
                  {/* <iframe 
                  src="https://ghbtns.com/github-btn.html?user=getmaxun&repo=maxun&type=star&count=true&size=large" 
                  // frameBorder="0" 
                  // scrolling="0" 
                  // width="170" 
                  // height="30" 
                  // title="GitHub">
                  // </iframe>*/}
                  <IconButton onClick={handleMenuOpen} sx={{
                    display: 'flex',
                    alignItems: 'center',
                    borderRadius: '5px',
                    padding: '8px',
                    marginRight: '10px',
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
                    PaperProps={{ sx: { width: '180px' } }}
                  >
                    <MenuItem onClick={() => { handleMenuClose(); logout(); }}>
                      <Logout sx={{ marginRight: '5px' }} /> {t('navbar.menu_items.logout')}
                    </MenuItem>
                    <MenuItem onClick={handleLangMenuOpen}>
                      <Language sx={{ marginRight: '5px' }} /> {t('navbar.menu_items.language')}
                    </MenuItem>
                    <hr />
                    <MenuItem onClick={() => {
                      window.open('https://docs.maxun.dev', '_blank');
                    }}>
                      <Description sx={{ marginRight: '5px' }} /> Docs
                    </MenuItem>
                    <MenuItem onClick={() => {
                      window.open('https://github.com/getmaxun/maxun', '_blank');
                    }}>
                      <GitHub sx={{ marginRight: '5px' }} /> GitHub
                    </MenuItem>
                    <MenuItem onClick={() => {
                      window.open('https://discord.gg/5GbPjBUkws', '_blank');
                    }}>
                      <DiscordIcon sx={{ marginRight: '5px' }} /> Discord
                    </MenuItem>
                    <MenuItem onClick={() => {
                      window.open('https://www.youtube.com/@MaxunOSS/videos?ref=app', '_blank');
                    }}>
                      <YouTube sx={{ marginRight: '5px' }} /> YouTube
                    </MenuItem>
                    <MenuItem onClick={() => {
                      window.open('https://x.com/maxun_io?ref=app', '_blank');
                    }}>
                      <X sx={{ marginRight: '5px' }} /> Twitter (X)
                    </MenuItem>
                    <Menu
                      anchorEl={langAnchorEl}
                      open={Boolean(langAnchorEl)}
                      onClose={handleMenuClose}
                      anchorOrigin={{
                        vertical: "bottom",
                        horizontal: "right",
                      }}
                      transformOrigin={{
                        vertical: "top",
                        horizontal: "right",
                      }}
                    >
                      <MenuItem
                        onClick={() => {
                          changeLanguage("en");
                          handleMenuClose();
                        }}
                      >
                        English
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          changeLanguage("es");
                          handleMenuClose();
                        }}
                      >
                        Español
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          changeLanguage("ja");
                          handleMenuClose();
                        }}
                      >
                        日本語
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          changeLanguage("zh");
                          handleMenuClose();
                        }}
                      >
                        中文
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          changeLanguage("de");
                          handleMenuClose();
                        }}
                      >
                        Deutsch
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          window.open('https://docs.maxun.dev/development/i18n', '_blank');
                          handleMenuClose();
                        }}
                      >
                        Add Language
                      </MenuItem>
                    </Menu>
                  </Menu>
                  {renderThemeToggle()}
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
                    {t('navbar.recording.discard')}
                  </IconButton>
                  <SaveRecording fileName={recordingName} />
                </>
              )}
            </div>
          ) : (
            <NavBarRight>
              <IconButton
                onClick={handleLangMenuOpen}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  borderRadius: "5px",
                  padding: "8px",
                  marginRight: "8px",
                }}
              >
                <Language sx={{ marginRight: '5px' }} /><Typography variant="body1">{t("Language")}</Typography>
              </IconButton>
              <Menu
                anchorEl={langAnchorEl}
                open={Boolean(langAnchorEl)}
                onClose={handleMenuClose}
                anchorOrigin={{
                  vertical: "bottom",
                  horizontal: "right",
                }}
                transformOrigin={{
                  vertical: "top",
                  horizontal: "right",
                }}
              >
                <MenuItem
                  onClick={() => {
                    changeLanguage("en");
                    handleMenuClose();
                  }}
                >
                  English
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    changeLanguage("es");
                    handleMenuClose();
                  }}
                >
                  Español
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    changeLanguage("ja");
                    handleMenuClose();
                  }}
                >
                  日本語
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    changeLanguage("zh");
                    handleMenuClose();
                  }}
                >
                  中文
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    changeLanguage("de");
                    handleMenuClose();
                  }}
                >
                  Deutsch
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    window.open('https://docs.maxun.dev/development/i18n', '_blank');
                    handleMenuClose();
                  }}
                >
                  Add Language
                </MenuItem>
              </Menu>
              {renderThemeToggle()}
            </NavBarRight>
          )}
      </NavBarWrapper>
    </>
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
  color: ${({ mode }) => (mode === 'dark' ? '#ffffff' : '#3f4853')};
  font-size: 1.3em;
`;

const NavBarRight = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-left: auto;
`;