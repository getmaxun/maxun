import { Dropdown as MuiDropdown } from "../ui/DropdownMui";
import {
  Button,
  MenuItem,
  Typography
} from "@mui/material";
import React, { useRef } from "react";
import { GenericModal } from "../ui/GenericModal";
import { WhereWhatPair } from "maxun-core";
import { SelectChangeEvent } from "@mui/material/Select/Select";
import { DisplayConditionSettings } from "./DisplayWhereConditionSettings";
import { useSocketStore } from "../../context/socket";

interface AddWhereCondModalProps {
  isOpen: boolean;
  onClose: () => void;
  pair: WhereWhatPair;
  index: number;
}

export const AddWhereCondModal = ({ isOpen, onClose, pair, index }: AddWhereCondModalProps) => {
  const [whereProp, setWhereProp] = React.useState<string>('');
  const [additionalSettings, setAdditionalSettings] = React.useState<string>('');
  const [newValue, setNewValue] = React.useState<any>('');
  const [checked, setChecked] = React.useState<boolean[]>(new Array(Object.keys(pair.where).length).fill(false));

  const keyValueFormRef = useRef<{ getObject: () => object }>(null);

  const { socket } = useSocketStore();

  const handlePropSelect = (event: SelectChangeEvent<string>) => {
    setWhereProp(event.target.value);
    switch (event.target.value) {
      case 'url': setNewValue(''); break;
      case 'selectors': setNewValue(['']); break;
      case 'default': return;
    }
  }

  const handleSubmit = () => {
    switch (whereProp) {
      case 'url':
        if (additionalSettings === 'string') {
          pair.where.url = newValue;
        } else {
          pair.where.url = { $regex: newValue };
        }
        break;
      case 'selectors':
        pair.where.selectors = newValue;
        break;
      case 'cookies':
        pair.where.cookies = keyValueFormRef.current?.getObject() as Record<string, string>
        break;
      case 'before':
        pair.where.$before = newValue;
        break;
      case 'after':
        pair.where.$after = newValue;
        break;
      case 'boolean':
        const booleanArr = [];
        const deleteKeys: string[] = [];
        for (let i = 0; i < checked.length; i++) {
          if (checked[i]) {
            if (Object.keys(pair.where)[i]) {
              //@ts-ignore
              if (pair.where[Object.keys(pair.where)[i]]) {
                booleanArr.push({
                  //@ts-ignore
                  [Object.keys(pair.where)[i]]: pair.where[Object.keys(pair.where)[i]]
                });
              }
              deleteKeys.push(Object.keys(pair.where)[i]);
            }
          }
        }
        // @ts-ignore
        deleteKeys.forEach((key: string) => delete pair.where[key]);
        //@ts-ignore
        pair.where[`$${additionalSettings}`] = booleanArr;
        break;
      default:
        return;
    }
    onClose();
    setWhereProp('');
    setAdditionalSettings('');
    setNewValue('');
    socket?.emit('updatePair', { index: index - 1, pair: pair });
  }

  return (
    <GenericModal isOpen={isOpen} onClose={() => {
      setWhereProp('');
      setAdditionalSettings('');
      setNewValue('');
      onClose();
    }} modalStyle={modalStyle}>
      <div>
        <Typography sx={{ margin: '20px 0px' }}>Add where condition:</Typography>
        <div style={{ margin: '8px' }}>
          <MuiDropdown
            id="whereProp"
            label="Condition"
            value={whereProp}
            handleSelect={handlePropSelect}>
            <MenuItem value="url">url</MenuItem>
            <MenuItem value="selectors">selectors</MenuItem>
            <MenuItem value="cookies">cookies</MenuItem>
            <MenuItem value="before">before</MenuItem>
            <MenuItem value="after">after</MenuItem>
            <MenuItem value="boolean">boolean logic</MenuItem>
          </MuiDropdown>
        </div>
        {whereProp ?
          <div style={{ margin: '8px' }}>
            <DisplayConditionSettings
              whereProp={whereProp} additionalSettings={additionalSettings} setAdditionalSettings={setAdditionalSettings}
              newValue={newValue} setNewValue={setNewValue} checked={checked} setChecked={setChecked}
              keyValueFormRef={keyValueFormRef} whereKeys={Object.keys(pair.where)}
            />
            <Button
              onClick={handleSubmit}
              variant="outlined"
              sx={{
                display: "table-cell",
                float: "right",
                marginRight: "15px",
                marginTop: "20px",
              }}
            >
              {"Add Condition"}
            </Button>
          </div>
          : null}
      </div>
    </GenericModal>
  )
}

export const modalStyle = {
  top: '40%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '30%',
  backgroundColor: 'background.paper',
  p: 4,
  height: 'fit-content',
  display: 'block',
  padding: '20px',
};
