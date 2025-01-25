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

interface CredentialInfo {
    value: string;
    type: string;
}

interface Credentials {
    [key: string]: CredentialInfo;
}

interface CredentialVisibility {
    [key: string]: boolean;
}

interface GroupedCredentials {
    passwords: string[];
    emails: string[];
    usernames: string[];
    others: string[];
}

export const RobotEditModal = ({ isOpen, handleStart, handleClose, initialSettings }: RobotSettingsProps) => {
    const { t } = useTranslation();
    const [robot, setRobot] = useState<RobotSettings | null>(null);
    const [credentials, setCredentials] = useState<Credentials>({});
    const { recordingId, notify } = useGlobalInfoStore();
    const [credentialGroups, setCredentialGroups] = useState<GroupedCredentials>({
        passwords: [],
        emails: [],
        usernames: [],
        others: []
    });
    const [showPasswords, setShowPasswords] = useState<CredentialVisibility>({});

    const isEmailPattern = (value: string): boolean => {
        return value.includes('@');
    };

    const isUsernameSelector = (selector: string): boolean => {
        return selector.toLowerCase().includes('username') ||
            selector.toLowerCase().includes('user') ||
            selector.toLowerCase().includes('email');
    };

    const determineCredentialType = (selector: string, info: CredentialInfo): 'password' | 'email' | 'username' | 'other' => {
        // Check for password type first
        if (info.type === 'password') {
            return 'password';
        }

        // Check for email patterns in the value or selector
        if (isEmailPattern(info.value) || selector.toLowerCase().includes('email')) {
            return 'email';
        }

        // Check for username patterns in the selector
        if (isUsernameSelector(selector)) {
            return 'username';
        }

        return 'other';
    };

    useEffect(() => {
        if (isOpen) {
            getRobot();
        }
    }, [isOpen]);

    useEffect(() => {
        if (robot?.recording?.workflow) {
            const extractedCredentials = extractInitialCredentials(robot.recording.workflow);
            setCredentials(extractedCredentials);
            setCredentialGroups(groupCredentialsByType(extractedCredentials));
        }
    }, [robot]);

    const extractInitialCredentials = (workflow: any[]): Credentials => {
        const credentials: Credentials = {};

        // Helper function to check if a character is printable
        const isPrintableCharacter = (char: string): boolean => {
            return char.length === 1 && !!char.match(/^[\x20-\x7E]$/);
        };

        // Process each step in the workflow
        workflow.forEach(step => {
            if (!step.what) return;

            // Keep track of the current input field being processed
            let currentSelector = '';
            let currentValue = '';
            let currentType = '';

            // Process actions in sequence to maintain correct text state
            step.what.forEach((action: any) => {
                if (
                    (action.action === 'type' || action.action === 'press') &&
                    action.args?.length >= 2 &&
                    typeof action.args[1] === 'string'
                ) {
                    const selector: string = action.args[0];
                    const character: string = action.args[1];
                    const inputType: string = action.args[2] || '';

                    // If we're dealing with a new selector, store the previous one
                    if (currentSelector && selector !== currentSelector) {
                        if (!credentials[currentSelector]) {
                            credentials[currentSelector] = {
                                value: currentValue,
                                type: currentType
                            };
                        } else {
                            credentials[currentSelector].value = currentValue;
                        }
                    }

                    // Update current tracking variables
                    if (selector !== currentSelector) {
                        currentSelector = selector;
                        currentValue = credentials[selector]?.value || '';
                        currentType = inputType || credentials[selector]?.type || '';
                    }

                    // Handle different types of key actions
                    if (character === 'Backspace') {
                        // Remove the last character when backspace is pressed
                        currentValue = currentValue.slice(0, -1);
                    } else if (isPrintableCharacter(character)) {
                        // Add the character to the current value
                        currentValue += character;
                    }
                    // Note: We ignore other special keys like 'Shift', 'Enter', etc.
                }
            });

            // Store the final state of the last processed selector
            if (currentSelector) {
                credentials[currentSelector] = {
                    value: currentValue,
                    type: currentType
                };
            }
        });

        return credentials;
    };

    const groupCredentialsByType = (credentials: Credentials): GroupedCredentials => {
        return Object.entries(credentials).reduce((acc: GroupedCredentials, [selector, info]) => {
            const credentialType = determineCredentialType(selector, info);

            switch (credentialType) {
                case 'password':
                    acc.passwords.push(selector);
                    break;
                case 'email':
                    acc.emails.push(selector);
                    break;
                case 'username':
                    acc.usernames.push(selector);
                    break;
                default:
                    acc.others.push(selector);
            }

            return acc;
        }, { passwords: [], emails: [], usernames: [], others: [] });
    };

    const getRobot = async () => {
        if (recordingId) {
            const robot = await getStoredRecording(recordingId);
            setRobot(robot);
        } else {
            notify('error', t('robot_edit.notifications.update_failed'));
        }
    };

    const handleClickShowPassword = (selector: string) => {
        setShowPasswords(prev => ({
            ...prev,
            [selector]: !prev[selector]
        }));
    };

    const handleRobotNameChange = (newName: string) => {
        setRobot((prev) =>
            prev ? { ...prev, recording_meta: { ...prev.recording_meta, name: newName } } : prev
        );
    };

    const handleCredentialChange = (selector: string, value: string) => {
        setCredentials(prev => ({
            ...prev,
            [selector]: {
                ...prev[selector],
                value
            }
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

    const renderAllCredentialFields = () => {
        return (
            <>
                {renderCredentialFields(
                    credentialGroups.usernames,
                    t('Username'),
                    'text'
                )}

                {renderCredentialFields(
                    credentialGroups.emails,
                    t('Email'),
                    'text'
                )}

                {renderCredentialFields(
                    credentialGroups.passwords,
                    t('Password'),
                    'password'
                )}

                {renderCredentialFields(
                    credentialGroups.others,
                    t('Other'),
                    'text'
                )}
            </>
        );
    };

    const renderCredentialFields = (selectors: string[], headerText: string, defaultType: 'text' | 'password' = 'text') => {
        if (selectors.length === 0) return null;

        return (
            <>
                <Typography variant="h6" style={{ marginBottom: '20px' }}>
                    {headerText}
                </Typography>
                {selectors.map((selector, index) => {
                    const isVisible = showPasswords[selector];

                    return (
                        <TextField
                            key={selector}
                            // The type changes based on visibility state
                            type={isVisible ? 'text' : 'password'}
                            label={`Input ${index + 1}`}
                            value={credentials[selector]?.value || ''}
                            onChange={(e) => handleCredentialChange(selector, e.target.value)}
                            style={{ marginBottom: '20px' }}
                            InputProps={{
                                // Now showing visibility toggle for all fields
                                endAdornment: (
                                    <InputAdornment position="end">
                                        <IconButton
                                            aria-label="Show input"
                                            onClick={() => handleClickShowPassword(selector)}
                                            edge="end"
                                            // Optional: disable if field is empty
                                            disabled={!credentials[selector]?.value}
                                        >
                                            {isVisible ? <Visibility /> : <VisibilityOff />}
                                        </IconButton>
                                    </InputAdornment>
                                ),
                            }}
                        />
                    );
                })}
            </>
        );
    };

    const handleSave = async () => {
        if (!robot) return;

        try {
            const credentialsForPayload = Object.entries(credentials).reduce((acc, [selector, info]) => {
                const enforceType = info.type === 'password' ? 'password' : 'text';

                acc[selector] = {
                    value: info.value,
                    type: enforceType
                };
                return acc;
            }, {} as Record<string, CredentialInfo>);

            const payload = {
                name: robot.recording_meta.name,
                limit: robot.recording.workflow[0]?.what[0]?.args?.[0]?.limit,
                credentials: credentialsForPayload,
            };

            const success = await updateRecording(robot.recording_meta.id, payload);

            if (success) {
                notify('success', t('robot_edit.notifications.update_success'));
                handleStart(robot);
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
                    {robot && (
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

                            {(robot.isLogin || Object.keys(credentials).length > 0) && (
                                <>
                                    {renderAllCredentialFields()}
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
                    )}
                </Box>
            </>
        </GenericModal>
    );
};