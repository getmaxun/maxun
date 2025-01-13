import { IconButton } from "@mui/material";
import { Remove } from "@mui/icons-material";
import React, { FC } from "react";

interface RemoveButtonProps {
  handleClick: () => void;
  size?: "small" | "medium" | "large";
}

export const RemoveButton: FC<RemoveButtonProps> = ({ handleClick, size }) => {
  return (
    <IconButton aria-label="add" size={size || "small"} onClick={handleClick}
      sx={{ '&:hover': { color: '#1976d2', backgroundColor: 'transparent' } }}>
      <Remove />
    </IconButton>
  );
};
