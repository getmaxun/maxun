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

interface SerializableOutput {
  scrapeSchema?: any[];
  scrapeList?: any[];
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
      const robot = await Robot.findOne({ where: { 'recording_meta.id': robotId } });

      if (!robot) {
        throw new Error(`Robot not found for robotId: ${robotId}`);
      }

      const plainRobot = robot.toJSON();
      const spreadsheetId = plainRobot.google_sheet_id;
      
      if (!plainRobot.google_sheet_email || !spreadsheetId) {
        console.log('Google Sheets integration not configured.');
        return;
      }

      console.log(`Preparing to write data to Google Sheet for robot: ${robotId}, spreadsheetId: ${spreadsheetId}`);
      
      const serializableOutput = plainRun.serializableOutput as SerializableOutput;
      
      if (serializableOutput) {
        if (serializableOutput.scrapeSchema && serializableOutput.scrapeSchema.length > 0) {
          await processOutputType(
            robotId, 
            spreadsheetId, 
            'Text', 
            serializableOutput.scrapeSchema, 
            plainRobot
          );
        }
        
        if (serializableOutput.scrapeList && serializableOutput.scrapeList.length > 0) {
          await processOutputType(
            robotId, 
            spreadsheetId, 
            'List', 
            serializableOutput.scrapeList, 
            plainRobot
          );
        }
      }
      
      if (plainRun.binaryOutput && Object.keys(plainRun.binaryOutput).length > 0) {
        const screenshots = Object.entries(plainRun.binaryOutput).map(([key, url]) => ({
          "Screenshot Key": key,
          "Screenshot URL": url
        }));
        
        await processOutputType(
          robotId,
          spreadsheetId,
          'Screenshot',
          [screenshots],
          plainRobot
        );
      }
      
      console.log(`Data written to Google Sheet successfully for Robot: ${robotId} and Run: ${runId}`);
    } else {
      console.log('Run status is not success or serializableOutput is missing.');
    }
  } catch (error: any) {
    console.error(`Failed to write data to Google Sheet for Robot: ${robotId} and Run: ${runId}: ${error.message}`);
    throw error;
  }
}

async function processOutputType(
  robotId: string, 
  spreadsheetId: string, 
  outputType: string, 
  outputData: any[], 
  robotConfig: any
) {
  for (let i = 0; i < outputData.length; i++) {
    const data = outputData[i];
    
    if (!data || data.length === 0) {
      console.log(`No data to write for ${outputType}-${i}. Skipping.`);
      continue;
    }
    
    const sheetName = `${outputType}-${i}`;
    
    await ensureSheetExists(spreadsheetId, sheetName, robotConfig);
    
    let formattedData = data;
    if (outputType === 'Text' && data.length > 0) {
      const schemaItem = data[0];
      formattedData = Object.entries(schemaItem).map(([key, value]) => ({
        Label: key,
        Value: value
      }));
    }
    
    await writeDataToSheet(robotId, spreadsheetId, formattedData, sheetName, robotConfig);
    console.log(`Data written to ${sheetName} sheet for ${outputType} data`);
  }
}

async function ensureSheetExists(spreadsheetId: string, sheetName: string, robotConfig: any) {
  try {
    const oauth2Client = getOAuth2Client(robotConfig);
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title'
    });
    
    const existingSheets = response.data.sheets?.map(sheet => sheet.properties?.title) || [];
    
    if (!existingSheets.includes(sheetName)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName
                }
              }
            }
          ]
        }
      });
      console.log(`Created new sheet: ${sheetName}`);
    }
  } catch (error: any) {
    logger.log('error', `Error ensuring sheet exists: ${error.message}`);
    throw error;
  }
}

function getOAuth2Client(robotConfig: any) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: robotConfig.google_access_token,
    refresh_token: robotConfig.google_refresh_token,
  });

  return oauth2Client;
}

export async function writeDataToSheet(
  robotId: string, 
  spreadsheetId: string, 
  data: any[], 
  sheetName: string = 'Sheet1',
  robotConfig?: any
) {
  try {
    let robot = robotConfig;
    
    if (!robot) {
      robot = await Robot.findOne({ where: { 'recording_meta.id': robotId } });

      if (!robot) {
        throw new Error(`Robot not found for robotId: ${robotId}`);
      }
      
      robot = robot.toJSON();
    }

    if (!robot.google_access_token || !robot.google_refresh_token) {
      throw new Error('Google Sheets access not configured for user');
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: robot.google_access_token,
      refresh_token: robot.google_refresh_token,
    });

    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.refresh_token || tokens.access_token) {
        const robotModel = await Robot.findOne({ where: { 'recording_meta.id': robotId } });
        if (robotModel) {
          const updateData: any = {};
          if (tokens.refresh_token) updateData.google_refresh_token = tokens.refresh_token;
          if (tokens.access_token) updateData.google_access_token = tokens.access_token;
          await robotModel.update(updateData);
        }
      }
    });

    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    const checkResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!1:1`, 
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
      console.log(`Including headers in the append operation for sheet ${sheetName}.`);
    } else {
      resource = { values: rows };
      console.log(`Headers already exist and match in sheet ${sheetName}, only appending data rows.`);
    }

    console.log(`Attempting to write to spreadsheet: ${spreadsheetId}, sheet: ${sheetName}`);

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: resource,
    });

    if (response.status === 200) {
      console.log(`Data successfully appended to sheet: ${sheetName}`);
    } else {
      console.error('Google Sheets append failed:', response);
    }

    logger.log(`info`, `Data written to Google Sheet: ${spreadsheetId}, sheet: ${sheetName}`);
  } catch (error: any) {
    logger.log(`error`, `Error writing data to Google Sheet: ${error.message}`);
    throw error;
  }
}

export const processGoogleSheetUpdates = async () => {
  const maxProcessingTime = 60000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxProcessingTime) {
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
            console.log(`Max retries reached for runId: ${runId}. Removing task.`);
            delete googleSheetUpdateTasks[runId];
          }
        }
      } else if (task.status === 'completed' || task.status === 'failed') {
        delete googleSheetUpdateTasks[runId];
      }
    }

    if (!hasPendingTasks) {
      console.log('No pending tasks. Exiting loop.');
      break;
    }

    console.log('Waiting for 5 seconds before checking again...');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  console.log('Google Sheets processing completed or timed out');
};