import { IconButton } from "@mui/material";
import { Clear } from "@mui/icons-material";
import React, { FC } from "react";

interface ClearButtonProps {
  handleClick: () => void;
  size?: "small" | "medium" | "large";
}

export const ClearButton: FC<ClearButtonProps> = ({ handleClick, size }) => {
  return (
    <IconButton aria-label="add" size={size || "small"} onClick={handleClick}
      sx={{ color: 'inherit', '&:hover': { color: '#1976d2', backgroundColor: 'transparent' } }}>
      <Clear />
    </IconButton>
  );
};
