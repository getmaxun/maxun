import { WhereWhatPair } from "maxun-core";
import { GenericModal } from "../atoms/GenericModal";
import { modalStyle } from "./AddWhereCondModal";
import { Button, MenuItem, TextField, Typography } from "@mui/material";
import React, { useRef } from "react";
import { Dropdown as MuiDropdown } from "../ui/DropdownMui";
import { KeyValueForm } from "./KeyValueForm";
import { ClearButton } from "../ui/buttons/ClearButton";
import { useSocketStore } from "../../context/socket";

interface AddWhatCondModalProps {
  isOpen: boolean;
  onClose: () => void;
  pair: WhereWhatPair;
  index: number;
}

export const AddWhatCondModal = ({ isOpen, onClose, pair, index }: AddWhatCondModalProps) => {
  const [action, setAction] = React.useState<string>('');
  const [objectIndex, setObjectIndex] = React.useState<number>(0);
  const [args, setArgs] = React.useState<({ type: string, value: (string | number | object | unknown) })[]>([]);

  const objectRefs = useRef<({ getObject: () => object } | unknown)[]>([]);

  const { socket } = useSocketStore();

  const handleSubmit = () => {
    const argsArray: (string | number | object | unknown)[] = [];
    args.map((arg, index) => {
      switch (arg.type) {
        case 'string':
        case 'number':
          argsArray[index] = arg.value;
          break;
        case 'object':
          // @ts-ignore
          argsArray[index] = objectRefs.current[arg.value].getObject();
      }
    })
    setArgs([]);
    onClose();
    pair.what.push({
      // @ts-ignore
      action,
      args: argsArray,
    })
    socket?.emit('updatePair', { index: index - 1, pair: pair });
  }

  return (
    <GenericModal isOpen={isOpen} onClose={() => {
      setArgs([]);
      onClose();
    }} modalStyle={modalStyle}>
      <div>
        <Typography sx={{ margin: '20px 0px' }}>Add what condition:</Typography>
        <div style={{ margin: '8px' }}>
          <Typography>Action:</Typography>
          <TextField
            size='small'
            type="string"
            onChange={(e) => setAction(e.target.value)}
            value={action}
            label='action'
          />
          <div>
            <Typography>Add new argument of type:</Typography>
            <Button onClick={() => setArgs([...args, { type: 'string', value: null }])}>string</Button>
            <Button onClick={() => setArgs([...args, { type: 'number', value: null }])}>number</Button>
            <Button onClick={() => {
              setArgs([...args, { type: 'object', value: objectIndex }])
              setObjectIndex(objectIndex + 1);
            }}>object</Button>
          </div>
          <Typography>args:</Typography>
          {args.map((arg, index) => {
            // @ts-ignore
            return (
              <div style={{ border: 'solid 1px gray', padding: '10px', display: 'flex', flexDirection: 'row', alignItems: 'center' }}
                key={`wrapper-for-${arg.type}-${index}`}>
                <ClearButton handleClick={() => {
                  args.splice(index, 1);
                  setArgs([...args]);
                }} />
                <Typography sx={{ margin: '5px' }} key={`number-argument-${arg.type}-${index}`}>{index}: </Typography>
                {arg.type === 'string' ?
                  <TextField
                    size='small'
                    type="string"
                    onChange={(e) => setArgs([
                      ...args.slice(0, index),
                      { type: arg.type, value: e.target.value },
                      ...args.slice(index + 1)
                    ])}
                    value={args[index].value || ''}
                    label="string"
                    key={`arg-${arg.type}-${index}`}
                  /> : arg.type === 'number' ?
                    <TextField
                      key={`arg-${arg.type}-${index}`}
                      size='small'
                      type="number"
                      onChange={(e) => setArgs([
                        ...args.slice(0, index),
                        { type: arg.type, value: Number(e.target.value) },
                        ...args.slice(index + 1)
                      ])}
                      value={args[index].value || ''}
                      label="number"
                    /> :
                    <KeyValueForm ref={el =>
                      //@ts-ignore
                      objectRefs.current[arg.value] = el} key={`arg-${arg.type}-${index}`} />
                }
              </div>
            )
          })}
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
      </div>
    </GenericModal>
  )
}
