import { IconButton } from "@mui/material";
import { Circle } from "@mui/icons-material";

interface BreakpointButtonProps {
  handleClick: () => void;
  size?: "small" | "medium" | "large";
  changeColor?: boolean;
}

export const BreakpointButton =
  ({ handleClick, size, changeColor }: BreakpointButtonProps) => {
    return (
      <IconButton aria-label="add" size={size || "small"} onClick={handleClick}
        sx={{
          "&:hover": {
            background: 'transparent',
          }
        }}
      >
        <Circle sx={{
          fontSize: '1rem',
          marginLeft: '5px',
          color: changeColor ? 'red' : 'gray',
          "&:hover": {
            color: changeColor ? 'darkRed' : 'dimgray',
          }
        }} />
      </IconButton>
    );
  };
