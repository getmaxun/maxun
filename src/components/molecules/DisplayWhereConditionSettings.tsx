import React from "react";
import { Dropdown as MuiDropdown } from "../atoms/DropdownMui";
import { Checkbox, FormControlLabel, FormGroup, MenuItem, Stack, TextField } from "@mui/material";
import { AddButton } from "../ui/buttons/AddButton";
import { RemoveButton } from "../ui/buttons/RemoveButton";
import { KeyValueForm } from "./KeyValueForm";
import { WarningText } from "../atoms/texts";

interface DisplayConditionSettingsProps {
  whereProp: string;
  additionalSettings: string;
  setAdditionalSettings: (value: any) => void;
  newValue: any;
  setNewValue: (value: any) => void;
  keyValueFormRef: React.RefObject<{ getObject: () => object }>;
  whereKeys: string[];
  checked: boolean[];
  setChecked: (value: boolean[]) => void;
}

export const DisplayConditionSettings = (
  { whereProp, setAdditionalSettings, additionalSettings,
    setNewValue, newValue, keyValueFormRef, whereKeys, checked, setChecked }
    : DisplayConditionSettingsProps) => {
  switch (whereProp) {
    case 'url':
      return (
        <React.Fragment>
          <MuiDropdown
            id="url"
            label="type"
            value={additionalSettings}
            handleSelect={(e) => setAdditionalSettings(e.target.value)}>
            <MenuItem value="string">string</MenuItem>
            <MenuItem value="regex">regex</MenuItem>
          </MuiDropdown>
          {additionalSettings ? <TextField
            size='small'
            type="string"
            onChange={(e) => setNewValue(e.target.value)}
            value={newValue}
          /> : null}
        </React.Fragment>
      )
    case 'selectors':
      return (
        <React.Fragment>
          <Stack direction='column' spacing={2}>
            {
              newValue.map((selector: string, index: number) => {
                return <TextField
                  key={`whereProp-selector-${index}`}
                  size='small'
                  type="string"
                  onChange={(e) => setNewValue([
                    ...newValue.slice(0, index),
                    e.target.value,
                    ...newValue.slice(index + 1)
                  ])} />
              })
            }
          </Stack>
          <AddButton handleClick={() => setNewValue([...newValue, ''])} />
          <RemoveButton handleClick={() => {
            const arr = newValue;
            arr.splice(-1);
            setNewValue([...arr]);
          }} />
        </React.Fragment>
      )
    case 'cookies':
      return <KeyValueForm ref={keyValueFormRef} />
    case 'before':
      return <TextField
        label='pair id'
        size='small'
        type="string"
        onChange={(e) => setNewValue(e.target.value)}
      />
    case 'after':
      return <TextField
        label='pair id'
        size='small'
        type="string"
        onChange={(e) => setNewValue(e.target.value)}
      />
    case 'boolean':
      return (
        <React.Fragment>
          <MuiDropdown
            id="boolean"
            label="operator"
            value={additionalSettings}
            handleSelect={(e) => setAdditionalSettings(e.target.value)}>
            <MenuItem value="and">and</MenuItem>
            <MenuItem value="or">or</MenuItem>
          </MuiDropdown>
          <FormGroup>
            {
              whereKeys.map((key: string, index: number) => {
                return (
                  <FormControlLabel control={
                    <Checkbox
                      checked={checked[index]}
                      onChange={() => setChecked([
                        ...checked.slice(0, index),
                        !checked[index],
                        ...checked.slice(index + 1)
                      ])}
                      key={`checkbox-${key}-${index}`}
                    />
                  } label={key} key={`control-label-form-${key}-${index}`} />
                )
              })
            }
          </FormGroup>
          <WarningText>
            Choose at least 2 where conditions. Nesting of boolean operators
            is possible by adding more conditions.
          </WarningText>
        </React.Fragment>
      )
    default:
      return null;
  }
}
