import React, { useState, useEffect } from 'react';
import { GenericModal } from "../ui/GenericModal";
import { TextField, Typography, Box, Button } from "@mui/material";
import { modalStyle } from "./AddWhereCondModal";
import { useGlobalInfoStore } from '../../context/globalInfo';
import { duplicateRecording, getStoredRecording } from '../../api/storage';
import { WhereWhatPair } from 'maxun-core';
import { getUserById } from "../../api/auth";
import { useTranslation } from 'react-i18next';

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

export const RobotDuplicationModal = ({ isOpen, handleStart, handleClose, initialSettings }: RobotSettingsProps) => {
    const { t } = useTranslation();
    const [robot, setRobot] = useState<RobotSettings | null>(null);
    const [targetUrl, setTargetUrl] = useState<string | undefined>('');
    const { recordingId, notify } = useGlobalInfoStore();

    useEffect(() => {
        if (isOpen) {
            getRobot();
        }
    }, [isOpen]);

    useEffect(() => {
        if (robot) {
            const lastPair = robot?.recording.workflow[robot?.recording.workflow.length - 1];
            const url = lastPair?.what.find(action => action.action === "goto")?.args?.[0];
            setTargetUrl(url);
        }
    }, [robot]);

    const getRobot = async () => {
        if (recordingId) {
            const robot = await getStoredRecording(recordingId);
            setRobot(robot);
        } else {
            notify('error', t('robot_duplication.notifications.robot_not_found'));
        }
    }

    const handleTargetUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setTargetUrl(e.target.value);
    };

    const handleSave = async () => {
        if (!robot || !targetUrl) {
            notify('error', t('robot_duplication.notifications.url_required'));
            return;
        }

        try {
            const success = await duplicateRecording(robot.recording_meta.id, targetUrl);

            if (success) {
                notify('success', t('robot_duplication.notifications.duplicate_success'));
                handleStart(robot);
                handleClose();

                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } else {
                notify('error', t('robot_duplication.notifications.duplicate_error'));
            }
        } catch (error) {
            notify('error', t('robot_duplication.notifications.unknown_error'));
            console.error('Error updating Target URL:', error);
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
                    {t('robot_duplication.title')}
                </Typography>
                <Box style={{ display: 'flex', flexDirection: 'column' }}>
                    {
                        robot && (
                            <>
                                <span>
                                    {t('robot_duplication.descriptions.purpose')}
                                </span>
                                <br />
                                <span dangerouslySetInnerHTML={{
                                    __html: t('robot_duplication.descriptions.example', {
                                        url1: '<code>producthunt.com/topics/api</code>',
                                        url2: '<code>producthunt.com/topics/database</code>'
                                    })
                                }} />
                                <br />
                                <span>
                                    <b>{t('robot_duplication.descriptions.warning')}</b>
                                </span>
                                <TextField
                                    label={t('robot_duplication.fields.target_url')}
                                    key={t('robot_duplication.fields.target_url')}
                                    value={targetUrl}
                                    onChange={handleTargetUrlChange}
                                    style={{ marginBottom: '20px', marginTop: '30px' }}
                                />
                                <Box mt={2} display="flex" justifyContent="flex-end">
                                    <Button variant="contained" color="primary" onClick={handleSave}>
                                        {t('robot_duplication.buttons.duplicate')}
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
                                        }} >
                                        {t('robot_duplication.buttons.cancel')}
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
