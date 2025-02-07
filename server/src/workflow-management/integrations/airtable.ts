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

const MAX_RETRIES = 5;
const BASE_API_DELAY = 2000;

export let airtableUpdateTasks: { [runId: string]: AirtableUpdateTask } = {};

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
    if (plainRobot.airtable_base_id && plainRobot.airtable_table_name) {
      console.log(`Writing to Airtable base ${plainRobot.airtable_base_id}`);
      await writeDataToAirtable(
        robotId,
        plainRobot.airtable_base_id,
        plainRobot.airtable_table_name,
        plainRobot.airtable_table_id || '',
        data
      );
      console.log(`Data written to Airtable for ${robotId}`);
    }
  } catch (error: any) {
    console.error(`Airtable update failed: ${error.message}`);
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
    const robot = await Robot.findOne({ where: { 'recording_meta.id': robotId } });
    if (!robot) throw new Error('Robot not found');
    
    const accessToken = robot.get('airtable_access_token');
    if (!accessToken) throw new Error('Airtable not connected');

    const airtable = new Airtable({ apiKey: accessToken });
    const base = airtable.base(baseId);

    // Dynamic field creation logic
    const existingFields = await getExistingFields(base, tableName);
    const dataFields = [...new Set(data.flatMap(row => Object.keys(row)))];
    const missingFields = dataFields.filter(field => !existingFields.includes(field));

    for (const field of missingFields) {
      const sampleRow = data.find(row => field in row);
      if (sampleRow) {
        const sampleValue = sampleRow[field];
        await createAirtableField(baseId, tableName, field, sampleValue, accessToken, tableId);
      }
    }

    // Batch processing with retries
    const batchSize = 10;
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      await retryableAirtableWrite(base, tableName, batch);
    }

    logger.log('info', `Successfully wrote ${data.length} records to Airtable`);
  } catch (error: any) {
    logger.log('error', `Airtable write failed: ${error.message}`);
    throw error;
  }
}

// Helper functions
async function getExistingFields(base: Airtable.Base, tableName: string): Promise<string[]> {
  try {
    const records = await base(tableName).select({ maxRecords: 1 }).firstPage();
    return records[0] ? Object.keys(records[0].fields) : [];
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
    const sanitizedFieldName = sanitizeFieldName(fieldName);
    const fieldType = inferFieldType(sampleValue);
    
    await axios.post(
      `https://api.airtable.com/v0/meta/bases/${baseId}/tables/${tableId}/fields`,
      { name: sanitizedFieldName, type: fieldType },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    logger.log('info', `Created field: ${sanitizedFieldName} (${fieldType})`);
  } catch (error: any) {
    if (retries > 0 && error.response?.status === 429) {
      await delay(BASE_API_DELAY * (MAX_RETRIES - retries + 1));
      return createAirtableField(baseId, tableName, fieldName, sampleValue, accessToken, tableId, retries - 1);
    }
    
    const errorMessage = error.response?.data?.error?.message || error.message;
    const statusCode = error.response?.status || 'No Status Code';
    throw new Error(`Field creation failed (${statusCode}): ${errorMessage}`);
  }
}

function sanitizeFieldName(fieldName: string): string {
  return fieldName
    .trim()
    .replace(/^[^a-zA-Z]+/, '')
    .replace(/[^\w\s]/gi, ' ')
    .substring(0, 50);
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
      await delay(BASE_API_DELAY);
      return retryableAirtableWrite(base, tableName, batch, retries - 1);
    }
    throw error;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

    if (!hasPendingTasks) break;
    await delay(5000);
  }
};