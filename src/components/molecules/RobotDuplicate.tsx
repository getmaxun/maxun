import React, { useState, useEffect } from 'react';
import { GenericModal } from "../atoms/GenericModal";
import { TextField, Typography, Box, Button } from "@mui/material";
import { modalStyle } from "./AddWhereCondModal";
import { useGlobalInfoStore } from '../../context/globalInfo';
import { duplicateRecording, getStoredRecording } from '../../api/storage';
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

export const RobotDuplicationModal = ({ isOpen, handleStart, handleClose, initialSettings }: RobotSettingsProps) => {
    const [robot, setRobot] = useState<RobotSettings | null>(null);
    const [targetUrl, setTargetUrl] = useState<string | undefined>('');
    const { recordingId, notify } = useGlobalInfoStore();

    useEffect(() => {
        if (isOpen) {
            getRobot();
        }
    }, [isOpen]);

    useEffect(() => {
        // Update the targetUrl when the robot data is loaded
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
            notify('error', 'Could not find robot details. Please try again.');
        }
    }

    // const lastPair = robot?.recording.workflow[robot?.recording.workflow.length - 1];

    // // Find the `goto` action in `what` and retrieve its arguments
    // const targetUrl = lastPair?.what.find(action => action.action === "goto")?.args?.[0];

    const handleTargetUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setTargetUrl(e.target.value);
    };

    const handleSave = async () => {
        if (!robot || !targetUrl) {
            notify('error', 'Target URL is required.');
            return;
        }

        console.log("handle save");

        try {
            const success = await duplicateRecording(robot.recording_meta.id, targetUrl);

            if (success) {
                notify('success', 'Robot duplicated successfully.');
                handleStart(robot); // Inform parent about the updated robot
                handleClose(); 

                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } else {
                notify('error', 'Failed to update the Target URL. Please try again.');
            }
        } catch (error) {
            notify('error', 'An error occurred while updating the Target URL.');
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
                <Typography variant="h5" style={{ marginBottom: '20px' }}>Duplicate Robot</Typography>
                <Box style={{ display: 'flex', flexDirection: 'column' }}>
                    {
                        robot && (
                            <>
                                <span>Robot duplication is useful to extract data from pages with the same structure.</span>
                                <br />
                                <span>
                                    Example: If you've created a robot for <code>producthunt.com/topics/api</code>, you can duplicate it to scrape similar pages 
                                    like <code>producthunt.com/topics/database</code> without training a robot from scratch.
                                    </span>
                                    <br />
                                <span>
                                <b>⚠️ Ensure the new page has the same structure as the original page.</b>
                                </span>
                                <TextField
                                    label="Robot Target URL"
                                    key="Robot Target URL"
                                    value={targetUrl}
                                    onChange={handleTargetUrlChange}
                                    style={{ marginBottom: '20px', marginTop: '30px' }}
                                />
                                <Box mt={2} display="flex" justifyContent="flex-end" onClick={handleSave}>
                                    <Button variant="contained" color="primary">
                                        Duplicate Robot
                                    </Button>
                                    <Button onClick={handleClose} color="primary" variant="outlined" style={{ marginLeft: '10px' }}>
                                        Cancel
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
