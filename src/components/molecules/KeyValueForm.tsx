import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { KeyValuePair } from "../atoms/KeyValuePair";
import { AddButton } from "../atoms/buttons/AddButton";
import { RemoveButton } from "../atoms/buttons/RemoveButton";

export const KeyValueForm = forwardRef((props, ref) => {
  const [numberOfPairs, setNumberOfPairs] = React.useState<number>(1);
  const keyValuePairRefs = useRef<{ getKeyValuePair: () => { key: string, value: string } }[]>([]);

  useImperativeHandle(ref, () => ({
    getObject() {
      let reducedObject = {};
      for (let i = 0; i < numberOfPairs; i++) {
        const keyValuePair = keyValuePairRefs.current[i]?.getKeyValuePair();
        if (keyValuePair) {
          reducedObject = {
            ...reducedObject,
            [keyValuePair.key]: keyValuePair.value
          }
        }
      }
      return reducedObject;
    }
  }));

  return (
    <div>
      {
        new Array(numberOfPairs).fill(1).map((_, index) => {
          return <KeyValuePair keyLabel={`key ${index + 1}`} valueLabel={`value ${index + 1}`} key={`keyValuePair-${index}`}
            //@ts-ignore
            ref={el => keyValuePairRefs.current[index] = el} />
        })
      }
      <AddButton handleClick={() => setNumberOfPairs(numberOfPairs + 1)} hoverEffect={false} />
      <RemoveButton handleClick={() => setNumberOfPairs(numberOfPairs - 1)} />
    </div>
  );
});
