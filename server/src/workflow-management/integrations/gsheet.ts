import { google } from "googleapis";
import logger from "../../logger";
import Run from "../../models/Run";
import Robot from "../../models/Robot";

interface GoogleSheetUpdateTask {
  robotId: string;
  runId: string;
  status: 'pending' | 'completed' | 'failed';
  retries: number;
}

const MAX_RETRIES = 5;

export let googleSheetUpdateTasks: { [runId: string]: GoogleSheetUpdateTask } = {};

export async function updateGoogleSheet(robotId: string, runId: string) {
  try {
    const run = await Run.findOne({ where: { runId } });

    if (!run) {
      throw new Error(`Run not found for runId: ${runId}`);
    }

    const plainRun = run.toJSON();

    if (plainRun.status === 'success') {
      let data: { [key: string]: any }[] = [];
      if (plainRun.serializableOutput && Object.keys(plainRun.serializableOutput).length > 0) {
        data = plainRun.serializableOutput['item-0'] as { [key: string]: any }[];
    
      } else if (plainRun.binaryOutput && plainRun.binaryOutput['item-0']) {
        // Handle binaryOutput by setting the URL as a data entry
        const binaryUrl = plainRun.binaryOutput['item-0'] as string;
    
        // Create a placeholder object with the binary URL
        data = [{ "Screenshot URL": binaryUrl }];
      }

      const robot = await Robot.findOne({ where: { 'recording_meta.id': robotId } });

      if (!robot) {
        throw new Error(`Robot not found for robotId: ${robotId}`);
      }

      const plainRobot = robot.toJSON();

      const spreadsheetId = plainRobot.google_sheet_id;
      if (plainRobot.google_sheet_email && spreadsheetId) {
        console.log(`Preparing to write data to Google Sheet for robot: ${robotId}, spreadsheetId: ${spreadsheetId}`);

        await writeDataToSheet(robotId, spreadsheetId, data);
        console.log(`Data written to Google Sheet successfully for Robot: ${robotId} and Run: ${runId}`);
      } else {
        console.log('Google Sheets integration not configured.');
      }
    } else {
      console.log('Run status is not success or serializableOutput is missing.');
    }
  } catch (error: any) {
    console.error(`Failed to write data to Google Sheet for Robot: ${robotId} and Run: ${runId}: ${error.message}`);
  }
};

export async function writeDataToSheet(robotId: string, spreadsheetId: string, data: any[]) {
  try {
    const robot = await Robot.findOne({ where: { 'recording_meta.id': robotId } });

    if (!robot) {
      throw new Error(`Robot not found for robotId: ${robotId}`);
    }

    const plainRobot = robot.toJSON();

    if (!plainRobot.google_access_token || !plainRobot.google_refresh_token) {
      throw new Error('Google Sheets access not configured for user');
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: plainRobot.google_access_token,
      refresh_token: plainRobot.google_refresh_token,
    });

    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.refresh_token) {
        await robot.update({ google_refresh_token: tokens.refresh_token });
      }
      if (tokens.access_token) {
        await robot.update({ google_access_token: tokens.access_token });
      }
    });

    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    const checkResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!1:1', 
    });

    if (!data || data.length === 0) {
      console.log('No data to write. Exiting early.');
      return;
    }

    const expectedHeaders = Object.keys(data[0]);

    const rows = data.map(item => Object.values(item));

    const existingHeaders = 
      checkResponse.data.values && 
      checkResponse.data.values[0] ? 
      checkResponse.data.values[0].map(String) : 
      [];

    const isSheetEmpty = existingHeaders.length === 0;
    
    const headersMatch = 
      !isSheetEmpty &&
      existingHeaders.length === expectedHeaders.length && 
      expectedHeaders.every((header, index) => existingHeaders[index] === header);

    let resource;
    
    if (isSheetEmpty || !headersMatch) {
      resource = { values: [expectedHeaders, ...rows] };
      console.log('Including headers in the append operation.');
    } else {
      resource = { values: rows };
      console.log('Headers already exist and match, only appending data rows.');
    }

    console.log('Attempting to write to spreadsheet:', spreadsheetId);

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: resource,
    });

    if (response.status === 200) {
      console.log('Data successfully appended to Google Sheet.');
    } else {
      console.error('Google Sheets append failed:', response);
    }

    logger.log(`info`, `Data written to Google Sheet: ${spreadsheetId}`);
  } catch (error: any) {
    logger.log(`error`, `Error writing data to Google Sheet: ${error.message}`);
    throw error;
  }
}

export const processGoogleSheetUpdates = async () => {
  while (true) {
    let hasPendingTasks = false;
    for (const runId in googleSheetUpdateTasks) {
      const task = googleSheetUpdateTasks[runId];
      console.log(`Processing task for runId: ${runId}, status: ${task.status}`);

      if (task.status === 'pending') {
        hasPendingTasks = true;
        try {
          await updateGoogleSheet(task.robotId, task.runId);
          console.log(`Successfully updated Google Sheet for runId: ${runId}`);
          delete googleSheetUpdateTasks[runId];
        } catch (error: any) {
          console.error(`Failed to update Google Sheets for run ${task.runId}:`, error);
          if (task.retries < MAX_RETRIES) {
            googleSheetUpdateTasks[runId].retries += 1;
            console.log(`Retrying task for runId: ${runId}, attempt: ${task.retries}`);
          } else {
            googleSheetUpdateTasks[runId].status = 'failed';
            console.log(`Max retries reached for runId: ${runId}. Marking task as failed.`);
          }
        }
      }
    }

    if (!hasPendingTasks) {
      console.log('No pending tasks. Exiting loop.');
      break;
    }

    console.log('Waiting for 5 seconds before checking again...');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
};