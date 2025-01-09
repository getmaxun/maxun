import React, { useLayoutEffect, useRef, useState } from 'react';
import { WhereWhatPair } from "maxun-core";
import { Box, Button, IconButton, MenuItem, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { Close, KeyboardArrowDown, KeyboardArrowUp } from "@mui/icons-material";
import TreeView from '@mui/lab/TreeView';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TreeItem from '@mui/lab/TreeItem';
import { AddButton } from "../atoms/buttons/AddButton";
import { WarningText } from "../atoms/texts";
import NotificationImportantIcon from '@mui/icons-material/NotificationImportant';
import { RemoveButton } from "../atoms/buttons/RemoveButton";
import { AddWhereCondModal } from "./AddWhereCondModal";
import { UpdatePair } from "../../api/workflow";
import { useSocketStore } from "../../context/socket";
import { AddWhatCondModal } from "./AddWhatCondModal";

interface PairDetailProps {
  pair: WhereWhatPair | null;
  index: number;
}

export const PairDetail = ({ pair, index }: PairDetailProps) => {
  const [pairIsSelected, setPairIsSelected] = useState(false);
  const [collapseWhere, setCollapseWhere] = useState(true);
  const [collapseWhat, setCollapseWhat] = useState(true);
  const [rerender, setRerender] = useState(false);
  const [expanded, setExpanded] = React.useState<string[]>(
    pair ? Object.keys(pair.where).map((key, index) => `${key}-${index}`) : []
  );
  const [addWhereCondOpen, setAddWhereCondOpen] = useState(false);
  const [addWhatCondOpen, setAddWhatCondOpen] = useState(false);

  const { socket } = useSocketStore();

  const handleCollapseWhere = () => {
    setCollapseWhere(!collapseWhere);
  }

  const handleCollapseWhat = () => {
    setCollapseWhat(!collapseWhat);
  }

  const handleToggle = (event: React.SyntheticEvent, nodeIds: string[]) => {
    setExpanded(nodeIds);
  };

  useLayoutEffect(() => {
    if (pair) {
      setPairIsSelected(true);
    }
  }, [pair])

  const handleChangeValue = (value: any, where: boolean, keys: (string | number)[]) => {
    // a moving reference to internal objects within pair.where or pair.what
    let schema: any = where ? pair?.where : pair?.what;
    const length = keys.length;
    for (let i = 0; i < length - 1; i++) {
      const elem = keys[i];
      if (!schema[elem]) schema[elem] = {}
      schema = schema[elem];
    }

    schema[keys[length - 1]] = value;
    if (pair && socket) {
      socket.emit('updatePair', { index: index - 1, pair: pair });
    }
    setRerender(!rerender);
  }


  const DisplayValueContent = (value: any, keys: (string | number)[], where: boolean = true) => {
    switch (typeof (value)) {
      case 'string':
        return <TextField
          size='small'
          type="string"
          onChange={(e) => {
            try {
              const obj = JSON.parse(e.target.value);
              handleChangeValue(obj, where, keys);
            } catch (error) {
              const num = Number(e.target.value);
              if (!isNaN(num)) {
                handleChangeValue(num, where, keys);
              }
              handleChangeValue(e.target.value, where, keys)
            }
          }}
          defaultValue={value}
          key={`text-field-${keys.join('-')}-${where}`}
        />
      case 'number':
        return <TextField
          size='small'
          type="number"
          onChange={(e) => handleChangeValue(Number(e.target.value), where, keys)}
          defaultValue={value}
          key={`text-field-${keys.join('-')}-${where}`}
        />
      case 'object':
        if (value) {
          if (Array.isArray(value)) {
            return (
              <React.Fragment>
                {
                  value.map((element, index) => {
                    return DisplayValueContent(element, [...keys, index], where);
                  })
                }
                <AddButton handleClick={() => {
                  let prevValue: any = where ? pair?.where : pair?.what;
                  for (const key of keys) {
                    prevValue = prevValue[key];
                  }
                  handleChangeValue([...prevValue, ''], where, keys);
                  setRerender(!rerender);
                }} hoverEffect={false} />
                <RemoveButton handleClick={() => {
                  let prevValue: any = where ? pair?.where : pair?.what;
                  for (const key of keys) {
                    prevValue = prevValue[key];
                  }
                  prevValue.splice(-1);
                  handleChangeValue(prevValue, where, keys);
                  setRerender(!rerender);
                }} />
              </React.Fragment>
            )
          } else {
            return (
              <TreeView
                defaultCollapseIcon={<ExpandMoreIcon />}
                defaultExpandIcon={<ChevronRightIcon />}
                sx={{ flexGrow: 1, overflowY: 'auto' }}
                key={`tree-view-nested-${keys.join('-')}-${where}`}
              >
                {
                  Object.keys(value).map((key2, index) => {
                    return (
                      <TreeItem nodeId={`${key2}-${index}`} label={`${key2}:`} key={`${key2}-${index}`}>
                        {DisplayValueContent(value[key2], [...keys, key2], where)}
                      </TreeItem>
                    )
                  })
                }
              </TreeView>
            )
          }
        }
        break;
      default:
        return null;
    }
  }

  return (
    <React.Fragment>
      {pair &&
        <React.Fragment>
          <AddWhatCondModal isOpen={addWhatCondOpen} onClose={() => setAddWhatCondOpen(false)}
            pair={pair} index={index} />
          <AddWhereCondModal isOpen={addWhereCondOpen} onClose={() => setAddWhereCondOpen(false)}
            pair={pair} index={index} />
        </React.Fragment>
      }
      {
        pairIsSelected
          ? (
            <div style={{ padding: '10px', overflow: 'hidden' }}>
              <Typography>Pair number: {index}</Typography>
              <TextField
                size='small'
                label='id'
                onChange={(e) => {
                  if (pair && socket) {
                    socket.emit('updatePair', { index: index - 1, pair: pair });
                    pair.id = e.target.value;
                  }
                }}
                value={pair ? pair.id ? pair.id : '' : ''}
              />
              <Stack spacing={0} direction='row' sx={{
                display: 'flex',
                alignItems: 'center',
                background: 'lightGray',
              }}>
                <CollapseButton
                  handleClick={handleCollapseWhere}
                  isCollapsed={collapseWhere}
                />
                <Typography>Where</Typography>
                <Tooltip title='Add where condition' placement='right'>
                  <div>
                    <AddButton handleClick={() => {
                      setAddWhereCondOpen(true);
                    }} style={{ color: 'rgba(0, 0, 0, 0.54)', background: 'transparent' }} />
                  </div>
                </Tooltip>
              </Stack>
              {(collapseWhere && pair && pair.where)
                ?
                <React.Fragment>
                  {Object.keys(pair.where).map((key, index) => {
                    return (
                      <TreeView
                        expanded={expanded}
                        defaultCollapseIcon={<ExpandMoreIcon />}
                        defaultExpandIcon={<ChevronRightIcon />}
                        sx={{ flexGrow: 1, overflowY: 'auto' }}
                        onNodeToggle={handleToggle}
                        key={`tree-view-${key}-${index}`}
                      >
                        <TreeItem nodeId={`${key}-${index}`} label={`${key}:`} key={`${key}-${index}`}>
                          {
                            // @ts-ignore
                            DisplayValueContent(pair.where[key], [key])
                          }
                        </TreeItem>
                      </TreeView>
                    );
                  })}
                </React.Fragment>
                : null
              }
              <Stack spacing={0} direction='row' sx={{
                display: 'flex',
                alignItems: 'center',
                background: 'lightGray',
              }}>
                <CollapseButton
                  handleClick={handleCollapseWhat}
                  isCollapsed={collapseWhat}
                />
                <Typography>What</Typography>

                <Tooltip title='Add what condition' placement='right'>
                  <div>
                    <AddButton handleClick={() => {
                      setAddWhatCondOpen(true);
                    }} style={{ color: 'rgba(0, 0, 0, 0.54)', background: 'transparent' }} />
                  </div>
                </Tooltip>
              </Stack>
              {(collapseWhat && pair && pair.what)
                ? (
                  <React.Fragment>
                    {Object.keys(pair.what).map((key, index) => {
                      return (
                        <TreeView
                          defaultCollapseIcon={<ExpandMoreIcon />}
                          defaultExpandIcon={<ChevronRightIcon />}
                          sx={{ flexGrow: 1, overflowY: 'auto' }}
                          key={`tree-view-2-${key}-${index}`}
                        >
                          <TreeItem nodeId={`${key}-${index}`} label={`${pair.what[index].action}`}>
                            {
                              // @ts-ignore
                              DisplayValueContent(pair.what[key], [key], false)
                            }
                            <Tooltip title='remove action' placement='left'>
                              <div style={{ float: 'right' }}>
                                <CloseButton handleClick={() => {
                                  //@ts-ignore
                                  pair.what.splice(key, 1);
                                  setRerender(!rerender);
                                }} />
                              </div>
                            </Tooltip>
                          </TreeItem>
                        </TreeView>
                      );
                    })}
                  </React.Fragment>
                )
                : null
              }
            </div>
          )
          : <WarningText>
            <NotificationImportantIcon color="warning" />
            No pair from the left side panel was selected.
          </WarningText>
      }
    </React.Fragment>
  );
}

interface CollapseButtonProps {
  handleClick: () => void;
  isCollapsed?: boolean;
}

const CollapseButton = ({ handleClick, isCollapsed }: CollapseButtonProps) => {
  return (
    <IconButton aria-label="add" size={"small"} onClick={handleClick}>
      {isCollapsed ? <KeyboardArrowDown /> : <KeyboardArrowUp />}
    </IconButton>
  );
}

const CloseButton = ({ handleClick }: CollapseButtonProps) => {
  return (
    <IconButton aria-label="add" size={"small"} onClick={handleClick}
      sx={{ '&:hover': { color: '#1976d2', backgroundColor: 'white' } }}>
      <Close />
    </IconButton>
  );
}
