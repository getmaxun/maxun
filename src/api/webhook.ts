import { default as axios } from "axios";
import { apiUrl } from "../apiConfig";

export interface WebhookConfig {
    id: string;
    url: string;
    events: string[];
    active: boolean;
    createdAt?: string;
    updatedAt?: string;
    lastCalledAt?: string | null;
    retryAttempts?: number;
    retryDelay?: number;
    timeout?: number;
}

export interface WebhookResponse {
    ok: boolean;
    message?: string;
    webhook?: WebhookConfig;
    webhooks?: WebhookConfig[];
    error?: string;
    details?: any;
}

export const addWebhook = async (webhook: WebhookConfig, robotId: string): Promise<WebhookResponse> => {
    try {
        const response = await axios.post(`${apiUrl}/webhook/add`, {
            webhook,
            robotId
        }, { withCredentials: true });

        if (response.status === 200) {
            return response.data;
        } else {
            throw new Error(`Failed to add webhook. Status code: ${response.status}`);
        }
    } catch (error: any) {
        console.error('Error adding webhook:', error.message || error);
        return {
            ok: false,
            error: error.response?.data?.message || error.message || 'Failed to add webhook'
        };
    }
};

export const updateWebhook = async (webhook: WebhookConfig, robotId: string): Promise<WebhookResponse> => {
    try {
        const response = await axios.post(`${apiUrl}/webhook/update`, {
            webhook,
            robotId
        }, { withCredentials: true });

        if (response.status === 200) {
            return response.data;
        } else {
            throw new Error(`Failed to update webhook. Status code: ${response.status}`);
        }
    } catch (error: any) {
        console.error('Error updating webhook:', error.message || error);
        return {
            ok: false,
            error: error.response?.data?.message || error.message || 'Failed to update webhook'
        };
    }
};

export const removeWebhook = async (webhookId: string, robotId: string): Promise<WebhookResponse> => {
    try {
        const response = await axios.post(`${apiUrl}/webhook/remove`, {
            webhookId,
            robotId
        }, { withCredentials: true });

        if (response.status === 200) {
            return response.data;
        } else {
            throw new Error(`Failed to remove webhook. Status code: ${response.status}`);
        }
    } catch (error: any) {
        console.error('Error removing webhook:', error.message || error);
        return {
            ok: false,
            error: error.response?.data?.message || error.message || 'Failed to remove webhook'
        };
    }
};

export const getWebhooks = async (robotId: string): Promise<WebhookResponse> => {
    try {
        const response = await axios.get(`${apiUrl}/webhook/list/${robotId}`, {
            withCredentials: true
        });

        if (response.status === 200) {
            return response.data;
        } else {
            throw new Error(`Failed to fetch webhooks. Status code: ${response.status}`);
        }
    } catch (error: any) {
        console.error('Error fetching webhooks:', error.message || error);
        return {
            ok: false,
            error: error.response?.data?.message || error.message || 'Failed to fetch webhooks',
            webhooks: []
        };
    }
};

export const testWebhook = async (webhook: WebhookConfig, robotId: string): Promise<WebhookResponse> => {
    try {
        const response = await axios.post(`${apiUrl}/webhook/test`, {
            webhook,
            robotId
        }, { withCredentials: true });

        if (response.status === 200) {
            return response.data;
        } else {
            throw new Error(`Failed to test webhook. Status code: ${response.status}`);
        }
    } catch (error: any) {
        console.error('Error testing webhook:', error.message || error);
        return {
            ok: false,
            error: error.response?.data?.message || error.message || 'Failed to test webhook'
        };
    }
};

export const clearAllWebhooks = async (robotId: string): Promise<WebhookResponse> => {
    try {
        const response = await axios.delete(`${apiUrl}/webhook/clear/${robotId}`, {
            withCredentials: true
        });

        if (response.status === 200) {
            return response.data;
        } else {
            throw new Error(`Failed to clear webhooks. Status code: ${response.status}`);
        }
    } catch (error: any) {
        console.error('Error clearing webhooks:', error.message || error);
        return {
            ok: false,
            error: error.response?.data?.message || error.message || 'Failed to clear webhooks'
        };
    }
};