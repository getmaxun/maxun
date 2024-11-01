import { default as axios } from "axios";
import { apiUrl } from "../apiConfig";

export const sendProxyConfig = async (proxyConfig: { server_url: string, username?: string, password?: string }): Promise<boolean> => {
    try {
        const response = await axios.post(`${apiUrl}/proxy/config`, proxyConfig);
        if (response.status === 200) {
            return response.data;
        } else {
            throw new Error(`Failed to submit proxy configuration. Status code: ${response.status}`);
        }
    } catch (error: any) {
        console.error('Error sending proxy configuration:', error.message || error);
        return false;
    }
}

export const getProxyConfig = async (): Promise<{ proxy_url: string, auth: boolean }> => {
    try {
        const response = await axios.get(`${apiUrl}/proxy/config`);
        if (response.status === 200) {
            return response.data;
        } else {
            throw new Error(`Failed to fetch proxy configuration. Try again.`);
        }
    } catch (error: any) {
        console.log(error);
        return { proxy_url: '', auth: false };
    }
}

export const testProxyConfig = async (): Promise<{ success: boolean }> => {
    try {
        const response = await axios.get(`${apiUrl}/proxy/test`);
        if (response.status === 200) {
            return response.data;
        } else {
            throw new Error(`Failed to test proxy configuration. Try again.`);
        }
    } catch (error: any) {
        console.log(error);
        return { success: false };
    }
}

export const deleteProxyConfig = async (): Promise<boolean> => {
    try {
        const response = await axios.delete(`${apiUrl}/proxy/config`);
        if (response.status === 200) {
            return response.data;
        } else {
            throw new Error(`Failed to delete proxy configuration. Try again.`);
        }
    } catch (error: any) {
        console.log(error);
        return false;
    }
}