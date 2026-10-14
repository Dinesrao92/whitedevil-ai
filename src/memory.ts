import type { Env, ChatMessage } from "./types";

/**
 * Signed Cloudflare Access JWTs are checked inside the Worker, not just by the
 * Cloudflare edge. Never trust an unverified CF-Access-Authenticated-User-Email
 * header, a body owner ID, or a browser cookie as identity.
 */
type AccessClaims = { sub: string; email: string };
type MemoryMessage = { role: "user" | "assistant"; content: string };
type Conversation = {
  id: string;
  owner_sub: string;
  title: string;
  messages_json: string;
  created_at: string;
  updated_at: string;
};

const MAX_CHATS = 60;
const MAX_MESSAGES = 80;
const MAX_MESSAGE_CHARS = 12000;
const MAX_REPLY_CHARS = 22000;
const SECURITY_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: SECURITY_HEADERS });
}

function decodeB64Url(raw: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error("Invalid JWT encoding");
  const chars = atob(raw.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(raw.length / 4) * 4, "="));
  return Uint8Array.from(chars, ch => ch.charCodeAt(0));
}

function decodeJson(raw: string): Record<string, unknown> {
  const decoded = new TextDecoder().decode(decodeB64Url(raw));
  const value: unknown = JSON.parse(decoded);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JWT object");
  return value as Record<string, unknown>;
}

let cachedKeys: { until: number; keys: JsonWebKey[] } | undefined;

async function getKeys(teamDomain: string): Promise<JsonWebKey[]> {
  if (cachedKeys && cachedKeys.until > Date.now()) return cachedKeys.keys;
  const url = teamDomain + "/cdn-cgi/access/certs";
  const res = await fetch(url, { headers: { accept: "application/json" }, redirect: "error" });
  if (!res.ok) throw new Error("Could not retrieve Cloudflare Access signing keys");
  const data = await res.json() as { keys?: JsonWebKey[] };
  if (!Array.isArray(data.keys) || data.keys.length === 0) throw new Error("Missing Cloudflare signing keys");
  cachedKeys = { keys: data.keys, until: Date.now() + 5 * 60 * 1000 };
  return data.keys;
}

async function verifyAccess(request: Request, env: Env): Promise<AccessClaims | null> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.MEMORY_OWNER_EMAIL) return null;
  const expectedIssuer = env.ACCESS_TEAM_DOMAIN.replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(expectedIssuer)) return null;
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || token.length > 12000) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = decodeJson(parts[0]);
    const payload = decodeJson(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
    if (payload.iss !== expectedIssuer || typeof payload.sub !== "string" || !payload.sub) return null;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(env.ACCESS_AUD)) return null;
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp <= now) return null;
    if (typeof payload.iat !== "number" || payload.iat > now + 60) return null;
    if (typeof payload.nbf === "number" && payload.nbf > now + 60) return null;
    if (typeof payload.email !== "string" || payload.email.toLowerCase() !== env.MEMORY_OWNER_EMAIL.toLowerCase()) return null;
    const keys = await getKeys(expectedIssuer);
    const jwk = keys.find(key => { const signingKey = key as JsonWebKey & { kid?: string; alg?: string }; return signingKey.kid === header.kid && signingKey.kty === "RSA" && (!signingKey.alg || signingKey.alg === "RS256"); });
    if (!jwk) return null;
    const publicKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signed = new TextEncoder().encode(parts[0] + "." + parts[1]);
    const signature = decodeB64Url(parts[2]);
    if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, signed))) return null;
    return { sub: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

function isMessages(value: unknown): value is MemoryMessage[] {
  return Array.isArray(value) && value.length <= MAX_MESSAGES && value.every(m =>
    m && typeof m === "object" &&
    (m.role === "user" || m.role === "assistant") &&
    typeof m.content === "string" &&
    m.content.length > 0 &&
    m.content.length <= (m.role === "user" ? MAX_MESSAGE_CHARS : MAX_REPLY_CHARS)
  );
}

function isUuid(id: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id);
}

function safeConversation(c: Conversation) {
  return { id: c.id, title: c.title, messages: JSON.parse(c.messages_json) as ChatMessage[], createdAt: c.created_at, updatedAt: c.updated_at };
}

async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  if (Number(request.headers.get("content-length") || 0) > 1_000_000) return null;
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function handleHistory(request: Request, env: Env, pathname: string): Promise<Response> {
  const person = await verifyAccess(request, env);
  if (!person) return response({ error: "Cloudflare Access authentication required for saved history." }, 401);
  if (!env.DB) return response({ error: "Conversation database is not configured." }, 503);

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length > 3 || segments[0] !== "api" || segments[1] !== "history") return response({ error: "Not found" }, 404);
  const id = segments[2];
  if (id && !isUuid(id)) return response({ error: "Invalid conversation ID" }, 400);

  try {
    if (request.method === "GET" && !id) {
      const data = await env.DB.prepare(
        "SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM conversations WHERE owner_sub = ? ORDER BY updated_at DESC LIMIT ?"
      ).bind(person.sub, MAX_CHATS).all();
      return response({ conversations: data.results });
    }
    if (request.method === "GET" && id) {
      const entry = await env.DB.prepare("SELECT * FROM conversations WHERE id = ? AND owner_sub = ?").bind(id, person.sub).first<Conversation>();
      return entry ? response({ conversation: safeConversation(entry) }) : response({ error: "Not found" }, 404);
    }
    if (request.method === "POST" && !id) {
      const body = await parseBody(request);
      if (!body || typeof body.title !== "string" || !body.title.trim() || body.title.length > 100) return response({ error: "Invalid title" }, 400);
      const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM conversations WHERE owner_sub = ?").bind(person.sub).first<{ total: number }>();
      if ((count?.total || 0) >= MAX_CHATS) return response({ error: "60-conversation limit reached. Delete an older conversation first." }, 409);
      const newId = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO conversations (id, owner_sub, title) VALUES (?, ?, ?)").bind(newId, person.sub, body.title.trim()).run();
      return response({ id: newId }, 201);
    }
    if (request.method === "PUT" && id) {
      const body = await parseBody(request);
      if (!body || !isMessages(body.messages) || JSON.stringify(body.messages).length > 500_000) return response({ error: "Invalid or oversized history" }, 400);
      const title = body.title;
      if (title !== undefined && (typeof title !== "string" || !title.trim() || title.length > 100)) return response({ error: "Invalid title" }, 400);
      const result = await env.DB.prepare(
        "UPDATE conversations SET messages_json = ?, title = COALESCE(?, title), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND owner_sub = ?"
      ).bind(JSON.stringify(body.messages), title ? String(title).trim() : null, id, person.sub).run();
      return result.meta.changes ? response({ saved: true }) : response({ error: "Not found" }, 404);
    }
    if (request.method === "DELETE" && id) {
      const result = await env.DB.prepare("DELETE FROM conversations WHERE id = ? AND owner_sub = ?").bind(id, person.sub).run();
      return result.meta.changes ? response({ deleted: true }) : response({ error: "Not found" }, 404);
    }
    return response({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("Memory store unavailable", err instanceof Error ? err.message : "unknown");
    return response({ error: "Memory is temporarily unavailable." }, 503);
  }
}
