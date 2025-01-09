import React, { FC } from 'react';
import Typography from '@mui/material/Typography';
import { WhereWhatPair } from "maxun-core";
import styled from "styled-components";

interface PairDisplayDivProps {
  index: string;
  pair: WhereWhatPair;
}

export const PairDisplayDiv: FC<PairDisplayDivProps> = ({ index, pair }) => {

  return (
    <div>
      <Typography sx={{ marginBottom: '10px', marginTop: '25px' }} id="pair-index" variant="h6" component="h2">
        {`Index: ${index}`}
        {pair.id ? `, Id: ${pair.id}` : ''}
      </Typography>
      <Typography id="where-title" variant="h6" component="h2">
        {"Where:"}
      </Typography>
      <DescriptionWrapper id="where-description">
        <pre>{JSON.stringify(pair?.where, undefined, 2)}</pre>
      </DescriptionWrapper>
      <Typography id="what-title" variant="h6" component="h2">
        {"What:"}
      </Typography>
      <DescriptionWrapper id="what-description">
        <pre>{JSON.stringify(pair?.what, undefined, 2)}</pre>
      </DescriptionWrapper>
    </div>
  );
}

const DescriptionWrapper = styled.div`
  margin: 0;
  font-family: "Roboto","Helvetica","Arial",sans-serif;
  font-weight: 400;
  font-size: 1rem;
  line-height: 1.5;
  letter-spacing: 0.00938em;
`;
