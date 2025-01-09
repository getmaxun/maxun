import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { SyntheticEvent } from 'react';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import { NavBarForm, NavBarInput } from "../ui/form";
import { UrlFormButton } from "../ui/buttons/buttons";
import { useSocketStore } from '../../context/socket';
import { Socket } from "socket.io-client";

// TODO: Bring back REFRESHHHHHHH
type Props = {
    currentAddress: string;
    handleRefresh: (socket: Socket) => void;
    setCurrentAddress: (address: string) => void;
};

export const UrlForm = ({
    currentAddress,
    handleRefresh,
    setCurrentAddress,
}: Props) => {
    const [address, setAddress] = useState<string>(currentAddress);
    const { socket } = useSocketStore();
    const lastSubmittedRef = useRef<string>('');

    const onChange = useCallback((event: SyntheticEvent): void => {
        setAddress((event.target as HTMLInputElement).value);
    }, []);

    const submitForm = useCallback((url: string): void => {
        // Add protocol if missing
        if (!/^(?:f|ht)tps?\:\/\//.test(url)) {
            url = "https://" + url;
            setAddress(url);  // Update the input field to reflect protocol addition
        }

        try {
            // Validate the URL
            new URL(url);
            setCurrentAddress(url);
            lastSubmittedRef.current = url;  // Update the last submitted URL
        } catch (e) {
            //alert(`ERROR: ${url} is not a valid url!`);
            console.log(e)
        }
    }, [setCurrentAddress]);

    const onSubmit = (event: SyntheticEvent): void => {
        event.preventDefault();
        submitForm(address);
    };

    // Sync internal state with currentAddress prop when it changes and auto-submit once
    useEffect(() => {
        setAddress(currentAddress);
        if (currentAddress !== '' && currentAddress !== lastSubmittedRef.current) {
            submitForm(currentAddress);
        }
    }, [currentAddress, submitForm]);

    return (
        <NavBarForm onSubmit={onSubmit}>
            <NavBarInput
                type="text"
                value={address}
                onChange={onChange}
                readOnly
            />
            <UrlFormButton type="submit">
                <KeyboardArrowRightIcon />
            </UrlFormButton>
        </NavBarForm>
    );
};