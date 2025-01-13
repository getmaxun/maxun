import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { GenericModal } from "../ui/GenericModal";
import { TextField, Typography, Box } from "@mui/material";
import { useGlobalInfoStore } from '../../context/globalInfo';
import { getStoredRecording } from '../../api/storage';
import { WhereWhatPair } from 'maxun-core';
import { getUserById } from "../../api/auth";

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
}

interface RobotSettingsProps {
    isOpen: boolean;
    handleStart: (settings: RobotSettings) => void;
    handleClose: () => void;
    initialSettings?: RobotSettings | null;
}

export const RobotSettingsModal = ({ isOpen, handleStart, handleClose, initialSettings }: RobotSettingsProps) => {
    const { t } = useTranslation();
    const [robot, setRobot] = useState<RobotSettings | null>(null);
    const [userEmail, setUserEmail] = useState<string | null>(null);
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
            notify('error', t('robot_settings.errors.robot_not_found'));
        }
    }

    const lastPair = robot?.recording.workflow[robot?.recording.workflow.length - 1];

    // Find the `goto` action in `what` and retrieve its arguments
    const targetUrl = lastPair?.what.find(action => action.action === "goto")?.args?.[0];

    useEffect(() => {
        const fetchUserEmail = async () => {
            if (robot && robot.userId) {
                const userData = await getUserById(robot.userId.toString());
                if (userData && userData.user) {
                    setUserEmail(userData.user.email);
                }
            }
        };
        fetchUserEmail();
    }, [robot?.userId]);

    return (
        <GenericModal
            isOpen={isOpen}
            onClose={handleClose}
            modalStyle={modalStyle}
        >
            <>
                <Typography variant="h5" style={{ marginBottom: '20px' }}>
                    {t('robot_settings.title')}
                </Typography>
                <Box style={{ display: 'flex', flexDirection: 'column' }}>
                    {
                        robot && (
                            <>
                                <TextField
                                    label={t('robot_settings.target_url')}
                                    key="Robot Target URL"
                                    value={targetUrl}
                                    InputProps={{
                                        readOnly: true,
                                    }}
                                    style={{ marginBottom: '20px' }}
                                />
                                <TextField
                                    label={t('robot_settings.robot_id')}
                                    key="Robot ID"
                                    value={robot.recording_meta.id}
                                    InputProps={{
                                        readOnly: true,
                                    }}
                                    style={{ marginBottom: '20px' }}
                                />
                                {robot.recording.workflow?.[0]?.what?.[0]?.args?.[0]?.limit !== undefined && (
                                    <TextField
                                        label={t('robot_settings.robot_limit')}
                                        type="number"
                                        value={robot.recording.workflow[0].what[0].args[0].limit || ''}
                                        InputProps={{
                                            readOnly: true,
                                        }}
                                        style={{ marginBottom: '20px' }}
                                    />
                                )}
                                <TextField
                                    label={t('robot_settings.created_by_user')}
                                    key="Created By User"
                                    value={userEmail ? userEmail : ''}
                                    InputProps={{
                                        readOnly: true,
                                    }}
                                    style={{ marginBottom: '20px' }}
                                />
                                <TextField
                                    label={t('robot_settings.created_at')}
                                    key="Robot Created At"
                                    value={robot.recording_meta.createdAt}
                                    InputProps={{
                                        readOnly: true,
                                    }}
                                    style={{ marginBottom: '20px' }}
                                />
                            </>
                        )
                    }
                </Box>
            </>
        </GenericModal>
    );
};
