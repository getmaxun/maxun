import { Button, TextField, Typography } from "@mui/material";
import React, { FC } from "react";
import { Preprocessor, WhereWhatPair } from "maxun-core";

interface PairProps {
  index: string;
  id?: string;
  where: string | null;
  what: string | null;
}

interface PairEditFormProps {
  onSubmitOfPair: (value: WhereWhatPair, index: number) => void;
  numberOfPairs: number;
  index?: string;
  where?: string;
  what?: string;
  id?: string;
}

export const PairEditForm: FC<PairEditFormProps> = (
  {
    onSubmitOfPair,
    numberOfPairs,
    index,
    where,
    what,
    id,
  }) => {
  const [pairProps, setPairProps] = React.useState<PairProps>({
    where: where || null,
    what: what || null,
    index: index || "1",
    id: id || '',
  });
  const [errors, setErrors] = React.useState<PairProps>({
    where: null,
    what: null,
    index: '',
  });

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = event.target;
    if (id === 'index') {
      if (parseInt(value, 10) < 1) {
        setErrors({ ...errors, index: 'Index must be greater than 0' });
        return;
      } else {
        setErrors({ ...errors, index: '' });
      }
    }
    setPairProps({ ...pairProps, [id]: value });
  };

  const validateAndSubmit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    let whereFromPair, whatFromPair;
    // validate where
    whereFromPair = {
      where: pairProps.where && pairProps.where !== '{"url":"","selectors":[""] }'
        ? JSON.parse(pairProps.where)
        : {},
      what: [],
    };
    const validationError = Preprocessor.validateWorkflow({ workflow: [whereFromPair] });
    setErrors({ ...errors, where: null });
    if (validationError) {
      setErrors({ ...errors, where: validationError.message });
      return;
    }
    // validate what
    whatFromPair = {
      where: {},
      what: pairProps.what && pairProps.what !== '[{"action":"","args":[""] }]'
        ? JSON.parse(pairProps.what) : [],
    };
    const validationErrorWhat = Preprocessor.validateWorkflow({ workflow: [whatFromPair] });
    setErrors({ ...errors, "what": null });
    if (validationErrorWhat) {
      setErrors({ ...errors, what: validationErrorWhat.message });
      return;
    }
    //validate index
    const index = parseInt(pairProps?.index, 10);
    if (index > (numberOfPairs + 1)) {
      if (numberOfPairs === 0) {
        setErrors(prevState => ({
          ...prevState,
          index: 'Index of the first pair must be 1'
        }));
        return;
      } else {
        setErrors(prevState => ({
          ...prevState,
          index: `Index must be in the range 1-${numberOfPairs + 1}`
        }));
        return;
      }
    } else {
      setErrors({ ...errors, index: '' });
    }
    // submit the pair
    onSubmitOfPair(pairProps.id
      ? {
        id: pairProps.id,
        where: whereFromPair?.where || {},
        what: whatFromPair?.what || [],
      }
      : {
        where: whereFromPair?.where || {},
        what: whatFromPair?.what || [],
      }
      , index);
  };

  return (
    <form
      onSubmit={validateAndSubmit}
      style={{
        display: "grid",
        padding: "0px 30px 0px 30px",
        marginTop: "36px",
      }}
    >
      <Typography sx={{ marginBottom: '30px' }} variant='h5'>Raw pair edit form:</Typography>
      <TextField sx={{
        display: "block",
        marginBottom: "20px"
      }} id="index" label="Index" type="number"
        InputProps={{ inputProps: { min: 1 } }}
        InputLabelProps={{
          shrink: true,
        }} defaultValue={pairProps.index}
        onChange={handleInputChange}
        error={!!errors.index} helperText={errors.index}
        required
      />
      <TextField sx={{
        marginBottom: "20px"
      }} id="id" label="Id" type="string"
        defaultValue={pairProps.id}
        onChange={handleInputChange}
      />
      <TextField multiline sx={{ marginBottom: "20px" }}
        id="where" label="Where" variant="outlined" onChange={handleInputChange}
        defaultValue={where || '{"url":"","selectors":[""]}'}
        error={!!errors.where} helperText={errors.where} />
      <TextField multiline sx={{ marginBottom: "20px" }}
        id="what" label="What" variant="outlined" onChange={handleInputChange}
        defaultValue={what || '[{"action":"","args":[""]}]'}
        error={!!errors.what} helperText={errors.what} />
      <Button
        type="submit"
        variant="contained"
        sx={{ padding: "8px 20px", }}
      >
        Save
      </Button>
    </form>
  );
};
