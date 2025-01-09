import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { GenericModal } from "../ui/GenericModal";
import { TextField, Typography, Box, Button } from "@mui/material";
import { modalStyle } from "./AddWhereCondModal";
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
    const { recordingId, notify } = useGlobalInfoStore();

    useEffect(() => {
        if (isOpen) {
            getRobot();
        }
    }, [isOpen]);

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
