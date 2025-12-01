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

interface SerializableOutput {
  scrapeSchema?: Record<string, any[]>; 
  scrapeList?: Record<string, any[]>;  
}

const MAX_RETRIES = 3;
const BASE_API_DELAY = 2000;
const MAX_QUEUE_SIZE = 1000;

export let airtableUpdateTasks: { [runId: string]: AirtableUpdateTask } = {};
let isProcessingAirtable = false;

export function addAirtableUpdateTask(runId: string, task: AirtableUpdateTask): boolean {
  const currentSize = Object.keys(airtableUpdateTasks).length;

  if (currentSize >= MAX_QUEUE_SIZE) {
    logger.log('warn', `Airtable task queue full (${currentSize}/${MAX_QUEUE_SIZE}), dropping oldest task`);
    const oldestKey = Object.keys(airtableUpdateTasks)[0];
    if (oldestKey) {
      delete airtableUpdateTasks[oldestKey];
    }
  }

  airtableUpdateTasks[runId] = task;
  return true;
}

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

function mergeRelatedData(serializableOutput: SerializableOutput, binaryOutput: Record<string, string>) {
  const allRecords: Record<string, any>[] = [];

  const schemaData: Array<{ Group: string; Field: string; Value: any }> = [];
  const listData: any[] = [];
  const screenshotData: Array<{ key: string; url: string }> = [];

  if (serializableOutput.scrapeSchema) {
    if (Array.isArray(serializableOutput.scrapeSchema)) {
      for (const schemaArray of serializableOutput.scrapeSchema) {
        if (!Array.isArray(schemaArray)) continue;
        for (const schemaItem of schemaArray) {
          Object.entries(schemaItem || {}).forEach(([key, value]) => {
            if (key && key.trim() !== "" && value !== null && value !== undefined && value !== "") {
              schemaData.push({ Group: "Default", Field: key, Value: value });
            }
          });
        }
      }
    } else if (typeof serializableOutput.scrapeSchema === "object") {
      for (const [groupName, schemaArray] of Object.entries(serializableOutput.scrapeSchema)) {
        if (!Array.isArray(schemaArray)) continue;
        for (const schemaItem of schemaArray) {
          Object.entries(schemaItem || {}).forEach(([fieldName, value]) => {
            if (fieldName && fieldName.trim() !== "" && value !== null && value !== undefined && value !== "") {
              schemaData.push({
                Group: groupName,
                Field: fieldName,
                Value: value,
              });
            }
          });
        }
      }
    }
  }

  if (serializableOutput.scrapeList) {
    if (Array.isArray(serializableOutput.scrapeList)) {
      for (const listArray of serializableOutput.scrapeList) {
        if (!Array.isArray(listArray)) continue;
        listArray.forEach((listItem) => {
          const hasContent = Object.values(listItem || {}).some(
            (value) => value !== null && value !== undefined && value !== ""
          );
          if (hasContent) listData.push(listItem);
        });
      }
    } else if (typeof serializableOutput.scrapeList === "object") {
      for (const [listName, listArray] of Object.entries(serializableOutput.scrapeList)) {
        if (!Array.isArray(listArray)) continue;
        listArray.forEach((listItem) => {
          const hasContent = Object.values(listItem || {}).some(
            (value) => value !== null && value !== undefined && value !== ""
          );
          if (hasContent) listData.push({ List: listName, ...listItem });
        });
      }
    }
  }

  // Collect screenshot data (handles both string and object forms safely)
  // if (binaryOutput && Object.keys(binaryOutput).length > 0) {
  //   Object.entries(binaryOutput).forEach(([key, rawValue]: [string, any]) => {
  //     if (!key || key.trim() === "") return;

  //     let urlString = "";

  //     // Case 1: old format (string URL)
  //     if (typeof rawValue === "string") {
  //       urlString = rawValue;
  //     }
  //     // Case 2: new format (object with { url?, data?, mimeType? })
  //     else if (rawValue && typeof rawValue === "object") {
  //       const valueObj = rawValue as { url?: string; data?: string; mimeType?: string };

  //       if (typeof valueObj.url === "string") {
  //         urlString = valueObj.url;
  //       } else if (typeof valueObj.data === "string") {
  //         const mime = valueObj.mimeType || "image/png";
  //         urlString = `data:${mime};base64,${valueObj.data}`;
  //       }
  //     }

  //     if (typeof urlString === "string" && urlString.trim() !== "") {
  //       screenshotData.push({ key, url: urlString });
  //     }
  //   });
  // }

  // --- Merge all types into Airtable rows ---
  const maxLength = Math.max(schemaData.length, listData.length, screenshotData.length);

  for (let i = 0; i < maxLength; i++) {
    const record: Record<string, any> = {};

    if (i < schemaData.length) {
      record.Group = schemaData[i].Group;
      record.Label = schemaData[i].Field;
      record.Value = schemaData[i].Value;
    }

    if (i < listData.length) {
      Object.entries(listData[i] || {}).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== "") {
          record[key] = value;
        }
      });
    }

    if (i < screenshotData.length) {
      record.Key = screenshotData[i].key;
      record.Screenshot = screenshotData[i].url;
    }

    if (Object.keys(record).length > 0) {
      allRecords.push(record);
    }
  }

  // Push leftovers
  for (let i = maxLength; i < schemaData.length; i++) {
    allRecords.push({ Label: schemaData[i].Field, Value: schemaData[i].Value });
  }
  for (let i = maxLength; i < listData.length; i++) {
    allRecords.push(listData[i]);
  }
  for (let i = maxLength; i < screenshotData.length; i++) {
    allRecords.push({
      Key: screenshotData[i].key,
      Screenshot: screenshotData[i].url,
    });
  }

  return allRecords;
}

export async function updateAirtable(robotId: string, runId: string) {
  try {
    console.log(`Starting Airtable update for run: ${runId}, robot: ${robotId}`);
    
    const run = await Run.findOne({ where: { runId } });
    if (!run) throw new Error(`Run not found for runId: ${runId}`);

    const plainRun = run.toJSON();
    if (plainRun.status !== 'success') {
      console.log('Run status is not success, skipping Airtable update');
      return;
    }

    const robot = await Robot.findOne({ where: { 'recording_meta.id': robotId } });
    if (!robot) throw new Error(`Robot not found for robotId: ${robotId}`);

    const plainRobot = robot.toJSON();
    
    if (!plainRobot.airtable_base_id || !plainRobot.airtable_table_name || !plainRobot.airtable_table_id) {
      console.log('Airtable integration not configured');
      return;
    }

    console.log(`Airtable configuration found - Base: ${plainRobot.airtable_base_id}, Table: ${plainRobot.airtable_table_name}`);
    
    const serializableOutput = plainRun.serializableOutput as SerializableOutput;
    const binaryOutput = plainRun.binaryOutput || {};
    
    const mergedData = mergeRelatedData(serializableOutput, binaryOutput);
    
    if (mergedData.length > 0) {
      await writeDataToAirtable(
        robotId,
        plainRobot.airtable_base_id,
        plainRobot.airtable_table_name,
        plainRobot.airtable_table_id,
        mergedData
      );
      console.log(`All data written to Airtable for ${robotId}`);
    } else {
      console.log(`No data to write to Airtable for ${robotId}`);
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
  if (!data || data.length === 0) {
    console.log('No data to write. Skipping.');
    return;
  }

  try {
    return await withTokenRefresh(robotId, async (accessToken: string) => {
      const airtable = new Airtable({ apiKey: accessToken });
      const base = airtable.base(baseId);

      await deleteEmptyRecords(base, tableName);

      const processedData = data.map(item => {
        const cleanedItem: Record<string, any> = {};
        
        for (const [key, value] of Object.entries(item)) {
          if (value === null || value === undefined || value === '') {
            cleanedItem[key] = '';
          } else if (typeof value === 'object' && !Array.isArray(value)) {
            cleanedItem[key] = JSON.stringify(value);
          } else {
            cleanedItem[key] = value;
          }
        }
        
        return cleanedItem;
      }).filter(record => {
        return Object.values(record).some(value => value !== null && value !== undefined && value !== '');
      });

      if (processedData.length === 0) {
        console.log('No valid data to write after filtering. Skipping.');
        return;
      }

      const dataFields = [...new Set(processedData.flatMap(row => Object.keys(row)))];
      console.log(`Found ${dataFields.length} fields in data: ${dataFields.join(', ')}`);

      const existingFields = await getExistingFields(base, tableName);
      const missingFields = dataFields.filter(field => !existingFields.includes(field));
      
      if (missingFields.length > 0) {
        console.log(`Creating ${missingFields.length} new fields: ${missingFields.join(', ')}`);
        
        for (const field of missingFields) {
          const sampleRow = processedData.find(row => field in row && row[field] !== '');
          if (sampleRow) {
            const sampleValue = sampleRow[field];
            try {
              await createAirtableField(baseId, tableName, field, sampleValue, accessToken, tableId);
              console.log(`Successfully created field: ${field}`);
              await new Promise(resolve => setTimeout(resolve, 200));
            } catch (fieldError: any) {
              console.warn(`Warning: Could not create field "${field}": ${fieldError.message}`);
            }
          }
        }
      }

      console.log(`Appending all ${processedData.length} records to Airtable`);
      const recordsToCreate = processedData.map(record => ({ fields: record }));
      
      const BATCH_SIZE = 10;
      for (let i = 0; i < recordsToCreate.length; i += BATCH_SIZE) {
        const batch = recordsToCreate.slice(i, i + BATCH_SIZE);
        console.log(`Creating batch ${Math.floor(i/BATCH_SIZE) + 1} of ${Math.ceil(recordsToCreate.length/BATCH_SIZE)}`);
        
        try {
          await retryableAirtableCreate(base, tableName, batch);
        } catch (batchError: any) {
          console.error(`Error creating batch: ${batchError.message}`);
          throw batchError;
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      await deleteEmptyRecords(base, tableName);
      
      logger.log('info', `Successfully processed ${processedData.length} records in Airtable`);
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
      console.log(`Found ${emptyRecords.length} empty records to delete`);
      const BATCH_SIZE = 10;
      for (let i = 0; i < emptyRecords.length; i += BATCH_SIZE) {
        const batch = emptyRecords.slice(i, i + BATCH_SIZE);
        const recordIds = batch.map(record => record.id);
        await base(tableName).destroy(recordIds);
        console.log(`Deleted batch ${Math.floor(i/BATCH_SIZE) + 1} of ${Math.ceil(emptyRecords.length/BATCH_SIZE)}`);
      }
      console.log(`Successfully deleted ${emptyRecords.length} empty records`);
    } else {
      console.log('No empty records found to delete');
    }
  } catch (error: any) {
    console.warn(`Warning: Could not clear empty records: ${error.message}`);
    console.warn('Will continue without deleting empty records');
  }
}

async function retryableAirtableCreate(
  base: Airtable.Base,
  tableName: string,
  batch: any[],
  retries = MAX_RETRIES
): Promise<void> {
  try {
    await base(tableName).create(batch);
  } catch (error) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, BASE_API_DELAY));
      return retryableAirtableCreate(base, tableName, batch, retries - 1);
    }
    throw error;
  }
}

// Helper functions
async function getExistingFields(base: Airtable.Base, tableName: string): Promise<string[]> {
  try {
    const records = await base(tableName).select({ pageSize: 5 }).firstPage();
    const fieldNames = new Set<string>();
    
    if (records.length > 0) {
      records.forEach(record => {
        Object.keys(record.fields).forEach(field => fieldNames.add(field));
      });
    }
    
    const headers = Array.from(fieldNames);
    console.log(`Found ${headers.length} headers from records: ${headers.join(', ')}`);
    return headers;
  } catch (error) {
    console.warn(`Warning: Error fetching existing fields: ${error}`);
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
  if (isProcessingAirtable) {
    logger.log('info', 'Airtable processing already in progress, skipping');
    return;
  }

  isProcessingAirtable = true;

  try {
    const maxProcessingTime = 60000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxProcessingTime) {
    let hasPendingTasks = false;

    for (const runId in airtableUpdateTasks) {
      const task = airtableUpdateTasks[runId];

      if (task.status === 'pending') {
        hasPendingTasks = true;
        console.log(`Processing Airtable update for run: ${runId}`);

        try {
          await updateAirtable(task.robotId, task.runId);
          console.log(`Successfully updated Airtable for runId: ${runId}`);
          delete airtableUpdateTasks[runId];
        } catch (error: any) {
          console.error(`Failed to update Airtable for run ${task.runId}:`, error);

          if (task.retries < MAX_RETRIES) {
            airtableUpdateTasks[runId].retries += 1;
            console.log(`Retrying task for runId: ${runId}, attempt: ${task.retries + 1}`);
          } else {
            console.log(`Max retries reached for runId: ${runId}. Removing task.`);
            delete airtableUpdateTasks[runId];
          }
        }
      } else if (task.status === 'completed' || task.status === 'failed') {
        delete airtableUpdateTasks[runId];
      }
    }

    if (!hasPendingTasks) {
      console.log('No pending Airtable update tasks, exiting processor');
      break;
    }

      console.log('Waiting for 5 seconds before checking again...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    console.log('Airtable processing completed or timed out');
  } finally {
    isProcessingAirtable = false;
  }
};