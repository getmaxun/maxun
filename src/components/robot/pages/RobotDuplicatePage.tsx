import React, { useState, useEffect } from "react";
import { TextField, Typography, Box } from "@mui/material";
import { useGlobalInfoStore } from "../../../context/globalInfo";
import { duplicateRecording, getStoredRecording } from "../../../api/storage";
import { useTranslation } from "react-i18next";
import { RobotConfigPage } from "./RobotConfigPage";
import { useNavigate } from "react-router-dom";

interface RobotDuplicatePageProps {
  handleStart: (settings: any) => void;
}

export const RobotDuplicatePage = ({ handleStart }: RobotDuplicatePageProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [targetUrl, setTargetUrl] = useState<string>("");
  const [robot, setRobot] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { recordingId, notify, setRerenderRobots } = useGlobalInfoStore();

  useEffect(() => {
    getRobot();
  }, []);

  useEffect(() => {
    if (robot) {
      let url = robot.recording_meta?.url;

      if (!url && robot.recording?.workflow?.length) {
        const lastPair = robot.recording.workflow[robot.recording.workflow.length - 1];
        url = lastPair?.what?.find((action: any) => action.action === "goto")?.args?.[0];
      }

      if (url) setTargetUrl(url);
    }
  }, [robot]);

  const getRobot = async () => {
    if (recordingId) {
      try {
        const data = await getStoredRecording(recordingId);
        setRobot(data);
      } catch (error) {
        notify("error", t("robot_duplication.notifications.robot_not_found"));
      }
    } else {
      notify("error", t("robot_duplication.notifications.robot_not_found"));
    }
  };

  const handleSave = async () => {
    if (!robot || !targetUrl) {
      notify("error", t("robot_duplication.notifications.url_required"));
      return;
    }

    setIsLoading(true);
    try {
      const result = await duplicateRecording(robot.recording_meta.id, targetUrl);

      if (result) {
        setRerenderRobots(true);
        notify("success", t("robot_duplication.notifications.duplicate_success"));
        handleStart(robot);
        navigate("/robots");
      } else {
        notify("error", t("robot_duplication.notifications.duplicate_error"));
      }
    } catch (error) {
      notify("error", t("robot_duplication.notifications.unknown_error"));
      console.error("Error duplicating robot:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <RobotConfigPage
      title={t("robot_duplication.title")}
      onSave={handleSave}
      saveButtonText={t("robot_duplication.buttons.duplicate")}
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
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                style={{ marginBottom: "20px", marginTop: "30px" }}
              />
            </>
          )}
        </Box>
      </>
    </RobotConfigPage>
  );
};
