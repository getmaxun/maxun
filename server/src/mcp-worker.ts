import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const log = (message: string) => {
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[MCP Worker] ${message}`); 
  }
};

class MaxunMCPWorker {
  private mcpServer: McpServer;
  private apiKey: string;
  private apiUrl: string;

  constructor() {
    this.apiKey = process.env.MCP_API_KEY || '';
    this.apiUrl = process.env.BACKEND_URL || 'http://localhost:8080';
    
    if (!this.apiKey) {
      throw new Error('MCP_API_KEY environment variable is required');
    }

    this.mcpServer = new McpServer({
      name: 'Maxun Web Scraping Server',
      version: '1.0.0'
    });

    this.setupTools();
  }

  private async makeApiRequest(endpoint: string, options: any = {}) {
    const url = `${this.apiUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      ...options.headers
    };

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  private setupTools() {
    // Tool: List all robots
    this.mcpServer.tool(
      "list_robots",
      {},
      async () => {
        try {
          const data = await this.makeApiRequest('/api/robots');
          
          return {
            content: [{
              type: "text",
              text: `Found ${data.robots.totalCount} robots:\n\n${JSON.stringify(data.robots.items, null, 2)}`
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: "text",
              text: `Error fetching robots: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Tool: Get robot details by ID
    this.mcpServer.tool(
      "get_robot",
      {
        robot_id: z.string().describe("ID of the robot to get details for")
      },
      async ({ robot_id }) => {
        try {
          const data = await this.makeApiRequest(`/api/robots/${robot_id}`);
          
          return {
            content: [{
              type: "text",
              text: `Robot Details:\n\n${JSON.stringify(data.robot, null, 2)}`
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: "text",
              text: `Error fetching robot: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Tool: Run a robot and get results
    this.mcpServer.tool(
      "run_robot",
      {
        robot_id: z.string().describe("ID of the robot to run"),
        wait_for_completion: z.boolean().default(true).describe("Whether to wait for the run to complete")
      },
      async ({ robot_id, wait_for_completion }) => {
        try {
          const data = await this.makeApiRequest(`/api/robots/${robot_id}/runs`, {
            method: 'POST'
          });

          if (wait_for_completion) {
            const extractedData = data.run.data;
            const screenshots = data.run.screenshots;
            
            let resultText = `Robot run completed successfully!\n\n`;
            resultText += `Run ID: ${data.run.runId}\n`;
            resultText += `Status: ${data.run.status}\n`;
            resultText += `Started: ${data.run.startedAt}\n`;
            resultText += `Finished: ${data.run.finishedAt}\n\n`;

            if (extractedData.textData && extractedData.textData.length > 0) {
              resultText += `Extracted Text Data (${extractedData.textData.length} items):\n`;
              resultText += JSON.stringify(extractedData.textData, null, 2) + '\n\n';
            }

            if (extractedData.listData && extractedData.listData.length > 0) {
              resultText += `Extracted List Data (${extractedData.listData.length} items):\n`;
              resultText += JSON.stringify(extractedData.listData, null, 2) + '\n\n';
            }

            if (screenshots && screenshots.length > 0) {
              resultText += `Screenshots captured: ${screenshots.length}\n`;
              resultText += `Screenshot URLs:\n`;
              screenshots.forEach((screenshot: any, index: any) => {
                resultText += `${index + 1}. ${screenshot}\n`;
              });
            }

            return {
              content: [{
                type: "text",
                text: resultText
              }]
            };
          } else {
            return {
              content: [{
                type: "text",
                text: `Robot run started! Run ID: ${data.run.runId}\nStatus: ${data.run.status}`
              }]
            };
          }
        } catch (error: any) {
          return {
            content: [{
              type: "text",
              text: `Error running robot: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Tool: Get all runs for a robot
    this.mcpServer.tool(
      "get_robot_runs",
      {
        robot_id: z.string().describe("ID of the robot")
      },
      async ({ robot_id }) => {
        try {
          const data = await this.makeApiRequest(`/api/robots/${robot_id}/runs`);
          
          return {
            content: [{
              type: "text",
              text: `Robot runs (${data.runs.totalCount} total):\n\n${JSON.stringify(data.runs.items, null, 2)}`
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: "text",
              text: `Error fetching runs: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Tool: Get specific run details
    this.mcpServer.tool(
      "get_run_details",
      {
        robot_id: z.string().describe("ID of the robot"),
        run_id: z.string().describe("ID of the specific run")
      },
      async ({ robot_id, run_id }) => {
        try {
          const data = await this.makeApiRequest(`/api/robots/${robot_id}/runs/${run_id}`);
          
          const run = data.run;
          let resultText = `Run Details:\n\n`;
          resultText += `Run ID: ${run.runId}\n`;
          resultText += `Status: ${run.status}\n`;
          resultText += `Robot ID: ${run.robotId}\n`;
          resultText += `Started: ${run.startedAt}\n`;
          resultText += `Finished: ${run.finishedAt}\n\n`;

          if (run.data.textData && run.data.textData.length > 0) {
            resultText += `Extracted Text Data:\n${JSON.stringify(run.data.textData, null, 2)}\n\n`;
          }

          if (run.data.listData && run.data.listData.length > 0) {
            resultText += `Extracted List Data:\n${JSON.stringify(run.data.listData, null, 2)}\n\n`;
          }

          if (run.screenshots && run.screenshots.length > 0) {
            resultText += `Screenshots:\n`;
            run.screenshots.forEach((screenshot: any, index: any) => {
              resultText += `${index + 1}. ${screenshot}\n`;
            });
          }

          return {
            content: [{
              type: "text",
              text: resultText
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: "text",
              text: `Error fetching run details: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );

    // Tool: Get robot performance summary
    this.mcpServer.tool(
      "get_robot_summary",
      {
        robot_id: z.string().describe("ID of the robot")
      },
      async ({ robot_id }) => {
        try {
          const [robotData, runsData] = await Promise.all([
            this.makeApiRequest(`/api/robots/${robot_id}`),
            this.makeApiRequest(`/api/robots/${robot_id}/runs`)
          ]);

          const robot = robotData.robot;
          const runs = runsData.runs.items;

          const successfulRuns = runs.filter((run: any) => run.status === 'success');
          const failedRuns = runs.filter((run: any) => run.status === 'failed');
          
          let totalTextItems = 0;
          let totalListItems = 0;
          let totalScreenshots = 0;

          successfulRuns.forEach((run: any) => {
            if (run.data.textData) totalTextItems += run.data.textData.length;
            if (run.data.listData) totalListItems += run.data.listData.length;
            if (run.screenshots) totalScreenshots += run.screenshots.length;
          });

          const summary = `Robot Performance Summary:

Robot Name: ${robot.name}
Robot ID: ${robot.id}
Created: ${robot.createdAt ? new Date(robot.createdAt).toLocaleString() : 'N/A'}

Performance Metrics:
- Total Runs: ${runs.length}
- Successful Runs: ${successfulRuns.length}
- Failed Runs: ${failedRuns.length}
- Success Rate: ${runs.length > 0 ? ((successfulRuns.length / runs.length) * 100).toFixed(1) : 0}%

Data Extracted:
- Total Text Items: ${totalTextItems}
- Total List Items: ${totalListItems}
- Total Screenshots: ${totalScreenshots}
- Total Data Points: ${totalTextItems + totalListItems}

Input Parameters:
${JSON.stringify(robot.inputParameters, null, 2)}`;

          return {
            content: [{
              type: "text",
              text: summary
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: "text",
              text: `Error generating robot summary: ${error.message}`
            }],
            isError: true
          };
        }
      }
    );
  }

  async start() {
    try {
      const transport = new StdioServerTransport();
      await this.mcpServer.connect(transport);
      log('Maxun MCP Worker connected and ready');
    } catch (error: any) {
      log(`Failed to start MCP Worker: ${error.message}`);
      throw error;
    }
  }

  async stop() {
    try {
      await this.mcpServer.close();
      log('Maxun MCP Worker stopped');
    } catch (error: any) {
      log(`Error stopping MCP Worker: ${error.message}`);
    }
  }
}

async function main() {
  try {
    const worker = new MaxunMCPWorker();
    await worker.start();

    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      await worker.stop();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      await worker.stop();
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to start MCP Worker:', error);
    process.exit(1);
  }
}

// Only start if this is run as a worker or directly
if (process.env.MCP_WORKER === 'true' || require.main === module) {
  main();
}