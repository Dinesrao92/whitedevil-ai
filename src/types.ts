/** WhiteDevil v5.1 Cloudflare Worker environment. */
export interface Env {
  AI: Ai;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  DB: D1Database;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  MEMORY_OWNER_EMAIL: string;
}
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
