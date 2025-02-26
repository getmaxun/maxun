import Airtable from "airtable";
import axios from "axios";
import logger from "../../logger";
import Run from "../../models/Run";
import Robot from "../../models/Robot";

interface AirtableUpdateTask {
  robotId: string;
  runId: string;
  status: 'pending' | 'completed' | 'failed';
  retries: number;
}

const MAX_RETRIES = 3;
const BASE_API_DELAY = 2000;

export let airtableUpdateTasks: { [runId: string]: AirtableUpdateTask } = {};

async function refreshAirtableToken(refreshToken: string) {
  try {
    const response = await axios.post(
      "https://airtable.com/oauth2/v1/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: process.env.AIRTABLE_CLIENT_ID!,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    return response.data;
  } catch (error: any) {
    logger.log("error", `Failed to refresh Airtable token: ${error.message}`);
    throw new Error(`Token refresh failed: ${error.response?.data?.error_description || error.message}`);
  }
}

export async function updateAirtable(robotId: string, runId: string) {
  try {
    const run = await Run.findOne({ where: { runId } });
    if (!run) throw new Error(`Run not found for runId: ${runId}`);

    const plainRun = run.toJSON();
    if (plainRun.status !== 'success') {
      console.log('Run status is not success');
      return;
    }

    let data: { [key: string]: any }[] = [];
    if (plainRun.serializableOutput?.['item-0']) {
      data = plainRun.serializableOutput['item-0'] as { [key: string]: any }[];
    } else if (plainRun.binaryOutput?.['item-0']) {
      data = [{ "File URL": plainRun.binaryOutput['item-0'] }];
    }

    const robot = await Robot.findOne({ where: { 'recording_meta.id': robotId } });
    if (!robot) throw new Error(`Robot not found for robotId: ${robotId}`);

    const plainRobot = robot.toJSON();
    if (plainRobot.airtable_base_id && plainRobot.airtable_table_name && plainRobot.airtable_table_id) {
      console.log(`Writing to Airtable base ${plainRobot.airtable_base_id}`);
      await writeDataToAirtable(
        robotId,
        plainRobot.airtable_base_id,
        plainRobot.airtable_table_name,
        plainRobot.airtable_table_id,
        data
      );
      console.log(`Data written to Airtable for ${robotId}`);
    }
  } catch (error: any) {
    console.error(`Airtable update failed: ${error.message}`);
    throw error;
  }
}

async function withTokenRefresh<T>(robotId: string, apiCall: (accessToken: string) => Promise<T>): Promise<T> {
  const robot = await Robot.findOne({ where: { 'recording_meta.id': robotId } });
  if (!robot) throw new Error(`Robot not found for robotId: ${robotId}`);

  let accessToken = robot.get('airtable_access_token') as string;
  let refreshToken = robot.get('airtable_refresh_token') as string;

  if (!accessToken || !refreshToken) {
    throw new Error('Airtable credentials not configured');
  }

  try {
    return await apiCall(accessToken);
  } catch (error: any) {
    if (error.response?.status === 401 || 
        (error.statusCode === 401) || 
        error.message.includes('unauthorized') || 
        error.message.includes('expired')) {
      
      logger.log("info", `Refreshing expired Airtable token for robot: ${robotId}`);
      
      try {
        const tokens = await refreshAirtableToken(refreshToken);
        
        await robot.update({
          airtable_access_token: tokens.access_token,
          airtable_refresh_token: tokens.refresh_token || refreshToken
        });
        
        return await apiCall(tokens.access_token);
      } catch (refreshError: any) {
        logger.log("error", `Failed to refresh token: ${refreshError.message}`);
        throw new Error(`Token refresh failed: ${refreshError.message}`);
      }
    }
    
    throw error;
  }
}

export async function writeDataToAirtable(
  robotId: string,
  baseId: string,
  tableName: string,
  tableId: string,
  data: any[]
) {
  try {
    return await withTokenRefresh(robotId, async (accessToken: string) => {
      const airtable = new Airtable({ apiKey: accessToken });
      const base = airtable.base(baseId);

      const existingFields = await getExistingFields(base, tableName);
      console.log(`Found ${existingFields.length} existing fields in Airtable`); 

      const dataFields = [...new Set(data.flatMap(row => Object.keys(row)))];  
      console.log(`Found ${dataFields.length} fields in data: ${dataFields.join(', ')}`);

      const missingFields = dataFields.filter(field => !existingFields.includes(field));
      console.log(`Found ${missingFields.length} missing fields: ${missingFields.join(', ')}`);

      for (const field of missingFields) {
        const sampleRow = data.find(row => field in row);
        if (sampleRow) {
          const sampleValue = sampleRow[field];
          try {
            await createAirtableField(baseId, tableName, field, sampleValue, accessToken, tableId);
            console.log(`Successfully created field: ${field}`);
          } catch (fieldError: any) {
            console.warn(`Warning: Could not create field "${field}": ${fieldError.message}`);
          }
        }
      }

      await deleteEmptyRecords(base, tableName);
      
      const BATCH_SIZE = 10;
      for (let i = 0; i < data.length; i += BATCH_SIZE) {
        const batch = data.slice(i, i + BATCH_SIZE);
        await retryableAirtableWrite(base, tableName, batch);
      }
      
      logger.log('info', `Successfully wrote ${data.length} records to Airtable`);
    });
  } catch (error: any) {
    logger.log('error', `Airtable write failed: ${error.message}`);
    throw error;
  }
}

async function deleteEmptyRecords(base: Airtable.Base, tableName: string): Promise<void> {
  console.log('Checking for empty records to clear...');
  
  try {
    const existingRecords = await base(tableName).select().all();
    console.log(`Found ${existingRecords.length} total records`);
    
    const emptyRecords = existingRecords.filter(record => {
      const fields = record.fields;
      return !fields || Object.keys(fields).length === 0 || 
             Object.values(fields).every(value => 
               value === null || value === undefined || value === '');
    });
        
    if (emptyRecords.length > 0) {
      const BATCH_SIZE = 10;
      for (let i = 0; i < emptyRecords.length; i += BATCH_SIZE) {
        const batch = emptyRecords.slice(i, i + BATCH_SIZE);
        const recordIds = batch.map(record => record.id);
        await base(tableName).destroy(recordIds);
      }
    } 
  } catch (error: any) {
    console.warn(`Warning: Could not clear empty records: ${error.message}`);
    console.warn('Will continue without deleting empty records');
  }
}

async function retryableAirtableWrite(
  base: Airtable.Base,
  tableName: string,
  batch: any[],
  retries = MAX_RETRIES
): Promise<void> {
  try {
    await base(tableName).create(batch.map(row => ({ fields: row })));
  } catch (error) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, BASE_API_DELAY));
      return retryableAirtableWrite(base, tableName, batch, retries - 1);
    }
    throw error;
  }
}

// Helper functions
async function getExistingFields(base: Airtable.Base, tableName: string): Promise<string[]> {
  try {
    const records = await base(tableName).select({ pageSize: 5 }).firstPage();
    if (records.length > 0) {
      const fieldNames = new Set<string>();
      records.forEach(record => {
        Object.keys(record.fields).forEach(field => fieldNames.add(field));
      });
      
      const headers = Array.from(fieldNames);
      console.log(`Found ${headers.length} headers from records: ${headers.join(', ')}`);
      return headers;
    }
    return [];
  } catch (error) {
    return [];
  }
}

async function createAirtableField(
  baseId: string,
  tableName: string,
  fieldName: string,
  sampleValue: any,
  accessToken: string,
  tableId: string,
  retries = MAX_RETRIES
): Promise<void> {
  try {
    const fieldType = inferFieldType(sampleValue);
    
    console.log(`Creating field ${fieldName} with type ${fieldType}`);
    
    const response = await axios.post(
      `https://api.airtable.com/v0/meta/bases/${baseId}/tables/${tableId}/fields`,
      { name: fieldName, type: fieldType },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    logger.log('info', `Created field: ${fieldName} (${fieldType})`);
    return response.data;
  } catch (error: any) {
    if (retries > 0 && error.response?.status === 429) {
      await new Promise(resolve => setTimeout(resolve, BASE_API_DELAY));
      return createAirtableField(baseId, tableName, fieldName, sampleValue, accessToken, tableId, retries - 1);
    }
    
    if (error.response?.status === 422) {
      console.log(`Field ${fieldName} may already exist or has validation issues`);
      return;
    }
    
    const errorMessage = error.response?.data?.error?.message || error.message;
    const statusCode = error.response?.status || 'No Status Code';
    console.warn(`Field creation issue (${statusCode}): ${errorMessage}`);
  }
}

function inferFieldType(value: any): string {
  if (value === null || value === undefined) return 'singleLineText';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'checkbox';
  if (value instanceof Date) return 'dateTime';
  if (Array.isArray(value)) {
    return value.length > 0 && typeof value[0] === 'object' ? 'multipleRecordLinks' : 'multipleSelects';
  }
  if (typeof value === 'string' && isValidUrl(value)) return 'url';
  return 'singleLineText';
}

function isValidUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch (_) {
    return false;
  }
}

export const processAirtableUpdates = async () => {
  while (true) {
    let hasPendingTasks = false;
    
    for (const runId in airtableUpdateTasks) {
      const task = airtableUpdateTasks[runId];
      if (task.status !== 'pending') continue;

      hasPendingTasks = true;      
      try {
        await updateAirtable(task.robotId, task.runId);
        delete airtableUpdateTasks[runId]; 
      } catch (error: any) {
        task.retries += 1;
        if (task.retries >= MAX_RETRIES) {
          task.status = 'failed';
          logger.log('error', `Permanent failure for run ${runId}: ${error.message}`);
        }
      }
    }

    if (!hasPendingTasks) {
      console.log('No pending Airtable update tasks, exiting processor');
      break;
    }
    
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
};