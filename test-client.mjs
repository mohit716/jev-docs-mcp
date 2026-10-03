import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "test", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["index.js"] }));

const { tools } = await client.listTools();
console.log("TOOLS:", tools.map((t) => t.name).join(", "));

const show = (label, r) => console.log(`\n=== ${label} (isError=${!!r.isError}) ===\n${r.content[0].text.slice(0, 900)}`);

show("list", await client.callTool({ name: "jev_docs_list", arguments: {} }));
show("search", await client.callTool({ name: "jev_docs_search", arguments: { query: "confidence threshold", limit: 3 } }));
show("read path", await client.callTool({ name: "jev_docs_read", arguments: { page: "primitives/noul", max_chars: 1000 } }));
show("read url", await client.callTool({ name: "jev_docs_read", arguments: { page: "https://docs.typesafe.ai/api.md", max_chars: 1000 } }));
show("read missing", await client.callTool({ name: "jev_docs_read", arguments: { page: "python-sdk" } }));

await client.close();
