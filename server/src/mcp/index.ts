// mcp-server/index.ts
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import fetch from 'node-fetch';
import logger from '../logger';

// Configuration for the MCP server
interface MaxunMCPConfig {
  name: string;
  version: string;
  maxunApiUrl: string;
  apiKey: string;
  transport: 'stdio' | 'http';
  httpPort?: number;
}

class MaxunMCPServer {
  private mcpServer: McpServer;
  private config: MaxunMCPConfig;

  constructor(config: MaxunMCPConfig) {
    this.config = config;
    this.mcpServer = new McpServer({
      name: config.name,
      version: config.version
    });

    this.setupTools();
    this.setupResources();
    this.setupPrompts();
  }

  private async makeApiRequest(endpoint: string, options: any = {}) {
    const url = `${this.config.maxunApiUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
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
            // The API already waits for completion and returns the complete run data
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

    // Tool: Scrape any website with a one-time robot
    this.mcpServer.tool(
      "scrape_website",
      {
        url: z.string().url().describe("URL to scrape"),
        description: z.string().describe("Description of what data to extract"),
        robot_name: z.string().optional().describe("Optional name for the temporary robot")
      },
      async ({ url, description, robot_name }) => {
        try {
          // Note: This would require creating a robot first, then running it
          // Since your API doesn't have a direct scrape endpoint, we'll guide the user
          const robotName = robot_name || `Temp_Robot_${Date.now()}`;
          
          return {
            content: [{
              type: "text",
              text: `To scrape ${url} for "${description}", you would need to:

1. First create a robot using the Maxun web interface at your configured URL
2. Train the robot to extract the desired data: ${description}
3. Note the robot ID from the interface
4. Then use the 'run_robot' tool with that robot ID

Alternatively, you can:
1. Use 'list_robots' to see existing robots
2. Find a robot that might work for similar data extraction
3. Use 'run_robot' with that robot's ID

Robot name suggestion: ${robotName}
Target URL: ${url}
Extraction goal: ${description}`
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: "text",
              text: `Error: ${error.message}`
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

  private setupResources() {
    // Resource: Get robot data as JSON
    this.mcpServer.resource(
      "robot-data",
      new ResourceTemplate("robot-data://{robot_id}?run_id={run_id}", { 
        list: undefined 
      }),
      async (uri, { robot_id, run_id }) => {
        if (!robot_id) {
          throw new Error('robot_id parameter is required');
        }

        try {
          let data;
          if (run_id) {
            data = await this.makeApiRequest(`/api/robots/${robot_id}/runs/${run_id}`);
          } else {
            data = await this.makeApiRequest(`/api/robots/${robot_id}/runs`);
          }
          
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(data, null, 2),
              mimeType: "application/json"
            }]
          };
        } catch (error: any) {
          throw new Error(`Error fetching robot data: ${error.message}`);
        }
      }
    );

    // Resource: Get extracted data as CSV format
    this.mcpServer.resource(
      "extracted-data-csv",
      new ResourceTemplate("extracted-data-csv://{robot_id}/{run_id}", { 
        list: undefined 
      }),
      async (uri, { robot_id, run_id }) => {
        if (!robot_id || !run_id) {
          throw new Error('Both robot_id and run_id parameters are required');
        }

        try {
          const data = await this.makeApiRequest(`/api/robots/${robot_id}/runs/${run_id}`);
          const run = data.run;
          
          // Convert extracted data to CSV format
          let csvContent = '';
          
          if (run.data.textData && run.data.textData.length > 0) {
            csvContent += 'Type,Data\n';
            run.data.textData.forEach((item: any) => {
              csvContent += `"text","${JSON.stringify(item).replace(/"/g, '""')}"\n`;
            });
          }
          
          if (run.data.listData && run.data.listData.length > 0) {
            if (csvContent) csvContent += '\n';
            run.data.listData.forEach((item: any) => {
              csvContent += `"list","${JSON.stringify(item).replace(/"/g, '""')}"\n`;
            });
          }
          
          return {
            contents: [{
              uri: uri.href,
              text: csvContent,
              mimeType: "text/csv"
            }]
          };
        } catch (error: any) {
          throw new Error(`Error generating CSV: ${error.message}`);
        }
      }
    );
  }

  private setupPrompts() {
    // Prompt: Analyze website and suggest scraping strategy
    this.mcpServer.prompt(
      "analyze-website-for-scraping",
      {
        url: z.string().url().describe("URL of the website to analyze"),
        target_data: z.string().describe("Description of the data you want to extract")
      },
      ({ url, target_data }) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Analyze this website for web scraping and provide a strategy:

Website URL: ${url}
Target Data: ${target_data}

Please help me:
1. First, use the 'list_robots' tool to see if there are existing robots that might work
2. If there's a suitable robot, use 'get_robot_summary' to check its performance
3. If there's a good existing robot, use 'run_robot' to extract the data
4. If no suitable robot exists, provide detailed instructions for creating a new robot

Focus on:
- Identifying the best approach for extracting: ${target_data}
- Recommending specific robots from the available list if applicable
- Providing step-by-step guidance for the scraping process`
          }
        }]
      })
    );

    // Prompt: Monitor and analyze robot performance
    this.mcpServer.prompt(
      "analyze-robot-performance",
      {
        robot_id: z.string().describe("ID of the robot to analyze")
      },
      ({ robot_id }) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Perform a comprehensive analysis of robot performance:

Robot ID: ${robot_id}

Please:
1. Use 'get_robot_summary' to get overall performance metrics
2. Use 'get_robot_runs' to analyze recent run patterns
3. Identify any performance issues or trends
4. Suggest optimizations if needed
5. Provide recommendations for improving success rates

Focus on:
- Success rate analysis
- Data extraction efficiency
- Error patterns
- Performance trends over time`
          }
        }]
      })
    );

    // Prompt: Extract and format data
    this.mcpServer.prompt(
      "extract-and-format-data",
      {
        robot_id: z.string().describe("ID of the robot to use"),
        output_format: z.enum(["json", "csv", "summary"]).describe("Desired output format")
      },
      ({ robot_id, output_format }) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Extract data using the specified robot and format the output:

Robot ID: ${robot_id}
Output Format: ${output_format}

Please:
1. Use 'run_robot' to execute the data extraction
2. Format the extracted data according to the requested format
3. Provide a clean, organized presentation of the results
4. Include metadata about the extraction (timing, data volume, etc.)

For ${output_format} format:
${output_format === 'json' ? '- Structure data as clean JSON objects' : 
  output_format === 'csv' ? '- Format as comma-separated values with headers' :
  '- Provide a human-readable summary with key insights'}

Ensure the output is ready for immediate use in downstream applications.`
          }
        }]
      })
    );

    // Prompt: Compare robots for task suitability
    this.mcpServer.prompt(
      "compare-robots-for-task",
      {
        task_description: z.string().describe("Description of the scraping task"),
        website_type: z.string().optional().describe("Type of website (e.g., e-commerce, news, social media)")
      },
      ({ task_description, website_type }) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Help me find the best robot for this scraping task:

Task: ${task_description}
${website_type ? `Website Type: ${website_type}` : ''}

Please:
1. Use 'list_robots' to get all available robots
2. Analyze each robot's capabilities based on their names and parameters
3. Use 'get_robot_summary' for the most promising candidates
4. Compare their performance metrics and success rates
5. Recommend the best robot(s) for this specific task

Consider:
- Robot specialization and target websites
- Success rates and reliability
- Data extraction capabilities
- Recent performance trends

Provide a ranked recommendation with reasoning for each choice.`
          }
        }]
      })
    );
  }

  async start() {
    try {
      let transport;

      if (this.config.transport === 'stdio') {
        transport = new StdioServerTransport();
        logger.log('info', 'Starting Maxun MCP server with stdio transport');
      } else {
        // HTTP transport for web-based MCP clients
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined // Stateless for simplicity
        });
        logger.log('info', `Starting Maxun MCP server with HTTP transport on port ${this.config.httpPort}`);
      }

      await this.mcpServer.connect(transport);
      logger.log('info', 'Maxun MCP server connected and ready');

      return transport;
    } catch (error: any) {
      logger.log('error', `Failed to start Maxun MCP server: ${error.message}`);
      throw error;
    }
  }

  async stop() {
    try {
      await this.mcpServer.close();
      logger.log('info', 'Maxun MCP server stopped');
    } catch (error: any) {
      logger.log('error', `Error stopping Maxun MCP server: ${error.message}`);
    }
  }
}

export default MaxunMCPServer;