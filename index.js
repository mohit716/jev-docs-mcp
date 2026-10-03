#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DOCS_ORIGIN = "https://docs.typesafe.ai";
const INDEX_URL = `${DOCS_ORIGIN}/llms.txt`;
const FULL_URL = `${DOCS_ORIGIN}/llms-full.txt`;
const CACHE_TTL_MS = 60 * 60 * 1000;

let cache = null;

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "jev-docs-mcp" } });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  return res.text();
}

function normalizePath(input) {
  return input
    .trim()
    .replace(/^https?:\/\/docs\.typesafe\.ai/i, "")
    .replace(/[?#].*$/, "")
    .replace(/\.md$/i, "")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}

function parseIndex(text) {
  const entries = [];
  const re = /^- \[([^\]]+)\]\((\S+?)\)(?::\s*(.*))?$/gm;
  for (const m of text.matchAll(re)) {
    entries.push({ title: m[1], url: m[2], path: normalizePath(m[2]), description: m[3] ?? "" });
  }
  return entries;
}

function parseFull(text) {
  const pages = [];
  const re = /^# (.+)\r?\nSource: (\S+)\s*$/gm;
  const heads = [...text.matchAll(re)];
  heads.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    pages.push({
      title: m[1].trim(),
      url: m[2],
      path: normalizePath(m[2]),
      body: text.slice(start, end).trim(),
    });
  });
  return pages;
}

async function loadDocs() {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;
  const [indexText, fullText] = await Promise.all([fetchText(INDEX_URL), fetchText(FULL_URL)]);
  const index = parseIndex(indexText);
  const pages = parseFull(fullText);
  const descriptions = new Map(index.map((e) => [e.path, e.description]));
  for (const p of pages) p.description = descriptions.get(p.path) ?? "";
  cache = { index, pages, loadedAt: Date.now() };
  return cache;
}

function countOccurrences(haystack, needle) {
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) count++;
  return count;
}

function makeSnippet(body, terms, radius = 160) {
  const lower = body.toLowerCase();
  let pos = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (pos === -1 || i < pos)) pos = i;
  }
  if (pos === -1) return body.slice(0, radius * 2).replace(/\s+/g, " ").trim();
  const start = Math.max(0, pos - radius);
  const end = Math.min(body.length, pos + radius);
  return `${start > 0 ? "…" : ""}${body.slice(start, end).replace(/\s+/g, " ").trim()}${end < body.length ? "…" : ""}`;
}

function searchPages(pages, query, limit) {
  const phrase = query.toLowerCase().trim();
  const terms = [...new Set(phrase.split(/[^a-z0-9_.-]+/).filter((t) => t.length > 1))];
  if (terms.length === 0) return [];

  return pages
    .map((page) => {
      const title = page.title.toLowerCase();
      const body = page.body.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += 10;
        if (page.path.includes(t)) score += 5;
        if (page.description.toLowerCase().includes(t)) score += 3;
        score += Math.min(countOccurrences(body, t), 20);
      }
      if (terms.length > 1 && body.includes(phrase)) score += 15;
      const matched = terms.filter((t) => title.includes(t) || body.includes(t)).length;
      score *= matched / terms.length;
      return { page, score, terms };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function findPage(pages, ref) {
  const path = normalizePath(ref);
  return (
    pages.find((p) => p.path === path) ??
    pages.find((p) => p.title.toLowerCase() === ref.trim().toLowerCase()) ??
    null
  );
}

const text = (s) => ({ content: [{ type: "text", text: s }] });
const fail = (s) => ({ content: [{ type: "text", text: s }], isError: true });

const server = new McpServer({ name: "jev-docs", version: "1.0.0" });

server.registerTool(
  "jev_docs_list",
  {
    title: "List Jev docs pages",
    description:
      "List every page in the official TypeSafe/Jev documentation (docs.typesafe.ai) with its path and one-line summary. Use this to discover what exists before reading.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      const { index } = await loadDocs();
      const lines = index.map((e) => `- ${e.title} (${e.path})${e.description ? `: ${e.description}` : ""}`);
      return text(`${index.length} pages in the Jev documentation:\n\n${lines.join("\n")}`);
    } catch (err) {
      return fail(`Could not load the Jev docs index: ${err.message}`);
    }
  }
);

server.registerTool(
  "jev_docs_search",
  {
    title: "Search Jev docs",
    description:
      "Full-text search across the official TypeSafe/Jev documentation. Returns the best-matching pages with paths and snippets; pass a path to jev_docs_read for the full page.",
    inputSchema: {
      query: z.string().min(1).describe("Search terms, e.g. 'noul confidence threshold' or 'python sdk async'"),
      limit: z.number().int().min(1).max(20).default(5).describe("Maximum number of results"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ query, limit }) => {
    try {
      const { pages } = await loadDocs();
      const results = searchPages(pages, query, limit);
      if (results.length === 0) return text(`No Jev docs pages matched "${query}". Try jev_docs_list.`);
      const out = results.map(
        ({ page, terms }, i) =>
          `${i + 1}. ${page.title}\n   path: ${page.path}\n   url: ${page.url}\n   ${makeSnippet(page.body, terms)}`
      );
      return text(out.join("\n\n"));
    } catch (err) {
      return fail(`Search failed: ${err.message}`);
    }
  }
);

server.registerTool(
  "jev_docs_read",
  {
    title: "Read a Jev docs page",
    description:
      "Read the full Markdown of one Jev documentation page. Accepts a path (e.g. 'primitives/noul'), a docs.typesafe.ai URL, or an exact page title. Long pages are paginated with offset.",
    inputSchema: {
      page: z.string().min(1).describe("Page path, URL, or title"),
      offset: z.number().int().min(0).default(0).describe("Character offset to start from, for long pages"),
      max_chars: z.number().int().min(1000).max(100000).default(30000).describe("Maximum characters to return"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ page, offset, max_chars }) => {
    try {
      const { pages } = await loadDocs();
      const found = findPage(pages, page);
      if (!found) {
        const suggestions = searchPages(pages, page.replace(/[\/_-]+/g, " "), 5)
          .map(({ page: p }) => `- ${p.title} (${p.path})`)
          .join("\n");
        return fail(`No Jev docs page found for "${page}".${suggestions ? `\n\nDid you mean:\n${suggestions}` : ""}`);
      }
      const chunk = found.body.slice(offset, offset + max_chars);
      const next = offset + chunk.length;
      const footer =
        next < found.body.length
          ? `\n\n[Showing characters ${offset}-${next} of ${found.body.length}. Call again with offset=${next} for more.]`
          : "";
      return text(`# ${found.title}\nSource: ${found.url}\n\n${chunk}${footer}`);
    } catch (err) {
      return fail(`Could not read the page: ${err.message}`);
    }
  }
);

await server.connect(new StdioServerTransport());
