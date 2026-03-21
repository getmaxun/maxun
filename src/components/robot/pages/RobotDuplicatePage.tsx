import React, { useState, useEffect } from "react";
import { TextField, Box } from "@mui/material";
import { useGlobalInfoStore } from "../../../context/globalInfo";
import { duplicateRecording, getStoredRecording } from "../../../api/storage";
import { useTranslation, Trans } from "react-i18next";
import { RobotConfigPage } from "./RobotConfigPage";
import { useNavigate, useLocation } from "react-router-dom";

interface RobotDuplicatePageProps {
  handleStart: (settings: any) => void;
}

export const RobotDuplicatePage = ({ handleStart }: RobotDuplicatePageProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [targetUrl, setTargetUrl] = useState<string>("");
  const [newName, setNewName] = useState<string>("");
  const [robot, setRobot] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { recordingId, notify, setRerenderRobots } = useGlobalInfoStore();
  const robotIdFromUrl = location.pathname.split('/').filter(Boolean)[1] ?? null;
  const effectiveId = recordingId || robotIdFromUrl;

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

      if (url) {
        setTargetUrl(url);
        const lastWord = url.split('/').filter(Boolean).pop() || 'Unnamed';
        setNewName(`${robot.recording_meta.name} (${lastWord})`);
      }
    }
  }, [robot]);

  const getRobot = async () => {
    if (!effectiveId) {
      notify("error", t("robot_duplication.notifications.robot_not_found"));
      return;
    }
    const data = await getStoredRecording(effectiveId);
    if (!data) {
      notify("error", t("robot_duplication.notifications.robot_not_found"));
      return;
    }
    setRobot(data);
  };

  const handleSave = async () => {
    if (!robot || !targetUrl) {
      notify("error", t("robot_duplication.notifications.url_required"));
      return;
    }

    if (!newName.trim()) {
      notify("error", t("robot_duplication.notifications.name_required"));
      return;
    }

    setIsLoading(true);
    try {
      const result = await duplicateRecording(robot.recording_meta.id, targetUrl, newName.trim());

      if (result) {
        setRerenderRobots(true);
        notify("success", t("robot_duplication.notifications.duplicate_success"));
        handleStart(robot);
        navigate("/robots");
      } else {
        notify("error", t("robot_duplication.notifications.duplicate_error"));
      }
    } catch (error: any) {
      notify("error", error.message || t("robot_duplication.notifications.unknown_error"));
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
              <span>
                <Trans
                  i18nKey="robot_duplication.descriptions.example"
                  values={{ url1: "producthunt.com/topics/api", url2: "producthunt.com/topics/database" }}
                  components={[<code key="0" />, <code key="1" />]}
                />
              </span>
              <br />
              <span>
                <b>{t("robot_duplication.descriptions.warning")}</b>
              </span>
              <TextField
                label={t("robot_duplication.fields.new_name")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{ marginBottom: "20px", marginTop: "30px" }}
                fullWidth
              />
              <TextField
                label={t("robot_duplication.fields.target_url")}
                value={targetUrl}
                onChange={(e) => {
                  setTargetUrl(e.target.value);
                  if (robot) {
                    const lastWord = e.target.value.split('/').filter(Boolean).pop() || 'Unnamed';
                    setNewName(`${robot.recording_meta.name} (${lastWord})`);
                  }
                }}
                style={{ marginBottom: "20px" }}
                fullWidth
              />
            </>
          )}
        </Box>
      </>
    </RobotConfigPage>
  );
};
