import Airtable from 'airtable';
import logger from '../../logger';
import Run from '../../models/Run';
import Robot from '../../models/Robot';

interface AirtableUpdateTask {
  robotId: string;
  runId: string;
  status: 'pending' | 'completed' | 'failed';
  retries: number;
}

const MAX_RETRIES = 5;

export let airtableUpdateTasks: { [runId: string]: AirtableUpdateTask } = {};

/**
 * Updates Airtable with data from a successful run.
 * @param robotId - The ID of the robot.
 * @param runId - The ID of the run.
 */
export async function updateAirtable(robotId: string, runId: string) {
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
        const binaryUrl = plainRun.binaryOutput['item-0'] as string;
        data = [{ "Screenshot URL": binaryUrl }];
      }

      const robot = await Robot.findOne({ where: { 'recording_meta.id': robotId } });

      if (!robot) {
        throw new Error(`Robot not found for robotId: ${robotId}`);
      }

      const plainRobot = robot.toJSON();

      const tableName = plainRobot.airtable_table_name;
      const baseId = plainRobot.airtable_base_id;
      const personalAccessToken = plainRobot.airtable_personal_access_token;

      if (tableName && baseId && personalAccessToken) {
        console.log(`Preparing to write data to Airtable for robot: ${robotId}, table: ${tableName}`);

        await writeDataToAirtable(baseId, tableName, personalAccessToken, data);
        console.log(`Data written to Airtable successfully for Robot: ${robotId} and Run: ${runId}`);
      } else {
        console.log('Airtable integration not configured.');
      }
    } else {
      console.log('Run status is not success or serializableOutput is missing.');
    }
  } catch (error: any) {
    console.error(`Failed to write data to Airtable for Robot: ${robotId} and Run: ${runId}: ${error.message}`);
  }
}

/**
 * Writes data to Airtable.
 * @param baseId - The ID of the Airtable base.
 * @param tableName - The name of the Airtable table.
 * @param personalAccessToken - The Airtable Personal Access Token.
 * @param data - The data to write to Airtable.
 */
export async function writeDataToAirtable(baseId: string, tableName: string, personalAccessToken: string, data: any[]) {
  try {
    // Initialize Airtable with Personal Access Token
    const base = new Airtable({ apiKey: personalAccessToken }).base(baseId);

    const table = base(tableName);

    // Prepare records for Airtable
    const records = data.map((row) => ({ fields: row }));

    // Write data to Airtable
    const response = await table.create(records);

    if (response) {
      console.log('Data successfully appended to Airtable.');
    } else {
      console.error('Airtable append failed:', response);
    }

    logger.log(`info`, `Data written to Airtable: ${tableName}`);
  } catch (error: any) {
    logger.log(`error`, `Error writing data to Airtable: ${error.message}`);
    throw error;
  }
}

/**
 * Processes pending Airtable update tasks.
 */
export const processAirtableUpdates = async () => {
  while (true) {
    let hasPendingTasks = false;
    for (const runId in airtableUpdateTasks) {
      const task = airtableUpdateTasks[runId];
      console.log(`Processing task for runId: ${runId}, status: ${task.status}`);

      if (task.status === 'pending') {
        hasPendingTasks = true;
        try {
          await updateAirtable(task.robotId, task.runId);
          console.log(`Successfully updated Airtable for runId: ${runId}`);
          delete airtableUpdateTasks[runId];
        } catch (error: any) {
          console.error(`Failed to update Airtable for run ${task.runId}:`, error);
          if (task.retries < MAX_RETRIES) {
            airtableUpdateTasks[runId].retries += 1;
            console.log(`Retrying task for runId: ${runId}, attempt: ${task.retries}`);
          } else {
            airtableUpdateTasks[runId].status = 'failed';
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
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
};