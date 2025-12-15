import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import AuthHandler from "./auth-handler";

// Gemini API configuration
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
const AGENT_MODEL = "deep-research-pro-preview-12-2025";

// Types for research tasks
interface ResearchTask {
  interaction_id: string;
  query: string;
  status: "in_progress" | "completed" | "failed";
  started_at: number; // Unix timestamp in ms for reliable time math
  last_checked_at?: number; // Unix timestamp in ms
  result?: string;
  error?: string;
  userId: string; // Store userId for task ownership
}

// Props passed from OAuth - contains the API key
interface AuthProps {
  apiKey: string;
  userId: string;
}

// Gemini API functions
async function createInteraction(apiKey: string, query: string, previousId?: string): Promise<any> {
  const payload: any = {
    input: query,
    agent: AGENT_MODEL,
    background: true
  };

  if (previousId) {
    payload.previous_interaction_id = previousId;
  }

  const response = await fetch(`${GEMINI_API}/interactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }

  return response.json();
}

async function getInteraction(apiKey: string, interactionId: string): Promise<any> {
  const response = await fetch(`${GEMINI_API}/interactions/${interactionId}`, {
    headers: { "x-goog-api-key": apiKey }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }

  return response.json();
}

// Deep Research MCP Agent with OAuth props
export class DeepResearchMCP extends McpAgent<Env, unknown, AuthProps> {
  server = new McpServer({
    name: "deep-research-mcp",
    version: "1.0.0",
    description: "MCP server for Gemini Deep Research - autonomous research agent"
  });

  // Get API key from OAuth props
  private getApiKey(): string {
    // API key comes from OAuth props (set by OAuthProvider during auth)
    if (this.props?.apiKey) {
      return this.props.apiKey;
    }
    throw new Error("API key not configured. Please reconnect and enter your Gemini API key.");
  }

  // Get user ID from OAuth props
  private getUserId(): string {
    if (this.props?.userId) {
      return this.props.userId;
    }
    throw new Error("User ID not available. Please reconnect.");
  }

  // KV storage helpers - tasks persist across sessions using OAUTH_KV
  // Key format: task:{userId}:{interaction_id}
  private async storeTask(task: ResearchTask): Promise<void> {
    const key = `task:${task.userId}:${task.interaction_id}`;
    await this.env.OAUTH_KV.put(key, JSON.stringify(task), {
      expirationTtl: 60 * 60 * 24 * 7 // 7 days TTL
    });
    console.log(`Stored task in KV: ${key}`);
  }

  private async getTask(interactionId: string): Promise<ResearchTask | null> {
    const userId = this.getUserId();
    const key = `task:${userId}:${interactionId}`;
    const data = await this.env.OAUTH_KV.get(key);
    if (data) {
      console.log(`Retrieved task from KV: ${key}`);
      return JSON.parse(data) as ResearchTask;
    }
    console.log(`Task not found in KV: ${key}`);
    return null;
  }

  private async listTasks(): Promise<ResearchTask[]> {
    const userId = this.getUserId();
    const prefix = `task:${userId}:`;
    const list = await this.env.OAUTH_KV.list({ prefix });
    const tasks: ResearchTask[] = [];

    console.log(`Listing tasks with prefix: ${prefix}, found ${list.keys.length} keys`);

    for (const key of list.keys) {
      const data = await this.env.OAUTH_KV.get(key.name);
      if (data) {
        tasks.push(JSON.parse(data) as ResearchTask);
      }
    }
    return tasks;
  }

  async init() {
    // Register prompt for usage guidelines
    this.server.prompt(
      "deep_research_guidelines",
      "Guidelines for using Deep Research tools effectively",
      () => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `# Deep Research Usage Guidelines

Deep Research is a long-running autonomous research agent. Follow these guidelines:

## Polling Strategy (IMPORTANT)
- Research tasks take 5-15 minutes to complete
- After starting research, wait AT LEAST 2 minutes before the first check
- Between checks, wait AT LEAST 90 seconds
- DO NOT poll more frequently - it wastes tokens and doesn't speed up research
- The response includes 'next_check_seconds' - always wait at least that long

## Recommended Flow
1. Call start_deep_research with your query
2. Inform the user that research will take 5-15 minutes
3. Wait 2+ minutes, then call check_deep_research
4. If still in_progress, wait another 90+ seconds before checking again
5. Repeat until completed or failed

## Token Efficiency
Each check costs tokens. Checking every 5 seconds for a 10-minute task = 120 unnecessary API calls.
Instead: 2-minute initial wait + 90-second intervals = ~6-8 checks total.`
          }
        }]
      })
    );

    // Tool 1: Start a deep research task
    this.server.tool(
      "start_deep_research",
      "Start a deep research task. IMPORTANT: Research takes 5-15 minutes. After calling this, wait at least 2 minutes before checking status. Do not poll frequently.",
      {
        query: z.string().describe("The research topic or question to investigate"),
        previous_id: z.string().optional().describe("Optional: continue from a previous research interaction")
      },
      async ({ query, previous_id }) => {
        try {
          const apiKey = this.getApiKey();
          const userId = this.getUserId();
          const interaction = await createInteraction(apiKey, query, previous_id);

          // Extract interaction ID from response
          const interactionId = interaction.name?.split("/").pop() || interaction.id;

          // Store task in KV with Unix timestamp - persists across sessions!
          const task: ResearchTask = {
            interaction_id: interactionId,
            query: query,
            status: "in_progress",
            started_at: Date.now(),
            userId: userId
          };

          await this.storeTask(task);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                interaction_id: interactionId,
                status: "in_progress",
                wait_before_first_check_seconds: 120,
                message: "Research started. IMPORTANT: Deep Research takes 5-15 minutes. DO NOT check status for at least 2 minutes (120 seconds). Frequent polling wastes tokens and does not speed up research."
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: error.message
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    // Tool 2: Check research status/results
    this.server.tool(
      "check_deep_research",
      "Check status of a research task. IMPORTANT: Only call this after waiting the recommended time (2 min initial, then 90 sec between checks). Response includes next_check_seconds - always wait at least that long.",
      {
        interaction_id: z.string().describe("The interaction ID from start_deep_research")
      },
      async ({ interaction_id }) => {
        try {
          const apiKey = this.getApiKey();
          const now = Date.now();

          // Get stored task from KV for elapsed time calculation and rate limiting
          const storedTask = await this.getTask(interaction_id);

          // If no stored task, this interaction wasn't started through this MCP
          if (!storedTask) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  interaction_id,
                  error: "Task not found. This interaction was not started through this MCP server, or the task has expired. Use start_deep_research to begin a new research task."
                }, null, 2)
              }],
              isError: true
            };
          }

          const elapsedSeconds = Math.floor((now - storedTask.started_at) / 1000);

          // ENFORCE rate limiting - minimum 60 seconds between checks
          const MIN_CHECK_INTERVAL_MS = 60000; // 60 seconds
          const MIN_INITIAL_WAIT_MS = 90000; // 90 seconds before first check

          if (storedTask.last_checked_at) {
            const timeSinceLastCheck = now - storedTask.last_checked_at;
            if (timeSinceLastCheck < MIN_CHECK_INTERVAL_MS) {
              const waitSeconds = Math.ceil((MIN_CHECK_INTERVAL_MS - timeSinceLastCheck) / 1000);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    interaction_id,
                    status: "rate_limited",
                    elapsed_seconds: elapsedSeconds,
                    wait_seconds: waitSeconds,
                    message: `Too soon! You checked ${Math.floor(timeSinceLastCheck / 1000)} seconds ago. Wait at least ${waitSeconds} more seconds before checking again. Research takes 5-15 minutes.`
                  }, null, 2)
                }]
              };
            }
          } else {
            // First check - enforce initial wait
            const timeSinceStart = now - storedTask.started_at;
            if (timeSinceStart < MIN_INITIAL_WAIT_MS) {
              const waitSeconds = Math.ceil((MIN_INITIAL_WAIT_MS - timeSinceStart) / 1000);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    interaction_id,
                    status: "too_early",
                    elapsed_seconds: elapsedSeconds,
                    wait_seconds: waitSeconds,
                    message: `Too early! Research just started ${elapsedSeconds} seconds ago. Wait at least ${waitSeconds} more seconds before the first check. Research takes 5-15 minutes.`
                  }, null, 2)
                }]
              };
            }
          }

          // Update last checked time BEFORE making API call
          storedTask.last_checked_at = now;
          await this.storeTask(storedTask);

          const interaction = await getInteraction(apiKey, interaction_id);
          const status = interaction.status?.toLowerCase() || "unknown";

          if (status === "completed") {
            // Extract result text
            const outputs = interaction.outputs || [];
            const result = outputs.length > 0
              ? outputs[outputs.length - 1].text || JSON.stringify(outputs[outputs.length - 1])
              : "No output available";

            // Update stored task status
            storedTask.status = "completed";
            storedTask.result = result;
            await this.storeTask(storedTask);

            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  interaction_id,
                  status: "completed",
                  elapsed_seconds: elapsedSeconds,
                  elapsed_time: `${Math.floor(elapsedSeconds / 60)} min ${elapsedSeconds % 60} sec`,
                  result
                }, null, 2)
              }]
            };
          } else if (status === "failed") {
            const error = interaction.error || "Unknown error";

            // Update stored task status
            storedTask.status = "failed";
            storedTask.error = error;
            await this.storeTask(storedTask);

            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  interaction_id,
                  status: "failed",
                  elapsed_seconds: elapsedSeconds,
                  elapsed_time: `${Math.floor(elapsedSeconds / 60)} min ${elapsedSeconds % 60} sec`,
                  error
                }, null, 2)
              }],
              isError: true
            };
          } else {
            // Still in progress - enforce minimum 60 second wait
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  interaction_id,
                  status: "in_progress",
                  elapsed_seconds: elapsedSeconds,
                  elapsed_time: `${Math.floor(elapsedSeconds / 60)} min ${elapsedSeconds % 60} sec`,
                  next_check_seconds: 60,
                  message: `Research is still running. You MUST wait at least 60 seconds before checking again. The server will reject earlier checks.`
                }, null, 2)
              }]
            };
          }
        } catch (error: any) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: error.message
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    // Tool 3: List all research tasks
    this.server.tool(
      "list_research_tasks",
      "List all research tasks for this user. Shows status and elapsed time for each task.",
      {},
      async () => {
        try {
          // Get all tasks from KV storage - persists across sessions
          const storedTasks = await this.listTasks();
          const now = Date.now();
          const tasks: Array<{
            interaction_id: string;
            query: string;
            status: string;
            started_at: string;
            elapsed_seconds: number;
            elapsed_time: string;
            result_preview?: string;
          }> = [];

          for (const task of storedTasks) {
            const elapsedSeconds = Math.floor((now - task.started_at) / 1000);
            tasks.push({
              interaction_id: task.interaction_id,
              query: task.query.length > 100 ? task.query.substring(0, 100) + "..." : task.query,
              status: task.status,
              started_at: new Date(task.started_at).toISOString(),
              elapsed_seconds: elapsedSeconds,
              elapsed_time: `${Math.floor(elapsedSeconds / 60)} min ${elapsedSeconds % 60} sec`,
              result_preview: task.result ? `[${task.result.length} chars - use check_deep_research to view]` : undefined
            });
          }

          // Sort by started_at descending (most recent first)
          tasks.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                task_count: tasks.length,
                tasks,
                message: tasks.length === 0
                  ? "No research tasks found. Use start_deep_research to begin a new research task."
                  : `Found ${tasks.length} task(s).`
              }, null, 2)
            }]
          };
        } catch (error: any) {
          console.error("Error listing tasks:", error);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: error.message,
                task_count: 0
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );
  }
}

// Type declarations
interface Env {
  MCP_OBJECT: DurableObjectNamespace;
  OAUTH_KV: KVNamespace; // Used for persistent task storage across sessions
}

// Export OAuthProvider as the default handler
// OAuthProvider sets ctx.props with decrypted auth props before calling apiHandler
export default new OAuthProvider({
  apiRoute: "/sse",
  apiHandler: DeepResearchMCP.serveSSE("/sse"),
  defaultHandler: AuthHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
