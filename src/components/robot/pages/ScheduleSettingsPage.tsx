import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  MenuItem,
  TextField,
  Typography,
  Box,
  Button,
} from "@mui/material";
import { Schedule } from "@mui/icons-material";
import { Dropdown } from "../../ui/DropdownMui";
import { validMomentTimezones } from "../../../constants/const";
import { useGlobalInfoStore } from "../../../context/globalInfo";
import { getSchedule, deleteSchedule } from "../../../api/storage";
import { RobotConfigPage } from "./RobotConfigPage";
import { useNavigate, useLocation } from "react-router-dom";

interface ScheduleSettingsProps {
  handleStart: (settings: ScheduleSettings) => void;
}

export interface ScheduleSettings {
  runEvery: number;
  runEveryUnit: string;
  startFrom: string;
  dayOfMonth?: string;
  atTimeStart?: string;
  atTimeEnd?: string;
  timezone: string;
}

export const ScheduleSettingsPage = ({
  handleStart,
}: ScheduleSettingsProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [schedule, setSchedule] = useState<ScheduleSettings | null>(null);
  const [settings, setSettings] = useState<ScheduleSettings>({
    runEvery: 1,
    runEveryUnit: "HOURS",
    startFrom: "MONDAY",
    dayOfMonth: "1",
    atTimeStart: "00:00",
    atTimeEnd: "01:00",
    timezone: "UTC",
  });
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (
    field: keyof ScheduleSettings,
    value: string | number | boolean
  ) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const units = ["MINUTES", "HOURS", "DAYS", "WEEKS", "MONTHS"];

  const days = [
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
  ];

  const { recordingId, notify } = useGlobalInfoStore();

  const deleteRobotSchedule = async () => {
    if (recordingId) {
      setIsLoading(true);
      try {
        await deleteSchedule(recordingId);
        setSchedule(null);
        notify("success", t("Schedule deleted successfully"));

        setSettings({
          runEvery: 1,
          runEveryUnit: "HOURS",
          startFrom: "MONDAY",
          dayOfMonth: "",
          atTimeStart: "00:00",
          atTimeEnd: "01:00",
          timezone: "UTC",
        });
      } catch (error) {
        notify("error", "Failed to delete schedule");
      } finally {
        setIsLoading(false);
      }
    } else {
      console.error("No recording id provided");
    }
  };

  const getRobotSchedule = async () => {
    if (recordingId) {
      try {
        const scheduleData = await getSchedule(recordingId);
        setSchedule(scheduleData);
      } catch (error) {
        console.error("Failed to fetch robot schedule:", error);
      }
    } else {
      console.error("No recording id provided");
    }
  };

  useEffect(() => {
    const fetchSchedule = async () => {
      await getRobotSchedule();
    };
    fetchSchedule();
  }, []);

  const handleSave = async () => {
    setIsLoading(true);
    try {
      await handleStart(settings);
      const basePath = location.pathname.includes("/prebuilt-robots")
        ? "/prebuilt-robots"
        : "/robots";
      navigate(basePath);
    } catch (error) {
      notify("error", "Failed to save schedule");
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

  const getDayOrdinal = (day: string | undefined) => {
    if (!day) return "";
    const lastDigit = day.slice(-1);
    const lastTwoDigits = day.slice(-2);

    // Special cases for 11, 12, 13
    if (["11", "12", "13"].includes(lastTwoDigits)) {
      return t("schedule_settings.labels.on_day.th");
    }

    // Other cases
    switch (lastDigit) {
      case "1":
        return t("schedule_settings.labels.on_day.st");
      case "2":
        return t("schedule_settings.labels.on_day.nd");
      case "3":
        return t("schedule_settings.labels.on_day.rd");
      default:
        return t("schedule_settings.labels.on_day.th");
    }
  };

  const textStyle = {
    width: "150px",
    height: "52px",
    marginRight: "10px",
  };

  const dropDownStyle = {
    marginTop: "2px",
    width: "150px",
    height: "59px",
    marginRight: "10px",
  };

  return (
    <RobotConfigPage
      title={t("schedule_settings.title")}
      onSave={schedule === null ? handleSave : undefined}
      onCancel={handleCancel}
      saveButtonText={t("schedule_settings.buttons.save_schedule")}
      cancelButtonText={t("schedule_settings.buttons.cancel")}
      showSaveButton={schedule === null}
      isLoading={isLoading}
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          "& > *": { marginBottom: "20px" },
        }}
      >
        <>
          {schedule !== null ? (
            <>
              <Typography>
                {t("schedule_settings.run_every")}: {schedule.runEvery}{" "}
                {schedule.runEveryUnit.toLowerCase()}
              </Typography>
              <Typography>
                {["MONTHS", "WEEKS"].includes(settings.runEveryUnit)
                  ? t("schedule_settings.start_from")
                  : t("schedule_settings.start_from")}
                : {schedule.startFrom.charAt(0).toUpperCase() + schedule.startFrom.slice(1).toLowerCase()}
              </Typography>
              {schedule.runEveryUnit === "MONTHS" && (
                <Typography>
                  {t("schedule_settings.on_day")}: {schedule.dayOfMonth}
                  {getDayOrdinal(schedule.dayOfMonth)} of the month
                </Typography>
              )}
              <Typography>
                {t("schedule_settings.at_around")}: {schedule.atTimeStart},{" "}
                {schedule.timezone} {t("schedule_settings.timezone")}
              </Typography>
              <Box mt={2} display="flex" justifyContent="space-between">
                <Button
                  onClick={deleteRobotSchedule}
                  variant="outlined"
                  color="error"
                  disabled={isLoading}
                >
                  {isLoading
                    ? "Deleting..."
                    : t("schedule_settings.buttons.delete_schedule")}
                </Button>
              </Box>
            </>
          ) : (
            <>
              <Box sx={{ display: "flex", alignItems: "center", width: "100%" }}>
                <Typography sx={{ marginRight: "10px" }}>
                  {t("schedule_settings.labels.run_once_every")}
                </Typography>
                <TextField
                  type="number"
                  value={settings.runEvery}
                  onChange={(e) =>
                    handleChange("runEvery", parseInt(e.target.value))
                  }
                  sx={textStyle}
                  inputProps={{ min: 1 }}
                />
                <Dropdown
                  label=""
                  id="runEveryUnit"
                  value={settings.runEveryUnit}
                  handleSelect={(e) =>
                    handleChange("runEveryUnit", e.target.value)
                  }
                  sx={dropDownStyle}
                >
                  {units.map((unit) => (
                    <MenuItem key={unit} value={unit}>
                      {" "}
                      {unit.charAt(0).toUpperCase() +
                        unit.slice(1).toLowerCase()}
                    </MenuItem>
                  ))}
                </Dropdown>
              </Box>

              <Box sx={{ display: "flex", alignItems: "center", width: "100%" }}>
                <Typography sx={{ marginBottom: "5px", marginRight: "25px" }}>
                  {["MONTHS", "WEEKS"].includes(settings.runEveryUnit)
                    ? t("schedule_settings.labels.start_from_label")
                    : t("schedule_settings.labels.start_from_label")}
                </Typography>
                <Dropdown
                  label=""
                  id="startFrom"
                  value={settings.startFrom}
                  handleSelect={(e) =>
                    handleChange("startFrom", e.target.value)
                  }
                  sx={dropDownStyle}
                >
                  {days.map((day) => (
                    <MenuItem key={day} value={day}>
                      {day.charAt(0).toUpperCase() +
                        day.slice(1).toLowerCase()}
                    </MenuItem>
                  ))}
                </Dropdown>
              </Box>

              {settings.runEveryUnit === "MONTHS" && (
                <Box sx={{ display: "flex", alignItems: "center", width: "100%" }}>
                  <Typography sx={{ marginBottom: "5px", marginRight: "25px" }}>
                    {t("schedule_settings.labels.on_day_of_month")}
                  </Typography>
                  <TextField
                    type="number"
                    value={settings.dayOfMonth}
                    onChange={(e) =>
                      handleChange("dayOfMonth", e.target.value)
                    }
                    sx={textStyle}
                    inputProps={{ min: 1, max: 31 }}
                  />
                </Box>
              )}

              {["MINUTES", "HOURS"].includes(settings.runEveryUnit) ? (
                <Box sx={{ display: "flex", alignItems: "center", width: "100%" }}>
                  <Box sx={{ marginRight: "20px" }}>
                    <Typography sx={{ marginBottom: "5px" }}>
                      {t("schedule_settings.labels.in_between")}
                    </Typography>
                    <TextField
                      type="time"
                      value={settings.atTimeStart}
                      onChange={(e) =>
                        handleChange("atTimeStart", e.target.value)
                      }
                      sx={textStyle}
                    />
                    <TextField
                      type="time"
                      value={settings.atTimeEnd}
                      onChange={(e) =>
                        handleChange("atTimeEnd", e.target.value)
                      }
                      sx={textStyle}
                    />
                  </Box>
                </Box>
              ) : (
                <Box sx={{ display: "flex", alignItems: "center", width: "100%" }}>
                  <Typography sx={{ marginBottom: "5px", marginRight: "10px" }}>
                    {t("schedule_settings.at_around")}
                  </Typography>
                  <TextField
                    type="time"
                    value={settings.atTimeStart}
                    onChange={(e) =>
                      handleChange("atTimeStart", e.target.value)
                    }
                    sx={textStyle}
                  />
                </Box>
              )}

              <Box sx={{ display: "flex", alignItems: "center", width: "100%" }}>
                <Typography sx={{ marginRight: "10px" }}>
                  {t("schedule_settings.timezone")}
                </Typography>
                <Dropdown
                  label=""
                  id="timezone"
                  value={settings.timezone}
                  handleSelect={(e) =>
                    handleChange("timezone", e.target.value)
                  }
                  sx={dropDownStyle}
                >
                  {validMomentTimezones.map((tz) => (
                    <MenuItem key={tz} value={tz}>
                      {tz.charAt(0).toUpperCase() +
                        tz.slice(1).toLowerCase()}
                    </MenuItem>
                  ))}
                </Dropdown>
              </Box>
            </>
          )}
        </>
      </Box>
    </RobotConfigPage>
  );
};
