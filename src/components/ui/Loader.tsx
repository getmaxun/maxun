import styled from "styled-components";
import { Stack } from "@mui/material";
import { useThemeMode } from "../../context/theme-provider";

interface LoaderProps {
  text: string;
}

export const Loader: React.FC<LoaderProps> = ({ text }) => {
  const { darkMode } = useThemeMode();

  return (
    <Stack direction="column" sx={{ margin: "30px 0px", alignItems: "center" }}>
      <DotsContainer>
        <Dot />
        <Dot />
        <Dot />
        <Dot />
      </DotsContainer>
      <StyledParagraph darkMode={darkMode}>{text}</StyledParagraph>
    </Stack>
  );
};

interface StyledParagraphProps {
  darkMode: boolean;
}

const StyledParagraph = styled.p<StyledParagraphProps>`
  font-size: large;
  font-family: inherit;
  color: ${({ darkMode }) => (darkMode ? 'white' : '#333')};
  margin-top: 20px;
`;

const DotsContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 15px; /* Space between dots */
`;

const Dot = styled.div`
  width: 15px;
  height: 15px;
  background-color: #ff00c3;
  border-radius: 50%;
  animation: intensePulse 1.2s infinite ease-in-out both, bounceAndPulse 1.5s infinite ease-in-out;

  &:nth-child(1) {
    animation-delay: -0.3s;
  }
  &:nth-child(2) {
    animation-delay: -0.2s;
  }
  &:nth-child(3) {
    animation-delay: -0.1s;
  }
  &:nth-child(4) {
    animation-delay: 0s;
  }

  @keyframes bounceAndPulse {
    0%, 100% {
      transform: translateY(0) scale(1);
    }
    50% {
      transform: translateY(-10px) scale(1.3);
    }
  }

  @keyframes intensePulse {
    0%, 100% {
      box-shadow: 0 0 0 0 rgba(255, 0, 195, 0.7);
    }
    50% {
      box-shadow: 0 0 15px 10px rgba(255, 0, 195, 0.3);
    }
  }
`;
