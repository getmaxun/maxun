import { default as axios } from "axios";
import { apiUrl } from "../apiConfig";

export const handleUploadCredentials = async (fileName: string, credentials: any, spreadsheetId: string, range: string): Promise<boolean> => {
    try {
        const response = await axios.post(`${apiUrl}/integration/upload-credentials`, { fileName, credentials: JSON.parse(credentials), spreadsheetId, range });
        if (response.status === 200) {
            return response.data;
        } else {
            throw new Error(`Couldn't make gsheet integration for ${fileName}`);
        }
    } catch (error) {
        console.error('Error uploading credentials:', error);
        return false;
    }
};

export const updateN8nIntegration = async (robotId: string, webhookUrl: string, webhookName: string, apiKey?: string, instanceUrl?: string) => {
    try {
        const response = await axios.post(
            `${apiUrl}/auth/n8n/update`,
            {
                robotId,
                webhookUrl,
                webhookName,
                apiKey: apiKey || null,
                instanceUrl: instanceUrl || null,
            },
            { withCredentials: true }
        );
        
        return {
            ok: response.status === 200,
            data: response.data
        };
    } catch (error: any) {
        return {
            ok: false,
            error: error.response?.data?.error || error.message
        };
    }
};

export const removeN8nIntegration = async (robotId: string) => {
    try {
        const response = await axios.post(
            `${apiUrl}/auth/n8n/remove`,
            { robotId },
            { withCredentials: true }
        );
        
        return {
            ok: response.status === 200,
            data: response.data
        };
    } catch (error: any) {
        return {
            ok: false,
            error: error.response?.data?.error || error.message
        };
    }
};

export const testN8nWebhook = async (robotId: string) => {
    try {
        const response = await axios.post(
            `${apiUrl}/auth/n8n/test`,
            { robotId },
            { withCredentials: true }
        );
        
        return {
            ok: response.status === 200,
            data: response.data
        };
    } catch (error: any) {
        return {
            ok: false,
            error: error.response?.data?.error || error.message
        };
    }
};

