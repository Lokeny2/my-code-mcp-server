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
