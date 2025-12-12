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
  started_at: string;
  result?: string;
  error?: string;
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

  async init() {
    // Tool 1: Start a deep research task
    this.server.tool(
      "start_deep_research",
      {
        query: z.string().describe("The research topic or question to investigate"),
        previous_id: z.string().optional().describe("Optional: continue from a previous research interaction")
      },
      async ({ query, previous_id }) => {
        try {
          const apiKey = this.getApiKey();
          const interaction = await createInteraction(apiKey, query, previous_id);

          // Extract interaction ID from response
          const interactionId = interaction.name?.split("/").pop() || interaction.id;

          // Store task in Durable Object state
          const task: ResearchTask = {
            interaction_id: interactionId,
            query: query,
            status: "in_progress",
            started_at: new Date().toISOString()
          };

          await this.ctx.storage.put(`task:${interactionId}`, task);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                interaction_id: interactionId,
                status: "in_progress",
                message: "Research started. Deep Research typically takes 5-15 minutes. Use check_deep_research with this interaction_id to poll for results, or list_research_tasks to see all your research tasks."
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
      {
        interaction_id: z.string().describe("The interaction ID from start_deep_research")
      },
      async ({ interaction_id }) => {
        try {
          const apiKey = this.getApiKey();
          const interaction = await getInteraction(apiKey, interaction_id);

          // Get stored task for elapsed time calculation
          const storedTask = await this.ctx.storage.get<ResearchTask>(`task:${interaction_id}`);
          const startedAt = storedTask?.started_at || new Date().toISOString();
          const elapsedSeconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);

          const status = interaction.status?.toLowerCase() || "unknown";

          if (status === "completed") {
            // Extract result text
            const outputs = interaction.outputs || [];
            const result = outputs.length > 0
              ? outputs[outputs.length - 1].text || JSON.stringify(outputs[outputs.length - 1])
              : "No output available";

            // Update stored task
            if (storedTask) {
              storedTask.status = "completed";
              storedTask.result = result;
              await this.ctx.storage.put(`task:${interaction_id}`, storedTask);
            }

            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  interaction_id,
                  status: "completed",
                  elapsed_seconds: elapsedSeconds,
                  result
                }, null, 2)
              }]
            };
          } else if (status === "failed") {
            const error = interaction.error || "Unknown error";

            // Update stored task
            if (storedTask) {
              storedTask.status = "failed";
              storedTask.error = error;
              await this.ctx.storage.put(`task:${interaction_id}`, storedTask);
            }

            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  interaction_id,
                  status: "failed",
                  elapsed_seconds: elapsedSeconds,
                  error
                }, null, 2)
              }],
              isError: true
            };
          } else {
            // Still in progress
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  interaction_id,
                  status: "in_progress",
                  elapsed_seconds: elapsedSeconds,
                  message: `Research is still running (${elapsedSeconds} seconds elapsed). Deep Research typically takes 5-15 minutes. Check again in a minute or two.`
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
      {},
      async () => {
        try {
          // Get all tasks from storage
          const allKeys = await this.ctx.storage.list({ prefix: "task:" });
          const tasks: Array<ResearchTask & { elapsed_seconds: number }> = [];

          for (const [_, value] of allKeys) {
            const task = value as ResearchTask;
            const elapsedSeconds = Math.floor((Date.now() - new Date(task.started_at).getTime()) / 1000);
            tasks.push({
              ...task,
              elapsed_seconds: elapsedSeconds,
              // Don't include full result in list view to keep response small
              result: task.result ? `[${task.result.length} characters - use check_deep_research to view]` : undefined
            });
          }

          // Sort by started_at descending (most recent first)
          tasks.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                task_count: tasks.length,
                tasks: tasks.map(t => ({
                  interaction_id: t.interaction_id,
                  query: t.query.length > 100 ? t.query.substring(0, 100) + "..." : t.query,
                  status: t.status,
                  started_at: t.started_at,
                  elapsed_seconds: t.elapsed_seconds
                }))
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
  }
}

// Type declarations
interface Env {
  MCP_OBJECT: DurableObjectNamespace;
  OAUTH_KV: KVNamespace;
}

// Get the base SSE handler from McpAgent
const baseHandler = DeepResearchMCP.serveSSE("/sse");

// Wrapper handler that receives props from OAuthProvider and passes them to the DO
const apiHandler = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
    props: AuthProps // OAuthProvider passes props as 4th argument
  ): Promise<Response> {
    // Attach props to context so serveSSE can pass them to the Durable Object
    (ctx as any).props = props;
    return baseHandler.fetch(request, env, ctx);
  }
};

// Export OAuthProvider as the default handler
export default new OAuthProvider({
  apiRoute: "/sse",
  apiHandler: apiHandler,
  defaultHandler: AuthHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
