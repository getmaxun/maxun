import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { createHash } from 'crypto';

dotenv.config();

const log = (message: string) => {
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[MCP Worker] ${message}`);
  }
};

const OUTPUT_FORMATS = ['markdown', 'html', 'text', 'links', 'summary', 'screenshot-visible', 'screenshot-fullpage'] as const;
type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** Crawl defaults, matching the SDKs, so callers only send what they change. */
const CRAWL_DEFAULTS = {
  mode: 'domain',
  limit: 50,
  maxDepth: 3,
  includePaths: [] as string[],
  excludePaths: [] as string[],
  useSitemap: true,
  followLinks: true,
  respectRobots: true,
};

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const textResult = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const errorResult = (prefix: string, error: any): ToolResult => ({
  content: [{ type: "text", text: `${prefix}: ${error?.message || error}` }],
  isError: true,
});

/**
 * Robots created by the one-shot tools (scrape, crawl, search) are named after
 * their target plus a short hash of their configuration. Calling a tool again
 * with the same arguments reuses the robot instead of creating a new one, so
 * repeat calls build up a run history (and change monitoring) on one robot.
 */
const robotNameFor = (label: string, target: string, config: unknown) => {
  const hash = createHash('sha256').update(JSON.stringify(config)).digest('hex').substring(0, 8);
  const shortTarget = target.length > 80 ? `${target.substring(0, 77)}...` : target;
  return `MCP ${label}: ${shortTarget} [${hash}]`;
};

const describeTarget = (url: string) => {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return url;
  }
};

/**
 * Formats a run's output for an MCP client. Page content (markdown, text, html,
 * summaries, smart-query answers) is returned as plain text blocks rather than
 * escaped JSON strings; structured data stays JSON.
 */
const formatRun = (run: any): ToolResult => {
  const data = run?.data || {};
  const header = {
    runId: run?.runId,
    status: run?.status,
    ...(run?.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run?.finishedAt ? { finishedAt: run.finishedAt } : {}),
    ...(run?.hasChanges !== undefined ? { hasChanges: run.hasChanges, changedFormats: run.changedFormats || [] } : {}),
  };

  const structured: Record<string, any> = {};
  const isNonEmpty = (value: any) =>
    value !== undefined && value !== null && value !== '' &&
    !(Array.isArray(value) && value.length === 0) &&
    !(typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);

  for (const key of ['textData', 'listData', 'crawlData', 'searchData', 'links']) {
    if (isNonEmpty(data[key])) structured[key] = data[key];
  }
  const screenshots = (run?.screenshots || []).filter(Boolean);
  if (screenshots.length) structured.screenshots = screenshots;

  const blocks: { type: "text"; text: string }[] = [
    { type: "text", text: JSON.stringify({ ...header, ...structured }, null, 2) },
  ];
  const sections: [string, any][] = [
    ['Smart query answer', data.promptResult],
    ['Summary', data.summary],
    ['Markdown', data.markdown],
    ['Text', data.text],
    ['HTML', data.html],
  ];
  for (const [title, value] of sections) {
    if (typeof value === 'string' && value.trim()) {
      blocks.push({ type: "text", text: `## ${title}\n\n${value}` });
    }
  }
  return { content: blocks };
};

class MaxunMCPWorker {
  private mcpServer: McpServer;
  private apiKey: string;
  private apiUrl: string;
  private llmConfig: Record<string, string>;

  constructor() {
    this.apiKey = process.env.MCP_API_KEY || '';
    this.apiUrl = (process.env.BACKEND_URL || 'http://localhost:8080').replace(/\/+$/, '');

    if (!this.apiKey) {
      throw new Error('MCP_API_KEY environment variable is required');
    }

    // Optional LLM settings for maxun_agent, the "summary" format and smart queries.
    this.llmConfig = Object.fromEntries(Object.entries({
      llmProvider: process.env.MAXUN_LLM_PROVIDER,
      llmModel: process.env.MAXUN_LLM_MODEL,
      llmApiKey: process.env.MAXUN_LLM_API_KEY,
      llmBaseUrl: process.env.MAXUN_LLM_BASE_URL,
    }).filter(([, value]) => typeof value === 'string' && value.trim() !== '')) as Record<string, string>;

    this.mcpServer = new McpServer({
      name: 'Maxun Web Scraping Server',
      version: '2.0.0'
    });

    this.setupTools();
  }

  private async makeApiRequest(endpoint: string, options: any = {}) {
    const url = `${this.apiUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'x-run-source': 'mcp',
      ...options.headers
    };

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      // Surface the server's own explanation (validation errors, missing LLM config, ...).
      let detail = '';
      try {
        const body: any = await response.json();
        detail = [body?.error, body?.message, body?.details && JSON.stringify(body.details)]
          .filter((part) => typeof part === 'string' && part)
          .join(' - ');
      } catch {
        // Body was not JSON.
      }
      throw new Error(`API request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`);
    }

    return await response.json();
  }

  private post(endpoint: string, body: unknown) {
    return this.makeApiRequest(endpoint, { method: 'POST', body: JSON.stringify(body) });
  }

  private async findRobotIdByName(name: string): Promise<string | null> {
    const data = await this.makeApiRequest('/api/robots');
    const match = (data.robots?.items || []).find((robot: any) => robot.name === name);
    return match?.id || null;
  }

  /** Runs a robot. With `wait`, blocks until it finishes and returns its output. */
  private async executeRobot(robotId: string, options: { formats?: OutputFormat[]; wait?: boolean } = {}) {
    const data = await this.post(`/api/sdk/robots/${robotId}/execute`, {
      ...(options.formats ? { formats: options.formats } : {}),
      ...(options.wait === false ? { wait: false } : {}),
    });
    return data.data;
  }

  private async runAndFormat(robotId: string, wait: boolean, label: string): Promise<ToolResult> {
    const run = await this.executeRobot(robotId, { wait });
    if (!wait) {
      return textResult(
        `${label} started.\nRobot ID: ${robotId}\nRun ID: ${run.runId}\nStatus: ${run.status}\n\n` +
        `Call maxun_get_run with this robot_id and run_id to fetch the result once it finishes.`
      );
    }
    const result = formatRun(run);
    result.content[0].text = `Robot ID: ${robotId}\n${result.content[0].text}`;
    return result;
  }

  private setupTools() {
    // ---------------------------------------------------------------------
    // One-shot tools: build a robot from the arguments, run it, return data.
    // ---------------------------------------------------------------------

    this.mcpServer.tool(
      "maxun_scrape",
      "Scrape a single web page and return its content as clean markdown (default), HTML, text, links and/or screenshots. " +
      "Optionally answer questions about the page with smart_queries. Best when you know the exact URL.",
      {
        url: z.string().url().describe("The page to scrape"),
        formats: z.array(z.enum(OUTPUT_FORMATS)).optional().describe('Output formats (default ["markdown"]). "summary" needs an LLM configured.'),
        smart_queries: z.string().optional().describe("Questions to answer from the page content, e.g. 'What is the price of the Pro plan?'. Needs an LLM configured."),
        robot_name: z.string().optional().describe("Name for the robot that is saved for this scrape. Defaults to one derived from the URL."),
      },
      async ({ url, formats, smart_queries, robot_name }) => {
        try {
          const finalFormats = formats && formats.length ? formats : ['markdown'];
          const name = robot_name || robotNameFor('Scrape', describeTarget(url), { url, formats: finalFormats, smart_queries });
          const created = await this.post('/api/sdk/robots', {
            meta: {
              name,
              type: 'scrape',
              url,
              formats: finalFormats,
              ...(smart_queries ? { promptInstructions: smart_queries } : {}),
              ...this.llmConfig,
            },
            workflow: [],
          });
          return await this.runAndFormat(created.data.recording_meta.id, true, 'Scrape');
        } catch (error: any) {
          return errorResult('Error scraping page', error);
        }
      }
    );

    this.mcpServer.tool(
      "maxun_crawl",
      "Crawl a website starting from a URL and return the content of every page found (markdown by default). " +
      "Use for documentation sites, blogs or any task that needs many pages of one site. Crawls can take several minutes; " +
      "set wait to false to start it in the background and poll with maxun_get_run.",
      {
        url: z.string().url().describe("Where to start crawling"),
        limit: z.number().int().min(1).max(1000).optional().describe("Maximum number of pages (default 50)"),
        max_depth: z.number().int().min(0).max(10).optional().describe("How many links deep to follow from the start URL (default 3)"),
        mode: z.enum(['domain', 'subdomain', 'path']).optional().describe("Scope: whole domain (default), include subdomains, or only under the start URL's path"),
        include_paths: z.array(z.string()).optional().describe("Only crawl URLs whose path matches one of these patterns, e.g. ['/docs/']"),
        exclude_paths: z.array(z.string()).optional().describe("Skip URLs whose path matches one of these patterns, e.g. ['/blog/']"),
        use_sitemap: z.boolean().optional().describe("Discover pages from sitemap.xml (default true)"),
        follow_links: z.boolean().optional().describe("Discover pages by following links (default true)"),
        respect_robots: z.boolean().optional().describe("Obey robots.txt (default true)"),
        formats: z.array(z.enum(OUTPUT_FORMATS)).optional().describe('Output formats per page (default ["markdown"])'),
        wait: z.boolean().default(true).describe("Wait for the crawl to finish (default true)"),
        robot_name: z.string().optional().describe("Name for the saved crawl robot"),
      },
      async (args) => {
        try {
          const crawlConfig = {
            ...CRAWL_DEFAULTS,
            ...(args.mode ? { mode: args.mode } : {}),
            ...(args.limit !== undefined ? { limit: args.limit } : {}),
            ...(args.max_depth !== undefined ? { maxDepth: args.max_depth } : {}),
            ...(args.include_paths ? { includePaths: args.include_paths } : {}),
            ...(args.exclude_paths ? { excludePaths: args.exclude_paths } : {}),
            ...(args.use_sitemap !== undefined ? { useSitemap: args.use_sitemap } : {}),
            ...(args.follow_links !== undefined ? { followLinks: args.follow_links } : {}),
            ...(args.respect_robots !== undefined ? { respectRobots: args.respect_robots } : {}),
          };
          const formats = args.formats && args.formats.length ? args.formats : ['markdown'];
          const name = args.robot_name || robotNameFor('Crawl', describeTarget(args.url), { url: args.url, crawlConfig, formats });
          const created = await this.post('/api/sdk/crawl', {
            url: args.url,
            name,
            crawlConfig,
            formats,
            ...this.llmConfig,
          });
          return await this.runAndFormat(created.data.recording_meta.id, args.wait, 'Crawl');
        } catch (error: any) {
          return errorResult('Error crawling site', error);
        }
      }
    );

    this.mcpServer.tool(
      "maxun_search",
      "Search the web and return the results. In 'discover' mode (default) returns titles, URLs and snippets; " +
      "in 'scrape' mode also scrapes each result page (markdown by default).",
      {
        query: z.string().min(1).describe("The search query"),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum number of results (default 10)"),
        mode: z.enum(['discover', 'scrape']).optional().describe("'discover' returns result links only; 'scrape' also fetches each page"),
        time_range: z.enum(['day', 'week', 'month', 'year']).optional().describe("Only return results from this period"),
        formats: z.array(z.enum(OUTPUT_FORMATS)).optional().describe('Output formats per scraped result in scrape mode (default ["markdown"])'),
        robot_name: z.string().optional().describe("Name for the saved search robot"),
      },
      async ({ query, limit, mode, time_range, formats, robot_name }) => {
        try {
          const searchConfig = {
            query,
            mode: mode || 'discover',
            limit: limit ?? 10,
            ...(time_range ? { filters: { timeRange: time_range } } : {}),
          };
          const finalFormats = searchConfig.mode === 'scrape' ? (formats && formats.length ? formats : ['markdown']) : (formats || []);
          const name = robot_name || robotNameFor('Search', query, { searchConfig, formats: finalFormats });

          // Search robots are not de-duplicated by the server, so reuse by name here.
          let robotId = await this.findRobotIdByName(name);
          if (!robotId) {
            const created = await this.post('/api/sdk/search', {
              name,
              searchConfig,
              formats: finalFormats,
              ...this.llmConfig,
            });
            robotId = created.data.recording_meta.id as string;
          }
          return await this.runAndFormat(robotId, true, 'Search');
        } catch (error: any) {
          return errorResult('Error searching the web', error);
        }
      }
    );

    this.mcpServer.tool(
      "maxun_agent",
      "Describe the data you want in plain language and let Maxun's AI build an extraction robot for it (AI Mode), " +
      "then run it and return structured rows. Give a url when you know the site; leave it out to let the agent find one. " +
      "The robot is saved, so it can be re-run later with maxun_run_robot. Requires an LLM to be configured for the MCP worker.",
      {
        prompt: z.string().min(15).describe("What to extract, e.g. 'Get the name, price and rating of the first 20 laptops'"),
        url: z.string().url().optional().describe("Where to start. Leave out to let the agent search for the right site."),
        robot_name: z.string().optional().describe("Name for the saved robot"),
        run: z.boolean().default(true).describe("Run the robot right after building it (default true). Set false to only build it."),
      },
      async ({ prompt, url, robot_name, run }) => {
        try {
          if (!this.llmConfig.llmProvider) {
            return errorResult(
              'maxun_agent needs an LLM',
              'set MAXUN_LLM_PROVIDER (anthropic, openai or ollama), MAXUN_LLM_MODEL and MAXUN_LLM_API_KEY (or MAXUN_LLM_BASE_URL for ollama) in the MCP server env'
            );
          }
          const created = await this.post('/api/sdk/extract/llm', {
            prompt,
            ...(url ? { url } : {}),
            ...(robot_name ? { robotName: robot_name } : {}),
            ...this.llmConfig,
          });
          const robot = created.data;
          const intro = `Robot built.\nRobot ID: ${robot.robotId}\nName: ${robot.name}\nURL: ${robot.url || '(none)'}`;
          if (!run) {
            return textResult(`${intro}\n\nRun it with maxun_run_robot when you are ready.`);
          }
          const result = formatRun(await this.executeRobot(robot.robotId));
          result.content.unshift({ type: "text", text: intro });
          return result;
        } catch (error: any) {
          return errorResult('Error running agent', error);
        }
      }
    );

    // ---------------------------------------------------------------------
    // Robots and runs.
    // ---------------------------------------------------------------------

    this.mcpServer.tool(
      "maxun_list_robots",
      "List all robots in your Maxun instance with their IDs and names.",
      async () => {
        try {
          const data = await this.makeApiRequest('/api/robots');

          return textResult(`Found ${data.robots.totalCount} robots:\n\n${JSON.stringify(data.robots.items, null, 2)}`);
        } catch (error: any) {
          return errorResult('Error fetching robots', error);
        }
      }
    );

    this.mcpServer.tool(
      "maxun_get_robot",
      "Get the details of a robot by its ID.",
      {
        robot_id: z.string().describe("ID of the robot to get details for")
      },
      async ({ robot_id }) => {
        try {
          const data = await this.makeApiRequest(`/api/robots/${robot_id}`);

          return textResult(`Robot Details:\n\n${JSON.stringify(data.robot, null, 2)}`);
        } catch (error: any) {
          return errorResult('Error fetching robot', error);
        }
      }
    );

    this.mcpServer.tool(
      "maxun_run_robot",
      "Run an existing robot and return the data it extracts. Set wait to false to start it in the background and poll with maxun_get_run.",
      {
        robot_id: z.string().describe("ID of the robot to run"),
        formats: z.array(z.enum(OUTPUT_FORMATS)).optional().describe("Override the output formats for scrape, crawl and search robots"),
        wait: z.boolean().default(true).describe("Wait for the run to complete (default true)"),
      },
      async ({ robot_id, formats, wait }) => {
        try {
          const run = await this.executeRobot(robot_id, { formats, wait });
          if (!wait) {
            return textResult(`Robot run started! Run ID: ${run.runId}\nStatus: ${run.status}\n\nCall maxun_get_run to fetch the result once it finishes.`);
          }
          return formatRun(run);
        } catch (error: any) {
          return errorResult('Error running robot', error);
        }
      }
    );

    this.mcpServer.tool(
      "maxun_get_robot_runs",
      "List a robot's runs with their IDs, statuses and timestamps.",
      {
        robot_id: z.string().describe("ID of the robot")
      },
      async ({ robot_id }) => {
        try {
          const data = await this.makeApiRequest(`/api/robots/${robot_id}/runs`);

          return textResult(`Robot runs (${data.runs.totalCount} total):\n\n${JSON.stringify(data.runs.items, null, 2)}`);
        } catch (error: any) {
          return errorResult('Error fetching runs', error);
        }
      }
    );

    this.mcpServer.tool(
      "maxun_get_run",
      "Get a run's status and, once it has finished, all the data it extracted.",
      {
        robot_id: z.string().describe("ID of the robot"),
        run_id: z.string().describe("ID of the specific run")
      },
      async ({ robot_id, run_id }) => {
        try {
          const data = await this.makeApiRequest(`/api/robots/${robot_id}/runs/${run_id}`);
          return formatRun(data.run);
        } catch (error: any) {
          return errorResult('Error fetching run details', error);
        }
      }
    );

    this.mcpServer.tool(
      "maxun_cancel_run",
      "Cancel a queued or running run.",
      {
        robot_id: z.string().describe("ID of the robot"),
        run_id: z.string().describe("ID of the run to cancel"),
      },
      async ({ robot_id, run_id }) => {
        try {
          const data = await this.post(`/api/sdk/robots/${robot_id}/runs/${run_id}/abort`, {});
          return textResult(data.message || `Run ${run_id} is being cancelled.`);
        } catch (error: any) {
          return errorResult('Error cancelling run', error);
        }
      }
    );

    this.mcpServer.tool(
      "maxun_get_run_diff",
      "Show what changed between a run and the robot's previous successful run (for robots with change monitoring).",
      {
        robot_id: z.string().describe("ID of the robot"),
        run_id: z.string().describe("ID of the run to compare"),
        format: z.string().optional().describe("Only return the diff for this format, e.g. 'markdown' or 'captured-list'"),
      },
      async ({ robot_id, run_id, format }) => {
        try {
          const query = format ? `?format=${encodeURIComponent(format)}` : '';
          const data = await this.makeApiRequest(`/api/sdk/robots/${robot_id}/runs/${run_id}/diff${query}`);
          return textResult(JSON.stringify(data.data, null, 2));
        } catch (error: any) {
          return errorResult('Error fetching run diff', error);
        }
      }
    );

    this.mcpServer.tool(
      "maxun_get_robot_summary",
      "Get performance statistics for a robot: total runs, success rate and amount of data extracted.",
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

          return textResult(summary);
        } catch (error: any) {
          return errorResult('Error generating robot summary', error);
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
