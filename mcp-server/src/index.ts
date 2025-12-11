import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

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

// Deep Research MCP Agent
export class DeepResearchMCP extends McpAgent {
  server = new McpServer({
    name: "deep-research-mcp",
    version: "1.0.0",
    description: "MCP server for Gemini Deep Research - autonomous research agent"
  });

  // API key stored in memory (loaded from storage in onRequest)
  apiKey: string = "";

  async init() {
    // Tool 1: Start a deep research task
    this.server.tool(
      "start_deep_research",
      {
        query: z.string().describe("The research topic or question to investigate"),
        previous_id: z.string().optional().describe("Optional: continue from a previous research interaction")
      },
      async ({ query, previous_id }) => {
        // Load API key from storage if not in memory
        if (!this.apiKey) {
          this.apiKey = await this.state.storage.get<string>("apiKey") || "";
        }

        if (!this.apiKey) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "API key not configured. Please include your Gemini API key in the URL path: /sse/{YOUR_API_KEY}"
              }, null, 2)
            }],
            isError: true
          };
        }

        try {
          const interaction = await createInteraction(this.apiKey, query, previous_id);

          // Extract interaction ID from response
          const interactionId = interaction.name?.split("/").pop() || interaction.id;

          // Store task in Durable Object state
          const task: ResearchTask = {
            interaction_id: interactionId,
            query: query,
            status: "in_progress",
            started_at: new Date().toISOString()
          };

          await this.state.storage.put(`task:${interactionId}`, task);

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
        // Load API key from storage if not in memory
        if (!this.apiKey) {
          this.apiKey = await this.state.storage.get<string>("apiKey") || "";
        }

        if (!this.apiKey) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "API key not configured"
              }, null, 2)
            }],
            isError: true
          };
        }

        try {
          const interaction = await getInteraction(this.apiKey, interaction_id);

          // Get stored task for elapsed time calculation
          const storedTask = await this.state.storage.get<ResearchTask>(`task:${interaction_id}`);
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
              await this.state.storage.put(`task:${interaction_id}`, storedTask);
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
              await this.state.storage.put(`task:${interaction_id}`, storedTask);
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
          const allKeys = await this.state.storage.list({ prefix: "task:" });
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

  // Override onRequest to extract API key from headers and store it
  async onRequest(request: Request): Promise<void> {
    const apiKey = request.headers.get("x-gemini-api-key");
    if (apiKey) {
      this.apiKey = apiKey;
      // Persist to storage so it survives DO hibernation
      await this.state.storage.put("apiKey", apiKey);
    } else {
      // Try to load from storage
      this.apiKey = await this.state.storage.get<string>("apiKey") || "";
    }
  }
}

// Worker fetch handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Root path - show info
    if (url.pathname === "/" || url.pathname === "") {
      return new Response(
        "Deep Research MCP Server\n\n" +
        "Connect with: /sse/{YOUR_GEMINI_API_KEY}\n\n" +
        "Tools available:\n" +
        "- start_deep_research: Start a new research task\n" +
        "- check_deep_research: Check status/get results\n" +
        "- list_research_tasks: List all your research tasks\n",
        {
          status: 200,
          headers: { "Content-Type": "text/plain" }
        }
      );
    }

    // Extract API key from path: /sse/{apiKey} or /sse/{apiKey}/message
    const sseMatch = url.pathname.match(/^\/sse\/([^\/]+)(\/message)?$/);

    if (sseMatch) {
      const apiKey = sseMatch[1];

      // Validate API key format (Gemini keys start with AIza)
      if (!apiKey.startsWith("AIza")) {
        return new Response(
          JSON.stringify({ error: "Invalid API key format. Gemini API keys start with 'AIza'" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      // Create a unique Durable Object ID based on API key hash
      // This gives each user their own isolated state
      const keyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(apiKey));
      const hashHex = Array.from(new Uint8Array(keyHash)).map(b => b.toString(16).padStart(2, "0")).join("");
      const doId = env.MCP_OBJECT.idFromName(hashHex);
      const stub = env.MCP_OBJECT.get(doId);

      // Determine the new path (remove API key from URL)
      const newPath = sseMatch[2] ? "/sse/message" : "/sse";
      const newUrl = new URL(request.url);
      newUrl.pathname = newPath;

      // Forward request to Durable Object with API key in header
      const modifiedRequest = new Request(newUrl.toString(), {
        method: request.method,
        headers: new Headers([...request.headers.entries(), ["x-gemini-api-key", apiKey]]),
        body: request.body,
        duplex: "half"
      } as RequestInit);

      return stub.fetch(modifiedRequest);
    }

    // Bare /sse paths are only valid when coming from DO stub (internal)
    // External requests should include API key
    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      // Check if this has an API key header (means it came from our handler above)
      const apiKey = request.headers.get("x-gemini-api-key");
      if (!apiKey) {
        return new Response(
          "Please include your Gemini API key in the URL: /sse/{YOUR_API_KEY}",
          { status: 400 }
        );
      }

      // This shouldn't happen in normal flow, but handle it
      return DeepResearchMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    return new Response("Not found. Use /sse/{YOUR_API_KEY} to connect.", { status: 404 });
  }
};

// Type declarations
interface Env {
  MCP_OBJECT: DurableObjectNamespace;
}
