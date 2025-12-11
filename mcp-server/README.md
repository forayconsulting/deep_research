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

Add as a custom connector in Claude Desktop or Claude Code:

- **Name**: Deep Research
- **URL**: `https://deep-research-mcp.{YOUR_ACCOUNT}.workers.dev/sse/{YOUR_GEMINI_API_KEY}`

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

## Local Development

```bash
npm run dev
```

Then connect to `http://localhost:8787/sse/{YOUR_API_KEY}`
