import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  TextField,
  Typography,
  Box,
  Button,
  IconButton,
  InputAdornment,
  Divider,
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import { useGlobalInfoStore } from "../../../context/globalInfo";
import { getStoredRecording, updateRecording } from "../../../api/storage";
import { WhereWhatPair } from "maxun-core";
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

interface ScrapeListLimit {
  pairIndex: number;
  actionIndex: number;
  argIndex: number;
  currentLimit: number;
}

export const RobotEditPage = ({ handleStart }: RobotSettingsProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [credentials, setCredentials] = useState<Credentials>({});
  const { recordingId, notify, setRerenderRobots } = useGlobalInfoStore();
  const [robot, setRobot] = useState<RobotSettings | null>(null);
  const [credentialGroups, setCredentialGroups] = useState<GroupedCredentials>({
    passwords: [],
    emails: [],
    usernames: [],
    others: [],
  });
  const [showPasswords, setShowPasswords] = useState<CredentialVisibility>({});
  const [scrapeListLimits, setScrapeListLimits] = useState<ScrapeListLimit[]>(
    []
  );
  const [isLoading, setIsLoading] = useState(false);

  const isEmailPattern = (value: string): boolean => {
    return value.includes("@");
  };

  const isUsernameSelector = (selector: string): boolean => {
    return (
      selector.toLowerCase().includes("username") ||
      selector.toLowerCase().includes("user") ||
      selector.toLowerCase().includes("email")
    );
  };

  const determineCredentialType = (
    selector: string,
    info: CredentialInfo
  ): "password" | "email" | "username" | "other" => {
    if (
      info.type === "password" ||
      selector.toLowerCase().includes("password")
    ) {
      return "password";
    }
    if (
      isEmailPattern(info.value) ||
      selector.toLowerCase().includes("email")
    ) {
      return "email";
    }
    if (isUsernameSelector(selector)) {
      return "username";
    }
    return "other";
  };

  useEffect(() => {
    getRobot();
  }, []);

  useEffect(() => {
    if (robot?.recording?.workflow) {
      const extractedCredentials = extractInitialCredentials(
        robot.recording.workflow
      );
      setCredentials(extractedCredentials);
      setCredentialGroups(groupCredentialsByType(extractedCredentials));

      findScrapeListLimits(robot.recording.workflow);
    }
  }, [robot]);

  const findScrapeListLimits = (workflow: WhereWhatPair[]) => {
    const limits: ScrapeListLimit[] = [];

    workflow.forEach((pair, pairIndex) => {
      if (!pair.what) return;

      pair.what.forEach((action, actionIndex) => {
        if (
          action.action === "scrapeList" &&
          action.args &&
          action.args.length > 0
        ) {
          // Check if first argument has a limit property
          const arg = action.args[0];
          if (arg && typeof arg === "object" && "limit" in arg) {
            limits.push({
              pairIndex,
              actionIndex,
              argIndex: 0,
              currentLimit: arg.limit,
            });
          }
        }
      });
    });

    setScrapeListLimits(limits);
  };

  function extractInitialCredentials(workflow: any[]): Credentials {
    const credentials: Credentials = {};

    const isPrintableCharacter = (char: string): boolean => {
      return char.length === 1 && !!char.match(/^[\x20-\x7E]$/);
    };

    workflow.forEach((step) => {
      if (!step.what) return;

      let currentSelector = "";
      let currentValue = "";
      let currentType = "";
      let i = 0;

      while (i < step.what.length) {
        const action = step.what[i];

        if (!action.action || !action.args?.[0]) {
          i++;
          continue;
        }

        const selector = action.args[0];

        // Handle full word type actions first
        if (
          action.action === "type" &&
          action.args?.length >= 2 &&
          typeof action.args[1] === "string" &&
          action.args[1].length > 1
        ) {
          if (!credentials[selector]) {
            credentials[selector] = {
              value: action.args[1],
              type: action.args[2] || "text",
            };
          }
          i++;
          continue;
        }

        // Handle character-by-character sequences (both type and press)
        if (
          (action.action === "type" || action.action === "press") &&
          action.args?.length >= 2 &&
          typeof action.args[1] === "string"
        ) {
          if (selector !== currentSelector) {
            if (currentSelector && currentValue) {
              credentials[currentSelector] = {
                value: currentValue,
                type: currentType || "text",
              };
            }
            currentSelector = selector;
            currentValue = credentials[selector]?.value || "";
            currentType =
              action.args[2] || credentials[selector]?.type || "text";
          }

          const character = action.args[1];

          if (isPrintableCharacter(character)) {
            currentValue += character;
          } else if (character === "Backspace") {
            currentValue = currentValue.slice(0, -1);
          }

          if (!currentType && action.args[2]?.toLowerCase() === "password") {
            currentType = "password";
          }

          let j = i + 1;
          while (j < step.what.length) {
            const nextAction = step.what[j];
            if (
              !nextAction.action ||
              !nextAction.args?.[0] ||
              nextAction.args[0] !== selector ||
              (nextAction.action !== "type" && nextAction.action !== "press")
            ) {
              break;
            }
            if (nextAction.args[1] === "Backspace") {
              currentValue = currentValue.slice(0, -1);
            } else if (isPrintableCharacter(nextAction.args[1])) {
              currentValue += nextAction.args[1];
            }
            j++;
          }

          credentials[currentSelector] = {
            value: currentValue,
            type: currentType,
          };

          i = j;
        } else {
          i++;
        }
      }

      if (currentSelector && currentValue) {
        credentials[currentSelector] = {
          value: currentValue,
          type: currentType || "text",
        };
      }
    });

    return credentials;
  }

  const groupCredentialsByType = (
    credentials: Credentials
  ): GroupedCredentials => {
    return Object.entries(credentials).reduce(
      (acc: GroupedCredentials, [selector, info]) => {
        const credentialType = determineCredentialType(selector, info);

        switch (credentialType) {
          case "password":
            acc.passwords.push(selector);
            break;
          case "email":
            acc.emails.push(selector);
            break;
          case "username":
            acc.usernames.push(selector);
            break;
          default:
            acc.others.push(selector);
        }

        return acc;
      },
      { passwords: [], emails: [], usernames: [], others: [] }
    );
  };

  const getRobot = async () => {
    if (recordingId) {
      try {
        const robot = await getStoredRecording(recordingId);
        setRobot(robot);
      } catch (error) {
        notify("error", t("robot_edit.notifications.update_failed"));
      }
    } else {
      notify("error", t("robot_edit.notifications.update_failed"));
    }
  };

  const handleClickShowPassword = (selector: string) => {
    setShowPasswords((prev) => ({
      ...prev,
      [selector]: !prev[selector],
    }));
  };

  const handleRobotNameChange = (newName: string) => {
    setRobot((prev) =>
      prev
        ? { ...prev, recording_meta: { ...prev.recording_meta, name: newName } }
        : prev
    );
  };

  const handleCredentialChange = (selector: string, value: string) => {
    setCredentials((prev) => ({
      ...prev,
      [selector]: {
        ...prev[selector],
        value,
      },
    }));
  };

  const handleLimitChange = (
    pairIndex: number,
    actionIndex: number,
    argIndex: number,
    newLimit: number
  ) => {
    setRobot((prev) => {
      if (!prev) return prev;

      const updatedWorkflow = [...prev.recording.workflow];
      const pair = updatedWorkflow[pairIndex];
      const action = pair?.what?.[actionIndex];
      if (
        updatedWorkflow.length > pairIndex &&
        pair?.what &&
        pair.what.length > actionIndex &&
        action?.args &&
        action.args.length > argIndex
      ) {
        if (action.args[argIndex]) {
          action.args[argIndex].limit = newLimit;
        }

        setScrapeListLimits((prev) => {
          return prev.map((item) => {
            if (
              item.pairIndex === pairIndex &&
              item.actionIndex === actionIndex &&
              item.argIndex === argIndex
            ) {
              return { ...item, currentLimit: newLimit };
            }
            return item;
          });
        });
      }

      return {
        ...prev,
        recording: { ...prev.recording, workflow: updatedWorkflow },
      };
    });
  };

  const handleActionNameChange = (
    pairIndex: number,
    actionIndex: number,
    newName: string
  ) => {
    setRobot((prev) => {
      if (!prev) return prev;

      const updatedWorkflow = [...prev.recording.workflow];
      if (
        updatedWorkflow.length > pairIndex &&
        updatedWorkflow[pairIndex]?.what &&
        updatedWorkflow[pairIndex].what.length > actionIndex
      ) {
        const action = { ...updatedWorkflow[pairIndex].what[actionIndex] };
        // update the standard name field
        action.name = newName;

        updatedWorkflow[pairIndex].what[actionIndex] = action;
      }

      return {
        ...prev,
        recording: { ...prev.recording, workflow: updatedWorkflow },
      };
    });
  };

  const handleTargetUrlChange = (newUrl: string) => {
    setRobot((prev) => {
      if (!prev) return prev;

      const updatedWorkflow = [...prev.recording.workflow];
      const lastPairIndex = updatedWorkflow.length - 1;

      if (lastPairIndex >= 0) {
        const gotoAction = updatedWorkflow[lastPairIndex]?.what?.find(
          (action) => action.action === "goto"
        );
        if (gotoAction && gotoAction.args && gotoAction.args.length > 0) {
          gotoAction.args[0] = newUrl;
        }
      }

      return {
        ...prev,
        recording_meta: { ...prev.recording_meta, url: newUrl },
        recording: { ...prev.recording, workflow: updatedWorkflow },
      };
    });
  };

  const renderAllCredentialFields = () => {
    return (
      <>
        {renderCredentialFields(
          credentialGroups.usernames,
          t("Username"),
          "text"
        )}

        {renderCredentialFields(credentialGroups.emails, t("Email"), "text")}

        {renderCredentialFields(
          credentialGroups.passwords,
          t("Password"),
          "password"
        )}

        {renderCredentialFields(credentialGroups.others, t("Other"), "text")}
      </>
    );
  };

  const renderScrapeListLimitFields = () => {
    if (scrapeListLimits.length === 0) return null;

    return (
      <>
        <Typography variant="h6" style={{ marginBottom: "20px", marginTop: "20px" }}>
          {t("List Limits")}
        </Typography>

        {scrapeListLimits.map((limitInfo, index) => {
          // Get the corresponding scrapeList action to extract its name
          const scrapeListAction = robot?.recording?.workflow?.[limitInfo.pairIndex]?.what?.[limitInfo.actionIndex];
          const actionName =
            scrapeListAction?.name ||
            `List Limit ${index + 1}`;

          return (
            <TextField
              key={`limit-${limitInfo.pairIndex}-${limitInfo.actionIndex}`}
              label={actionName}
              type="number"
              value={limitInfo.currentLimit || ""}
              onChange={(e) => {
                const value = parseInt(e.target.value, 10);
                if (value >= 1) {
                  handleLimitChange(
                    limitInfo.pairIndex,
                    limitInfo.actionIndex,
                    limitInfo.argIndex,
                    value
                  );
                }
              }}
              inputProps={{ min: 1 }}
              style={{ marginBottom: "20px" }}
            />
          );
        })}
      </>
    );
  };

  const renderActionNameFields = () => {
    if (!robot || !robot.recording || !robot.recording.workflow) return null;

    const editableActions = new Set(['screenshot', 'scrapeList', 'scrapeSchema']);
    const textInputs: JSX.Element[] = [];
    const screenshotInputs: JSX.Element[] = [];
    const listInputs: JSX.Element[] = [];

    let textCount = 0;
    let screenshotCount = 0;
    let listCount = 0;

    robot.recording.workflow.forEach((pair, pairIndex) => {
      if (!pair.what) return;

      pair.what.forEach((action, actionIndex) => {
        if (!editableActions.has(String(action.action))) return;

        let currentName = action.name || '';

        if (!currentName) {
          switch (action.action) {
            case 'scrapeSchema':
              currentName = 'Texts';
              break;
            case 'screenshot':
              screenshotCount++;
              currentName = `Screenshot ${screenshotCount}`;
              break;
            case 'scrapeList':
              listCount++;
              currentName = `List ${listCount}`;
              break;
          }
        } else {
          switch (action.action) {
            case 'screenshot':
              screenshotCount++;
              break;
            case 'scrapeList':
              listCount++;
              break;
          }
        }

        const textField = (
          <TextField
            key={`action-name-${pairIndex}-${actionIndex}`}
            type="text"
            value={currentName}
            onChange={(e) => handleActionNameChange(pairIndex, actionIndex, e.target.value)}
            style={{ marginBottom: '12px' }}
            fullWidth
          />
        );

        switch (action.action) {
          case 'scrapeSchema': {
            const existingName = currentName || "Texts";

            if (!textInputs.length) {
              textInputs.push(
                <TextField
                  key={`schema-${pairIndex}-${actionIndex}`}
                  type="text"
                  value={existingName}
                  onChange={(e) => {
                    const newName = e.target.value;

                    setRobot((prev) => {
                      if (!prev?.recording?.workflow) return prev;

                      const updated = { ...prev };
                      updated.recording = { ...prev.recording };
                      updated.recording.workflow = prev.recording.workflow.map((p) => ({
                        ...p,
                        what: p.what?.map((a) => {
                          if (a.action === "scrapeSchema") {
                            const updatedAction = { ...a };
                            updatedAction.name = newName;
                            return updatedAction;
                          }
                          return a;
                        }),
                      }));

                      return updated;
                    });
                  }}
                  style={{ marginBottom: "12px" }}
                  fullWidth
                />
              );
            }

            break;
          }
          case 'screenshot':
            screenshotInputs.push(textField);
            break;
          case 'scrapeList':
            listInputs.push(textField);
            break;
        }
      });
    });

    const hasAnyInputs = textInputs.length > 0 || screenshotInputs.length > 0 || listInputs.length > 0;
    if (!hasAnyInputs) return null;

    return (
      <>
        <Typography variant="h6" style={{ marginBottom: '20px', marginTop: '20px' }}>
          {t('Actions')}
        </Typography>

        {textInputs.length > 0 && (
          <>
            <Typography variant="subtitle1" style={{ marginBottom: '8px' }}>
              Texts
            </Typography>
            {textInputs}
          </>
        )}

        {screenshotInputs.length > 0 && (
          <>
            <Typography variant="subtitle1" style={{ marginBottom: '8px', marginTop: textInputs.length > 0 ? '16px' : '0' }}>
              Screenshots
            </Typography>
            {screenshotInputs}
          </>
        )}

        {listInputs.length > 0 && (
          <>
            <Typography variant="subtitle1" style={{ marginBottom: '8px', marginTop: (textInputs.length > 0 || screenshotInputs.length > 0) ? '16px' : '0' }}>
              Lists
            </Typography>
            {listInputs}
          </>
        )}
      </>
    );
  };

  const renderCredentialFields = (
    selectors: string[],
    headerText: string,
    defaultType: "text" | "password" = "text"
  ) => {
    if (selectors.length === 0) return null;

    return (
      <>
        {selectors.map((selector, index) => {
          const isVisible = showPasswords[selector];

          return (
            <TextField
              key={selector}
              type={isVisible ? "text" : "password"}
              label={
                headerText === "Other" ? `${`Input`} ${index + 1}` : headerText
              }
              value={credentials[selector]?.value || ""}
              onChange={(e) => handleCredentialChange(selector, e.target.value)}
              fullWidth
              style={{ marginBottom: "20px" }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="Show input"
                      onClick={() => handleClickShowPassword(selector)}
                      edge="end"
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

  const handleSave = async () => {
    if (!robot) return;

    setIsLoading(true);
    try {
      const credentialsForPayload = Object.entries(credentials).reduce(
        (acc, [selector, info]) => {
          const enforceType = info.type === "password" ? "password" : "text";

          acc[selector] = {
            value: info.value,
            type: enforceType,
          };
          return acc;
        },
        {} as Record<string, CredentialInfo>
      );

      const targetUrl = getTargetUrl();

      const payload: any = {
        name: robot.recording_meta.name,
        limits: scrapeListLimits.map((limit) => ({
          pairIndex: limit.pairIndex,
          actionIndex: limit.actionIndex,
          argIndex: limit.argIndex,
          limit: limit.currentLimit,
        })),
        credentials: credentialsForPayload,
        targetUrl: targetUrl,
        // send the (possibly edited) workflow so backend can persist action name changes
        workflow: robot.recording.workflow,
      };

      const success = await updateRecording(robot.recording_meta.id, payload);

      if (success) {
        setRerenderRobots(true);
        notify("success", t("robot_edit.notifications.update_success"));
        handleStart(robot);
        const basePath = "/robots";
        navigate(basePath);
      } else {
        notify("error", t("robot_edit.notifications.update_failed"));
      }
    } catch (error) {
      notify("error", t("robot_edit.notifications.update_error"));
      console.error("Error updating robot:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    const basePath = "/robots";
    navigate(basePath);
  };

  return (
    <RobotConfigPage
      title={t("robot_edit.title")}
      onSave={handleSave}
      onCancel={handleCancel}
      saveButtonText={t("robot_edit.save")}
      cancelButtonText={t("robot_edit.cancel")}
      showCancelButton={false}
      isLoading={isLoading}
    >
      <>
        <Box style={{ display: "flex", flexDirection: "column" }}>
          {robot && (
            <>
              <TextField
                label={t("robot_edit.change_name")}
                key="Robot Name"
                type="text"
                value={robot.recording_meta.name}
                onChange={(e) => handleRobotNameChange(e.target.value)}
                style={{ marginBottom: "20px" }}
              />

              <TextField
                label={t("robot_duplication.fields.target_url")}
                key={t("robot_duplication.fields.target_url")}
                value={getTargetUrl() || ""}
                onChange={(e) => handleTargetUrlChange(e.target.value)}
                style={{ marginBottom: "20px" }}
              />
              {renderScrapeListLimitFields() && (
                <>
                  <Divider />
                  {renderScrapeListLimitFields()}
                </>
              )}

              {renderActionNameFields() && (
                <>
                  <Divider />
                  {renderActionNameFields()}
                </>
              )}
            </>
          )}
        </Box>
      </>
    </RobotConfigPage>
  );
};