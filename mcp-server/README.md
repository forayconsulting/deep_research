# Deep Research MCP Server

Remote MCP server for Gemini Deep Research, deployed on Cloudflare Workers.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Login to Cloudflare:
   ```bash
   npx wrangler login
   ```

3. Deploy:
   ```bash
   npm run deploy
   ```

## Connect to Claude

Add as a custom connector in Claude Desktop:

1. Go to **Settings → Connectors → Add custom connector**
2. Enter:
   - **Name**: Deep Research
   - **URL**: `https://deep-research-mcp.foray-consulting.workers.dev/sse`
3. Click **Add**, then **Connect**
4. A browser window opens - enter your Gemini API key
5. Click **Connect** in the form
6. Done! The connector shows "Connected"

Get your Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).

## Tools

### `start_deep_research`
Start a new research task. Returns an `interaction_id` for polling.

```
Query: "What are the latest developments in quantum computing?"
→ { interaction_id: "abc123", status: "in_progress" }
```

### `check_deep_research`
Check status and get results for a research task.

```
interaction_id: "abc123"
→ { status: "completed", result: "..." } or { status: "in_progress", elapsed_seconds: 120 }
```

### `list_research_tasks`
List all your research tasks (recent first).

## How It Works

1. Claude calls `start_deep_research` with your query
2. The server starts a Gemini Deep Research task (runs 5-15 minutes)
3. Claude polls with `check_deep_research` until complete
4. Results include a comprehensive report with citations

## Authentication

The server uses OAuth to securely collect and store your Gemini API key:

- Your API key is entered once during the OAuth flow
- It's encrypted and stored server-side
- Never exposed to the MCP client
- Each API key gets isolated storage (separate research history)

## Local Development

```bash
npm run dev
```

Then add `http://localhost:8787/sse` as a custom connector.
