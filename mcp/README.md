# DeepScrape MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes the
DeepScrape API as tools for AI agents (Claude Desktop, Claude Code, Cursor, etc.).

## Tools

| Tool | Description |
|---|---|
| `deepscrape_scrape` | Scrape a single URL → markdown (+ optional formats). |
| `deepscrape_map` | Discover URLs on a site (sitemaps/robots/crawl), incl. subdomains. |
| `deepscrape_crawl` | Start a multi-page crawl; returns a crawl id. |
| `deepscrape_crawl_status` | Poll a crawl's progress and results. |
| `deepscrape_search` | Web search (+ optional scrape of results). |
| `deepscrape_agent` | Start an autonomous agent toward a natural-language goal; returns a task id. |
| `deepscrape_agent_status` | Poll an agent run's progress and final answer. |
| `deepscrape_session_create` | Open a persistent interactive browser session; returns a session id. |
| `deepscrape_session_action` | Drive a session (navigate/click/type/scrape/evaluate/…). |
| `deepscrape_session_close` | Close a session and free its browser context. |
| `deepscrape_extract_auto` | Self-healing structured extraction — describe fields, no selectors; heals on breakage. |
| `deepscrape_discover_apis` | Find a page's hidden JSON/XHR/GraphQL endpoints so you can query the API directly. |

### Typical agent flows

- **Autonomous:** `deepscrape_agent` (with a `prompt`, optional `schema`) → poll `deepscrape_agent_status` until `completed`. Requires the DeepScrape server to have an LLM key configured.
- **Manual/interactive:** `deepscrape_session_create` → one or more `deepscrape_session_action` calls (e.g. `navigate`, `type`, `click`, then `scrape`) → `deepscrape_session_close`. Always close sessions when done — they count against the server's session limit.

## Build

```bash
cd mcp
npm install
npm run build
```

## Configure in an MCP client

Point it at a running DeepScrape API. Example (Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "deepscrape": {
      "command": "node",
      "args": ["/absolute/path/to/deepscraper/mcp/dist/server.js"],
      "env": {
        "DEEPSCRAPE_API_URL": "http://localhost:3000",
        "DEEPSCRAPE_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Environment

- `DEEPSCRAPE_API_URL` — base URL of the DeepScrape API (default `http://localhost:3000`).
- `DEEPSCRAPE_API_KEY` — sent as the `X-API-Key` header.
