import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { GenericModal } from "../ui/GenericModal";
import { TextField, Typography, Box, Button, IconButton, InputAdornment } from "@mui/material";
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { modalStyle } from "../recorder/AddWhereCondModal";
import { useGlobalInfoStore } from '../../context/globalInfo';
import { getStoredRecording, updateRecording } from '../../api/storage';
import { WhereWhatPair } from 'maxun-core';

interface RobotMeta {
    name: string;
    id: string;
    createdAt: string;
    pairs: number;
    updatedAt: string;
    params: any[];
}

interface RobotWorkflow {
    workflow: WhereWhatPair[];
}

interface RobotEditOptions {
    name: string;
    limit?: number;
}

interface Credentials {
    [key: string]: string;
}

interface CredentialVisibility {
    [key: string]: boolean;
}

interface ScheduleConfig {
    runEvery: number;
    runEveryUnit: 'MINUTES' | 'HOURS' | 'DAYS' | 'WEEKS' | 'MONTHS';
    startFrom: 'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY';
    atTimeStart?: string;
    atTimeEnd?: string;
    timezone: string;
    lastRunAt?: Date;
    nextRunAt?: Date;
    cronExpression?: string;
}

export interface RobotSettings {
    id: string;
    userId?: number;
    recording_meta: RobotMeta;
    recording: RobotWorkflow;
    google_sheet_email?: string | null;
    google_sheet_name?: string | null;
    google_sheet_id?: string | null;
    google_access_token?: string | null;
    google_refresh_token?: string | null;
    schedule?: ScheduleConfig | null;
    isLogin?: boolean;
}

interface RobotSettingsProps {
    isOpen: boolean;
    handleStart: (settings: RobotSettings) => void;
    handleClose: () => void;
    initialSettings?: RobotSettings | null;
}

export const RobotEditModal = ({ isOpen, handleStart, handleClose, initialSettings }: RobotSettingsProps) => {
    const { t } = useTranslation();
    const [robot, setRobot] = useState<RobotSettings | null>(null);
    const [credentials, setCredentials] = useState<Credentials>({});
    const { recordingId, notify } = useGlobalInfoStore();
    const [credentialSelectors, setCredentialSelectors] = useState<string[]>([]);
    const [showPasswords, setShowPasswords] = useState<CredentialVisibility>({});

    const handleClickShowPassword = (selector: string) => {
        setShowPasswords(prev => ({
            ...prev,
            [selector]: !prev[selector]
        }));
    };

    useEffect(() => {
        if (isOpen) {
            getRobot();
        }
    }, [isOpen]);

    useEffect(() => {
        if (robot?.recording?.workflow) {
          const selectors = findCredentialSelectors(robot.recording.workflow);
          setCredentialSelectors(selectors);
          
          const initialCredentials = extractInitialCredentials(robot.recording.workflow);
          setCredentials(initialCredentials);
        }
    }, [robot]);

    const findCredentialSelectors = (workflow: WhereWhatPair[]): string[] => {
        const selectors = new Set<string>();
        
        workflow?.forEach(step => {
          step.what?.forEach(action => {
            if (
              (action.action === 'type' || action.action === 'press') && 
              action.args && 
              action.args[0] && 
              typeof action.args[0] === 'string'
            ) {
              selectors.add(action.args[0]);
            }
          });
        });
        
        return Array.from(selectors);
    };

    const extractInitialCredentials = (workflow: any[]): Record<string, string> => {
        const credentials: Record<string, string> = {};

        const isPrintableCharacter = (char: string): boolean => {
            return char.length === 1 && !!char.match(/^[\x20-\x7E]$/);
        };
        
        workflow.forEach(step => {
            if (!step.what) return;
            
            step.what.forEach((action: any) => {
                if (
                    (action.action === 'type' || action.action === 'press') && 
                    action.args?.length >= 2 && 
                    typeof action.args[1] === 'string'
                ) {
                    let currentSelector: string = action.args[0];
                    let character: string = action.args[1];
                    
                    if (!credentials.hasOwnProperty(currentSelector)) {
                        credentials[currentSelector] = '';
                    }
                    
                    if (isPrintableCharacter(character)) {
                        credentials[currentSelector] += character;
                    }
                }
            });
        });
        
        return credentials;
    };

    const getRobot = async () => {
        if (recordingId) {
            const robot = await getStoredRecording(recordingId);
            setRobot(robot);
        } else {
            notify('error', t('robot_edit.notifications.update_failed'));
        }
    }

    const handleRobotNameChange = (newName: string) => {
        setRobot((prev) =>
            prev ? { ...prev, recording_meta: { ...prev.recording_meta, name: newName } } : prev
        );
    };

    const handleCredentialChange = (selector: string, value: string) => {
        setCredentials(prev => ({
          ...prev,
          [selector]: value
        }));
    };

    const handleLimitChange = (newLimit: number) => {
        setRobot((prev) => {
            if (!prev) return prev;

            const updatedWorkflow = [...prev.recording.workflow];

            if (
                updatedWorkflow.length > 0 &&
                updatedWorkflow[0]?.what &&
                updatedWorkflow[0].what.length > 0 &&
                updatedWorkflow[0].what[0].args &&
                updatedWorkflow[0].what[0].args.length > 0 &&
                updatedWorkflow[0].what[0].args[0]
            ) {
                updatedWorkflow[0].what[0].args[0].limit = newLimit;
            }

            return { ...prev, recording: { ...prev.recording, workflow: updatedWorkflow } };
        });
    };

    const handleSave = async () => {
        if (!robot) return;

        try {
            const payload = {
                name: robot.recording_meta.name,
                limit: robot.recording.workflow[0]?.what[0]?.args?.[0]?.limit,
                credentials: credentials,
            };

            const success = await updateRecording(robot.recording_meta.id, payload);

            if (success) {
                notify('success', t('robot_edit.notifications.update_success'));
                handleStart(robot); // Inform parent about the updated robot
                handleClose();

                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } else {
                notify('error', t('robot_edit.notifications.update_failed'));
            }
        } catch (error) {
            notify('error', t('robot_edit.notifications.update_error'));
            console.error('Error updating robot:', error);
        }
    };

    return (
        <GenericModal
            isOpen={isOpen}
            onClose={handleClose}
            modalStyle={modalStyle}
        >
            <>
                <Typography variant="h5" style={{ marginBottom: '20px' }}>
                    {t('robot_edit.title')}
                </Typography>
                <Box style={{ display: 'flex', flexDirection: 'column' }}>
                    {
                        robot && (
                            <>
                                <TextField
                                    label={t('robot_edit.change_name')}
                                    key="Robot Name"
                                    type='text'
                                    value={robot.recording_meta.name}
                                    onChange={(e) => handleRobotNameChange(e.target.value)}
                                    style={{ marginBottom: '20px' }}
                                />
                                {robot.recording.workflow?.[0]?.what?.[0]?.args?.[0]?.limit !== undefined && (
                                    <TextField
                                        label={t('robot_edit.robot_limit')}
                                        type="number"
                                        value={robot.recording.workflow[0].what[0].args[0].limit || ''}
                                        onChange={(e) => {
                                            const value = parseInt(e.target.value, 10);
                                            if (value >= 1) {
                                                handleLimitChange(value);
                                            }
                                        }}
                                        inputProps={{ min: 1 }}
                                        style={{ marginBottom: '20px' }}
                                    />
                                )}

                                {(robot.isLogin || credentialSelectors.length > 0) && (
                                    <>
                                        <Typography variant="h6" style={{ marginBottom: '20px' }}>
                                            {t('Login Credentials')}
                                        </Typography>
                                        
                                        {credentialSelectors.map((selector) => (
                                            <TextField
                                                key={selector}
                                                type={showPasswords[selector] ? 'text' : 'password'}
                                                label={`Credential for ${selector}`}
                                                value={credentials[selector] || ''}
                                                onChange={(e) => handleCredentialChange(selector, e.target.value)}
                                                style={{ marginBottom: '20px' }}
                                                InputProps={{
                                                    endAdornment: (
                                                        <InputAdornment position="end">
                                                            <IconButton
                                                                aria-label="toggle password visibility"
                                                                onClick={() => handleClickShowPassword(selector)}
                                                                edge="end"
                                                            >
                                                                {showPasswords[selector] ? <Visibility /> : <VisibilityOff />}
                                                            </IconButton>
                                                        </InputAdornment>
                                                    ),
                                                }}
                                            />
                                        ))}
                                    </>
                                )}

                                <Box mt={2} display="flex" justifyContent="flex-end">
                                    <Button variant="contained" color="primary" onClick={handleSave}>
                                        {t('robot_edit.save')}
                                    </Button>
                                    <Button
                                        onClick={handleClose}
                                        color="primary"
                                        variant="outlined"
                                        style={{ marginLeft: '10px' }}
                                        sx={{
                                            color: '#ff00c3 !important',
                                            borderColor: '#ff00c3 !important',
                                            backgroundColor: 'whitesmoke !important',
                                        }}>
                                        {t('robot_edit.cancel')}
                                    </Button>
                                </Box>
                            </>
                        )
                    }
                </Box>
            </>
        </GenericModal>
    );
};
