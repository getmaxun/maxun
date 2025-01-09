import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { WarningText } from "../../ui/texts";
import InfoIcon from "@mui/icons-material/Info";
import { KeyValueForm } from "../../recorder/KeyValueForm";

export const ScrapeSchemaSettings = forwardRef((props, ref) => {
  const keyValueFormRef = useRef<{ getObject: () => object }>(null);

  useImperativeHandle(ref, () => ({
    getSettings() {
      const settings = keyValueFormRef.current?.getObject() as Record<string, string>
      return settings;
    }
  }));

  return (
    <div>
      <WarningText>
        <InfoIcon color='warning' />
        The interpreter scrapes the data from a webpage into a "curated" table.
      </WarningText>
      <KeyValueForm ref={keyValueFormRef} />
    </div>
  );
});
