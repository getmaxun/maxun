import React, { useState, useEffect } from "react";
import {
  TextField,
  Typography,
  Box,
  Button,
} from "@mui/material";
import { useGlobalInfoStore } from "../../../context/globalInfo";
import {
  duplicateRecording,
  getStoredRecording,
  getStoredRecordings,
} from "../../../api/storage";
import { WhereWhatPair } from "maxun-core";
import { useTranslation } from "react-i18next";
import { RobotConfigPage } from "./RobotConfigPage";
import { useNavigate, useLocation } from "react-router-dom";

interface RobotMeta {
  name: string;
  id: string;
  prebuiltId?: string;
  createdAt: string;
  pairs: number;
  updatedAt: string;
  params: any[];
  type?: 'extract' | 'scrape';
  url?: string;
  formats?: ('markdown' | 'html' | 'screenshot-visible' | 'screenshot-fullpage')[];
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

export const RobotDuplicatePage = ({ handleStart }: RobotSettingsProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [targetUrl, setTargetUrl] = useState<string | undefined>("");
  const [robot, setRobot] = useState<RobotSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { recordingId, notify, setRerenderRobots} =
    useGlobalInfoStore();

  useEffect(() => {
    getRobot();
  }, []);

  useEffect(() => {
    if (robot) {
      let url = robot.recording_meta.url;

      if (!url) {
        const lastPair =
          robot?.recording.workflow[robot?.recording.workflow.length - 1];
        url = lastPair?.what.find((action) => action.action === "goto")
          ?.args?.[0];
      }

      setTargetUrl(url);
    }
  }, [robot]);

  const getRobot = async () => {
    if (recordingId) {
      try {
        const robot = await getStoredRecording(recordingId);
        setRobot(robot);
      } catch (error) {
        notify("error", t("robot_duplication.notifications.robot_not_found"));
      }
    } else {
      notify("error", t("robot_duplication.notifications.robot_not_found"));
    }
  };

  const handleTargetUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTargetUrl(e.target.value);
  };

  const handleSave = async () => {
    if (!robot || !targetUrl) {
      notify("error", t("robot_duplication.notifications.url_required"));
      return;
    }

    setIsLoading(true);
    try {
      const success = await duplicateRecording(
        robot.recording_meta.id,
        targetUrl
      );

      if (success) {
        setRerenderRobots(true);
        notify(
          "success",
          t("robot_duplication.notifications.duplicate_success")
        );
        handleStart(robot);
        const basePath = location.pathname.includes("/prebuilt-robots")
          ? "/prebuilt-robots"
          : "/robots";
        navigate(basePath);
      } else {
        notify("error", t("robot_duplication.notifications.duplicate_error"));
      }
    } catch (error) {
      notify("error", t("robot_duplication.notifications.unknown_error"));
      console.error("Error updating Target URL:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    const basePath = location.pathname.includes("/prebuilt-robots")
      ? "/prebuilt-robots"
      : "/robots";
    navigate(basePath);
  };

  return (
    <RobotConfigPage
      title={t("robot_duplication.title")}
      onSave={handleSave}
      onCancel={handleCancel}
      saveButtonText={t("robot_duplication.buttons.duplicate")}
      cancelButtonText={t("robot_duplication.buttons.cancel")}
      isLoading={isLoading}
      showCancelButton={false}
    >
      <>
        <Box style={{ display: "flex", flexDirection: "column" }}>
          {robot && (
            <>
              <span>{t("robot_duplication.descriptions.purpose")}</span>
              <br />
              <span
                dangerouslySetInnerHTML={{
                  __html: t("robot_duplication.descriptions.example", {
                    url1: "<code>producthunt.com/topics/api</code>",
                    url2: "<code>producthunt.com/topics/database</code>",
                  }),
                }}
              />
              <br />
              <span>
                <b>{t("robot_duplication.descriptions.warning")}</b>
              </span>
              <TextField
                label={t("robot_duplication.fields.target_url")}
                key={t("robot_duplication.fields.target_url")}
                value={targetUrl}
                onChange={handleTargetUrlChange}
                style={{ marginBottom: "20px", marginTop: "30px" }}
              />
            </>
          )}
        </Box>
      </>
    </RobotConfigPage>
  );
};