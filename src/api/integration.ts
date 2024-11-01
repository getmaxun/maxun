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
