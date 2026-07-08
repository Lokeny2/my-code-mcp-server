import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

// 👇 Change these two to match your actual repo
const GITHUB_OWNER = "Lokeny2";
const GITHUB_REPO = "tansales";
const GITHUB_BRANCH = "main"; // or "master", whatever your default branch is called

// A small helper that talks to GitHub's API on your tools' behalf
async function githubFetch(path: string, token?: string) {
  const headers: Record<string, string> = {
    "User-Agent": "my-code-mcp-server",
    Accept: "application/vnd.github+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}${path}`,
    { headers },
  );

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// Turns a plain text string into the base64 format GitHub's API requires,
// correctly handling non-English characters (accents, emoji, etc.)
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

export class MyMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "My Project Explorer",
    version: "1.0.0",
  });

  async init() {
    // Tool 1: "what's in this folder?"
    this.server.registerTool(
      "list_files",
      {
        inputSchema: {
          path: z
            .string()
            .optional()
            .describe(
              "Folder path inside the repo, e.g. 'src'. Leave empty for the root.",
            ),
        },
      },
      async ({ path }) => {
        const token = (this.env as any).GITHUB_TOKEN as string | undefined;
        const data: any = await githubFetch(
          `/contents/${path ?? ""}?ref=${GITHUB_BRANCH}`,
          token,
        );
        const list = Array.isArray(data)
          ? data
              .map((f: any) => `${f.type === "dir" ? "📁" : "📄"} ${f.path}`)
              .join("\n")
          : "That path points to a file, not a folder — try read_file instead.";
        return { content: [{ type: "text", text: list }] };
      },
    );

    // Tool 2: "give me the contents of this exact file"
    this.server.registerTool(
      "read_file",
      {
        inputSchema: {
          path: z
            .string()
            .describe("Full file path inside the repo, e.g. 'src/index.ts'"),
        },
      },
      async ({ path }) => {
        const token = (this.env as any).GITHUB_TOKEN as string | undefined;
        const data: any = await githubFetch(
          `/contents/${path}?ref=${GITHUB_BRANCH}`,
          token,
        );
        // GitHub returns file contents as base64 — decode it back to plain text
        const content = atob(data.content.replace(/\n/g, ""));
        return { content: [{ type: "text", text: content }] };
      },
    );

    // Tool 3: "replace this file's contents with new content"
this.server.registerTool(
  "write_file",
  {
    inputSchema: {
      path: z
        .string()
        .describe("Full file path inside the repo, e.g. 'convex/auth.ts'"),
      content: z
        .string()
        .describe("The complete new content the file should contain"),
      message: z
        .string()
        .optional()
        .describe("A short commit message describing the change"),
    },
  },
  async ({ path, content, message }) => {
    const token = (this.env as any).GITHUB_TOKEN as string | undefined;

    if (!token) {
      return {
        content: [
          {
            type: "text",
            text: "Error: no GITHUB_TOKEN configured. Writing requires an authenticated token, even for public repos.",
          },
        ],
      };
    }

    // Check whether the file already exists, so we can include its
    // current version stamp (GitHub calls this the file's "sha").
    let sha: string | undefined;
    try {
      const existing: any = await githubFetch(
        `/contents/${path}?ref=${GITHUB_BRANCH}`,
        token,
      );
      sha = existing.sha;
    } catch {
      // No existing file — that's fine, we'll create a new one.
    }

    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`,
      {
        method: "PUT",
        headers: {
          "User-Agent": "my-code-mcp-server",
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: message || `Update ${path} via Claude`,
          content: utf8ToBase64(content),
          branch: GITHUB_BRANCH,
          ...(sha ? { sha } : {}),
        }),
      },
    );

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`GitHub write failed: ${res.status} ${errorText}`);
    }

    return {
      content: [
        { type: "text", text: `Successfully wrote to ${path} on branch ${GITHUB_BRANCH}.` },
      ],
    };
  },
);
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      return MyMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};
