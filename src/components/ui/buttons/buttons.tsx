import styled from 'styled-components';
import { useThemeMode } from '../../../context/theme-provider';

export const NavBarButton = styled.button<{ disabled: boolean, mode: 'light' | 'dark' }>`
    margin-left: 10px;
    margin-right: 5px;
    padding: 0;
    border: none;
    background-color: ${mode => mode ? '#333' : '#ffffff'};
    cursor: ${({ disabled }) => disabled ? 'default' : 'pointer'};
    width: 24px;
    height: 24px;
    border-radius: 12px;
    outline: none;
    color: ${mode => mode ? '#ffffff' : '#333333'};
`;

export const UrlFormButton = styled.button`
    position: absolute;
    top: 0;
    right: 10px;
    padding: 0;
    border: none;
    background-color: transparent;
    cursor: pointer;
    width: 24px;
    height: 24px;
    border-radius: 12px;
    outline: none;
    // color: #333;
    
    // &:hover {
    //   background-color: #ddd;
    // },
    
    // &:active {
    //   background-color: #d0d0d0;
    // },
`;
