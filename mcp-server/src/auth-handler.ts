import { Hono } from "hono";
import { html } from "hono/html";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";

// Env includes OAUTH_PROVIDER injected by OAuthProvider wrapper
type Env = {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
};

const app = new Hono<{ Bindings: Env }>();

// GET /authorize - Display the API key input form
app.get("/authorize", async (c) => {
  try {
    // Parse the OAuth authorization request from query params
    // OAuth helpers are injected into env by OAuthProvider
    const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);

    if (!oauthReqInfo.clientId) {
      return c.text("Invalid OAuth request: missing client_id", 400);
    }

    // Look up client metadata for display
    let clientName = "Claude";
    try {
      const clientInfo = await c.env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
      clientName = clientInfo?.clientName || "Claude";
    } catch {
      // Client lookup may fail for dynamic registrations
    }

    // Store OAuth request info in KV for retrieval on POST
    const stateKey = crypto.randomUUID();
    await c.env.OAUTH_KV.put(
      `auth_state:${stateKey}`,
      JSON.stringify(oauthReqInfo),
      { expirationTtl: 600 } // 10 minute expiry
    );

    // Render the API key input form
    return c.html(html`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Connect Deep Research</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            * { box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              margin: 0;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .card {
              background: white;
              border-radius: 16px;
              box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
              padding: 40px;
              max-width: 420px;
              width: 100%;
            }
            .header {
              text-align: center;
              margin-bottom: 32px;
            }
            .header h1 {
              font-size: 24px;
              color: #1a1a1a;
              margin: 0 0 8px 0;
            }
            .header p {
              color: #666;
              margin: 0;
              font-size: 14px;
            }
            .client-badge {
              display: inline-block;
              background: #f0f0f0;
              padding: 4px 12px;
              border-radius: 20px;
              font-size: 12px;
              color: #666;
              margin-top: 12px;
            }
            form {
              display: flex;
              flex-direction: column;
              gap: 20px;
            }
            .field label {
              display: block;
              font-weight: 500;
              color: #333;
              margin-bottom: 8px;
              font-size: 14px;
            }
            .field input {
              width: 100%;
              padding: 14px 16px;
              border: 2px solid #e0e0e0;
              border-radius: 10px;
              font-size: 15px;
              transition: border-color 0.2s, box-shadow 0.2s;
            }
            .field input:focus {
              outline: none;
              border-color: #667eea;
              box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
            }
            .field .hint {
              font-size: 12px;
              color: #888;
              margin-top: 6px;
            }
            .field .hint a {
              color: #667eea;
            }
            button {
              padding: 14px 24px;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              border: none;
              border-radius: 10px;
              font-size: 16px;
              font-weight: 600;
              cursor: pointer;
              transition: transform 0.2s, box-shadow 0.2s;
            }
            button:hover {
              transform: translateY(-1px);
              box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
            }
            button:active {
              transform: translateY(0);
            }
            .info {
              background: #f8f9ff;
              border-radius: 10px;
              padding: 16px;
              font-size: 13px;
              color: #555;
              line-height: 1.5;
            }
            .info strong {
              color: #333;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <h1>Connect Deep Research</h1>
              <p>Enter your Gemini API key to enable research tools</p>
              <div class="client-badge">Connecting to ${clientName}</div>
            </div>

            <form method="POST" action="/authorize">
              <input type="hidden" name="state_key" value="${stateKey}" />

              <div class="field">
                <label for="api_key">Gemini API Key</label>
                <input
                  type="password"
                  id="api_key"
                  name="api_key"
                  placeholder="AIzaSy..."
                  required
                  autocomplete="off"
                />
                <div class="hint">
                  Get your key from <a href="https://aistudio.google.com/apikey" target="_blank">Google AI Studio</a>
                </div>
              </div>

              <button type="submit">Connect</button>
            </form>

            <div class="info" style="margin-top: 24px;">
              <strong>What this does:</strong> Your API key will be securely stored and used
              to run Gemini Deep Research tasks on your behalf. The key is encrypted and
              never shared with the MCP client.
            </div>
          </div>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error("Auth error:", error);
    return c.text(`Authorization error: ${error.message}`, 400);
  }
});

// POST /authorize - Process the form and complete authorization
app.post("/authorize", async (c) => {
  try {
    // Parse form data
    const formData = await c.req.parseBody();
    const stateKey = formData["state_key"] as string;
    const apiKey = formData["api_key"] as string;

    if (!stateKey || !apiKey) {
      return c.text("Missing required fields", 400);
    }

    // Validate API key format
    if (!apiKey.startsWith("AIza")) {
      return c.html(html`
        <!DOCTYPE html>
        <html>
          <head><title>Invalid API Key</title></head>
          <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h2>Invalid API Key</h2>
            <p>Gemini API keys must start with "AIza"</p>
            <a href="javascript:history.back()">Go back and try again</a>
          </body>
        </html>
      `, 400);
    }

    // Retrieve the stored OAuth request info
    const storedState = await c.env.OAUTH_KV.get(`auth_state:${stateKey}`);
    if (!storedState) {
      return c.text("Authorization session expired. Please try again.", 400);
    }

    const oauthReqInfo: AuthRequest = JSON.parse(storedState);

    // Delete the state key (one-time use)
    await c.env.OAUTH_KV.delete(`auth_state:${stateKey}`);

    // Generate a unique user ID based on the API key hash
    const keyHash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(apiKey)
    );
    const userId = Array.from(new Uint8Array(keyHash))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("")
      .substring(0, 32);

    // Complete the OAuth authorization
    // The apiKey in props is encrypted and NEVER exposed to the MCP client
    const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReqInfo,
      userId: userId,
      metadata: {
        label: "Gemini Deep Research",
        createdAt: new Date().toISOString(),
      },
      scope: oauthReqInfo.scope,
      props: {
        apiKey: apiKey,
        userId: userId,
      },
    });

    // Redirect the user back to the client with the authorization code
    return c.redirect(redirectTo, 302);
  } catch (error: any) {
    console.error("Authorization completion error:", error);
    return c.text(`Authorization failed: ${error.message}`, 500);
  }
});

// Root handler - info page
app.get("/", async (c) => {
  return c.text(
    "Deep Research MCP Server\n\n" +
    "Connect via: /sse\n\n" +
    "Tools available:\n" +
    "- start_deep_research: Start a new research task\n" +
    "- check_deep_research: Check status/get results\n" +
    "- list_research_tasks: List all your research tasks\n"
  );
});

export default app;
