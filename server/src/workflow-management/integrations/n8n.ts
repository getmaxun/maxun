import axios from "axios";
import logger from "../../logger";
import Run from "../../models/Run";
import Robot from "../../models/Robot";

interface N8nUpdateTask {
  robotId: string;
  runId: string;
  status: 'pending' | 'completed' | 'failed';
  retries: number;
}

interface SerializableOutput {
  scrapeSchema?: any[];
  scrapeList?: any[];
}

const MAX_RETRIES = 3;
const BASE_API_DELAY = 2000;

export let n8nUpdateTasks: { [runId: string]: N8nUpdateTask } = {};

function mergeRelatedData(serializableOutput: SerializableOutput, binaryOutput: Record<string, string>) {
  const allRecords: Record<string, any>[] = [];
  
  const schemaData: Array<{key: string, value: any}> = [];
  const listData: any[] = [];
  const screenshotData: Array<{key: string, url: string}> = [];
  
  // Collect schema data
  if (serializableOutput.scrapeSchema) {
    for (const schemaArray of serializableOutput.scrapeSchema) {
      if (!Array.isArray(schemaArray)) continue;
      for (const schemaItem of schemaArray) {
        Object.entries(schemaItem).forEach(([key, value]) => {
          if (key && key.trim() !== '' && value !== null && value !== undefined && value !== '') {
            schemaData.push({key, value});
          }
        });
      }
    }
  }
  
  // Collect list data
  if (serializableOutput.scrapeList) {
    for (const listArray of serializableOutput.scrapeList) {
      if (!Array.isArray(listArray)) continue;
      listArray.forEach(listItem => {
        const hasContent = Object.values(listItem).some(value => 
          value !== null && value !== undefined && value !== ''
        );
        if (hasContent) {
          listData.push(listItem);
        }
      });
    }
  }
  
  // Collect screenshot data
  if (binaryOutput && Object.keys(binaryOutput).length > 0) {
    Object.entries(binaryOutput).forEach(([key, url]) => {
      if (key && key.trim() !== '' && url && url.trim() !== '') {
        screenshotData.push({key, url});
      }
    });
  }
  
  // Mix all data types together to create consecutive records
  const maxLength = Math.max(schemaData.length, listData.length, screenshotData.length);
  
  for (let i = 0; i < maxLength; i++) {
    const record: Record<string, any> = {};
    
    if (i < schemaData.length) {
      record.Label = schemaData[i].key;
      record.Value = schemaData[i].value;
    }
    
    if (i < listData.length) {
      Object.entries(listData[i]).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') {
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
  
  // Add remaining schema data
  for (let i = maxLength; i < schemaData.length; i++) {
    allRecords.push({
      Label: schemaData[i].key,
      Value: schemaData[i].value
    });
  }
  
  // Add remaining list data
  for (let i = maxLength; i < listData.length; i++) {
    allRecords.push(listData[i]);
  }
  
  // Add remaining screenshot data
  for (let i = maxLength; i < screenshotData.length; i++) {
    allRecords.push({
      Key: screenshotData[i].key,
      Screenshot: screenshotData[i].url
    });
  }
  
  return allRecords;
}

export async function updateN8n(robotId: string, runId: string) {
  try {
    console.log(`Starting n8n update for run: ${runId}, robot: ${robotId}`);
    
    const run = await Run.findOne({ where: { runId } });
    if (!run) throw new Error(`Run not found for runId: ${runId}`);

    const plainRun = run.toJSON();
    if (plainRun.status !== 'success') {
      console.log('Run status is not success, skipping n8n update');
      return;
    }

    const robot = await Robot.findOne({ where: { 'recording_meta.id': robotId } });
    if (!robot) throw new Error(`Robot not found for robotId: ${robotId}`);

    const plainRobot = robot.toJSON();
    
    if (!plainRobot.n8n_webhook_url) {
      console.log('n8n integration not configured');
      return;
    }

    console.log(`n8n configuration found - Webhook URL: ${plainRobot.n8n_webhook_url}`);
    
    const serializableOutput = plainRun.serializableOutput as SerializableOutput;
    const binaryOutput = plainRun.binaryOutput || {};
    
    const mergedData = mergeRelatedData(serializableOutput, binaryOutput);
    
    if (mergedData.length > 0) {
      await sendDataToN8n(
        plainRobot.n8n_webhook_url,
        plainRobot.n8n_api_key ?? null,
        robotId,
        runId,
        plainRobot.recording_meta.name,
        mergedData
      );
      console.log(`All data sent to n8n for ${robotId}`);
    } else {
      console.log(`No data to send to n8n for ${robotId}`);
    }
  } catch (error: any) {
    console.error(`n8n update failed: ${error.message}`);
    throw error;
  }
}

export async function sendDataToN8n(
  webhookUrl: string,
  apiKey: string | null,
  robotId: string,
  runId: string,
  robotName: string,
  data: any[]
) {
  if (!data || data.length === 0) {
    console.log('No data to send to n8n. Skipping.');
    return;
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add authorization header if API key is provided
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const payload = {
      robot_id: robotId,
      run_id: runId,
      robot_name: robotName,
      timestamp: new Date().toISOString(),
      data: data,
      metadata: {
        total_records: data.length,
        data_types: {
          schema_records: data.filter(record => record.Label && record.Value).length,
          list_records: data.filter(record => !record.Label && !record.Key).length,
          screenshot_records: data.filter(record => record.Key && record.Screenshot).length
        }
      }
    };

    console.log(`Sending ${data.length} records to n8n webhook: ${webhookUrl}`);
    
    const response = await retryableN8nRequest(async () => {
      return await axios.post(webhookUrl, payload, {
        headers,
        timeout: 30000, // 30 second timeout
      });
    });

    if (response.status >= 200 && response.status < 300) {
      console.log(`Successfully sent data to n8n webhook`);
      logger.log('info', `Successfully sent ${data.length} records to n8n for robot ${robotId}`);
    } else {
      throw new Error(`n8n webhook returned status ${response.status}: ${response.statusText}`);
    }

  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message;
    logger.log('error', `n8n webhook failed: ${errorMessage}`);
    
    if (error.response?.status === 401) {
      throw new Error('n8n webhook authentication failed. Please check your API key.');
    } else if (error.response?.status === 404) {
      throw new Error('n8n webhook URL not found. Please verify the webhook URL is correct.');
    } else if (error.code === 'ECONNREFUSED') {
      throw new Error('Could not connect to n8n instance. Please verify the webhook URL and that n8n is running.');
    }
    
    throw error;
  }
}

async function retryableN8nRequest<T>(
  requestFn: () => Promise<T>,
  retries = MAX_RETRIES
): Promise<T> {
  try {
    return await requestFn();
  } catch (error: any) {
    if (retries > 0 && (
      error.code === 'ECONNRESET' || 
      error.code === 'ETIMEDOUT' ||
      (error.response && error.response.status >= 500)
    )) {
      console.log(`Retrying n8n request, ${retries} attempts remaining`);
      await new Promise(resolve => setTimeout(resolve, BASE_API_DELAY));
      return retryableN8nRequest(requestFn, retries - 1);
    }
    throw error;
  }
}

export const processN8nUpdates = async () => {
  while (true) {
    let hasPendingTasks = false;
    
    for (const runId in n8nUpdateTasks) {
      const task = n8nUpdateTasks[runId];
      
      if (task.status === 'pending') {
        hasPendingTasks = true;
        console.log(`Processing n8n update for run: ${runId}`);
        
        try {
          await updateN8n(task.robotId, task.runId);
          console.log(`Successfully updated n8n for runId: ${runId}`);
          n8nUpdateTasks[runId].status = 'completed';
          delete n8nUpdateTasks[runId]; 
        } catch (error: any) {
          console.error(`Failed to update n8n for run ${task.runId}:`, error);
          
          if (task.retries < MAX_RETRIES) {
            n8nUpdateTasks[runId].retries += 1;
            console.log(`Retrying task for runId: ${runId}, attempt: ${task.retries + 1}`);
          } else {
            n8nUpdateTasks[runId].status = 'failed';
            console.log(`Max retries reached for runId: ${runId}. Marking task as failed.`);
            logger.log('error', `Permanent failure for run ${runId}: ${error.message}`);
          }
        }
      }
    }

    if (!hasPendingTasks) {
      console.log('No pending n8n update tasks, exiting processor');
      break;
    }
    
    console.log('Waiting for 5 seconds before checking again...');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
};