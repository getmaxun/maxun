import React, { useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import BrowserNavBar from "../molecules/BrowserNavBar";
import { BrowserWindow } from "./BrowserWindow";
import { useBrowserDimensionsStore } from "../../context/browserDimensions";
import { BrowserTabs } from "../molecules/BrowserTabs";
import { useSocketStore } from "../../context/socket";
import {
  getCurrentTabs,
  getCurrentUrl,
  interpretCurrentRecording,
} from "../../api/recording";
import { Box } from "@mui/material";
import { InterpretationLog } from "../molecules/InterpretationLog";

// TODO: Tab !show currentUrl after recordingUrl global state
export const BrowserContent = () => {
  const { width } = useBrowserDimensionsStore();
  const { socket } = useSocketStore();

  const [tabs, setTabs] = useState<string[]>(["current"]);
  const [tabIndex, setTabIndex] = React.useState(0);
  const [showOutputData, setShowOutputData] = useState(false);

  const handleChangeIndex = useCallback(
    (index: number) => {
      setTabIndex(index);
    },
    [tabIndex]
  );

  const handleCloseTab = useCallback(
    (index: number) => {
      // the tab needs to be closed on the backend
      socket?.emit("closeTab", {
        index,
        isCurrent: tabIndex === index,
      });
      // change the current index as current tab gets closed
      if (tabIndex === index) {
        if (tabs.length > index + 1) {
          handleChangeIndex(index);
        } else {
          handleChangeIndex(index - 1);
        }
      } else {
        handleChangeIndex(tabIndex - 1);
      }
      // update client tabs
      setTabs((prevState) => [
        ...prevState.slice(0, index),
        ...prevState.slice(index + 1),
      ]);
    },
    [tabs, socket, tabIndex]
  );

  const handleAddNewTab = useCallback(() => {
    // Adds new tab by pressing the plus button
    socket?.emit("addTab");
    // Adds a new tab to the end of the tabs array and shifts focus
    setTabs((prevState) => [...prevState, "new tab"]);
    handleChangeIndex(tabs.length);
  }, [socket, tabs]);

  const handleNewTab = useCallback(
    (tab: string) => {
      // Adds a new tab to the end of the tabs array and shifts focus
      setTabs((prevState) => [...prevState, tab]);
      // changes focus on the new tab - same happens in the remote browser
      handleChangeIndex(tabs.length);
      handleTabChange(tabs.length);
    },
    [tabs]
  );

  const handleTabChange = useCallback(
    (index: number) => {
      // page screencast and focus needs to be changed on backend
      socket?.emit("changeTab", index);
    },
    [socket]
  );

  const handleUrlChanged = (url: string) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname) {
      const host = parsedUrl.hostname
        .match(/\b(?!www\.)[a-zA-Z0-9]+/g)
        ?.join(".");
      if (host && host !== tabs[tabIndex]) {
        setTabs((prevState) => [
          ...prevState.slice(0, tabIndex),
          host,
          ...prevState.slice(tabIndex + 1),
        ]);
      }
    } else {
      if (tabs[tabIndex] !== "new tab") {
        setTabs((prevState) => [
          ...prevState.slice(0, tabIndex),
          "new tab",
          ...prevState.slice(tabIndex + 1),
        ]);
      }
    }
  };

  const tabHasBeenClosedHandler = useCallback(
    (index: number) => {
      handleCloseTab(index);
    },
    [handleCloseTab]
  );

  useEffect(() => {
    if (socket) {
      socket.on("newTab", handleNewTab);
      socket.on("tabHasBeenClosed", tabHasBeenClosedHandler);
    }
    return () => {
      if (socket) {
        socket.off("newTab", handleNewTab);
        socket.off("tabHasBeenClosed", tabHasBeenClosedHandler);
      }
    };
  }, [socket, handleNewTab]);

  useEffect(() => {
    getCurrentTabs()
      .then((response) => {
        if (response) {
          setTabs(response);
        }
      })
      .catch((error) => {
        console.log("Fetching current url failed");
      });
  }, [handleUrlChanged]);

  return (
    <div id="browser">
      <BrowserTabs
        tabs={tabs}
        handleTabChange={handleTabChange}
        handleAddNewTab={handleAddNewTab}
        handleCloseTab={handleCloseTab}
        handleChangeIndex={handleChangeIndex}
        tabIndex={tabIndex}
      />
      <BrowserNavBar
        // todo: use width from browser dimension once fixed
        browserWidth={900}
        handleUrlChanged={handleUrlChanged}
      />
      <BrowserWindow />
    </div>
  );
};

const BrowserContentWrapper = styled.div``;
