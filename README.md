# jev-docs-mcp

An [MCP](https://modelcontextprotocol.io) server that lets AI coding agents (Cursor, Claude Code, Codex, and other MCP clients) search and read the official [TypeSafe Jev documentation](https://docs.typesafe.ai).

It loads the docs from `docs.typesafe.ai/llms.txt` and `docs.typesafe.ai/llms-full.txt` and caches them in memory for an hour. No API key is needed.

## Tools

| Tool | What it does |
| --- | --- |
| `jev_docs_list` | Lists every docs page with its path and a one-line summary. |
| `jev_docs_search` | Full-text search across all pages; returns the best matches with snippets. |
| `jev_docs_read` | Returns a full page by path (`primitives/noul`), URL, or title. Long pages are paginated with `offset`. |

## Setup

Requires Node.js 18 or newer.

```bash
git clone https://github.com/mohit716/jev-docs-mcp.git
cd jev-docs-mcp
npm install
```

### Cursor

Add this to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project), using the absolute path to `index.js`:

```json
{
  "mcpServers": {
    "jev-docs": {
      "command": "node",
      "args": ["/absolute/path/to/jev-docs-mcp/index.js"]
    }
  }
}
```

Then open **Cursor Settings → Tools & MCP** and make sure `jev-docs` is enabled.

### Claude Code

```bash
claude mcp add jev-docs -- node /absolute/path/to/jev-docs-mcp/index.js
```

## Testing

```bash
npm test
```

This starts the server, calls each tool against the live docs, and prints the results.

## Not affiliated with TypeSafe

This is an independent project. The documentation content belongs to TypeSafe AI.
