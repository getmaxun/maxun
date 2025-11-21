import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { TextField, Typography, Box, Card, CardContent } from "@mui/material";
import { Settings, Info } from "@mui/icons-material";
import { useGlobalInfoStore } from "../../../context/globalInfo";
import { getStoredRecording } from "../../../api/storage";
import { WhereWhatPair } from "maxun-core";
import { getUserById } from "../../../api/auth";
import { RobotConfigPage } from "./RobotConfigPage";
import { useNavigate, useLocation } from "react-router-dom";

interface RobotMeta {
  name: string;
  id: string;
  createdAt: string;
  pairs: number;
  updatedAt: string;
  params: any[];
  type?: 'extract' | 'scrape';
  url?: string;
  formats?: ('markdown' | 'html')[];
}

interface RobotWorkflow {
  workflow: WhereWhatPair[];
}

interface ScheduleConfig {
  runEvery: number;
  runEveryUnit: "MINUTES" | "HOURS" | "DAYS" | "WEEKS" | "MONTHS";
  startFrom:
    | "SUNDAY"
    | "MONDAY"
    | "TUESDAY"
    | "WEDNESDAY"
    | "THURSDAY"
    | "FRIDAY"
    | "SATURDAY";
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
  handleStart: (settings: RobotSettings) => void;
}

export const RobotSettingsPage = ({ handleStart }: RobotSettingsProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [robot, setRobot] = useState<RobotSettings | null>(null);
  const { recordingId, notify } = useGlobalInfoStore();

  useEffect(() => {
    getRobot();
  }, []);

  const getRobot = async () => {
    if (recordingId) {
      try {
        const robot = await getStoredRecording(recordingId);
        setRobot(robot);
      } catch (error) {
        notify("error", t("robot_settings.errors.robot_not_found"));
      }
    } else {
      notify("error", t("robot_settings.errors.robot_not_found"));
    }
  };

  const getTargetUrl = () => {
    let url = robot?.recording_meta.url;

    if (!url) {
      const lastPair =
        robot?.recording.workflow[robot?.recording.workflow.length - 1];
      url = lastPair?.what.find((action) => action.action === "goto")
        ?.args?.[0];
    }

    return url;
  };

  useEffect(() => {
    const fetchUserEmail = async () => {
      if (robot && robot.userId) {
        try {
          const userData = await getUserById(robot.userId.toString());
          if (userData && userData.user) {
            setUserEmail(userData.user.email);
          }
        } catch (error) {
          console.error("Failed to fetch user email:", error);
        }
      }
    };
    fetchUserEmail();
  }, [robot?.userId]);

  const handleCancel = () => {
    const basePath = location.pathname.includes("/prebuilt-robots")
      ? "/prebuilt-robots"
      : "/robots";
    navigate(basePath);
  };

  const targetUrl = getTargetUrl();

  return (
    <RobotConfigPage
      title={t("robot_settings.title")}
      onCancel={handleCancel}
      cancelButtonText={t("robot_settings.buttons.close")}
      showSaveButton={false}
      showCancelButton={false}
    >
      <>
        <Box style={{ display: "flex", flexDirection: "column" }}>
          {robot && (
            <>
              <TextField
                label={t("robot_settings.target_url")}
                key="Robot Target URL"
                value={targetUrl}
                InputProps={{
                  readOnly: true,
                }}
                style={{ marginBottom: "20px" }}
              />
              <TextField
                label={t("robot_settings.robot_id")}
                key="Robot ID"
                value={robot.recording_meta.id}
                InputProps={{
                  readOnly: true,
                }}
                style={{ marginBottom: "20px" }}
              />
              {(() => {
                let listCounter = 1;

                return robot.recording.workflow.flatMap((wf, wfIndex) =>
                  wf.what.flatMap((action, actionIndex) => {
                    const argsWithLimit = action.args?.filter(
                      (arg: any) => arg && typeof arg === "object" && arg.limit !== undefined
                    );

                    if (!argsWithLimit?.length) return [];

                    return argsWithLimit.map((arg, limitIndex) => {
                      const labelName = action.name || `List ${listCounter++}`;
                      return (
                        <TextField
                          key={`limit-${wfIndex}-${actionIndex}-${limitIndex}`}
                          label={`${t("robot_settings.robot_limit")} (${labelName})`}
                          type="number"
                          value={arg.limit || ""}
                          InputProps={{
                            readOnly: true,
                          }}
                          style={{ marginBottom: "20px" }}
                        />
                      );
                    });
                  })
                );
              })()}

              <TextField
                label={t("robot_settings.created_by_user")}
                key="Created By User"
                value={userEmail ? userEmail : ""}
                InputProps={{
                  readOnly: true,
                }}
                style={{ marginBottom: "20px" }}
              />
              <TextField
                label={t("robot_settings.created_at")}
                key="Robot Created At"
                value={robot.recording_meta.createdAt}
                InputProps={{
                  readOnly: true,
                }}
                style={{ marginBottom: "20px" }}
              />
            </>
          )}
        </Box>
      </>
    </RobotConfigPage>
  );
};
