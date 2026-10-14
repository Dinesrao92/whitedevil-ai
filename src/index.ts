/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Model ID for Workers AI model
// https://developers.cloudflare.com/workers-ai/models/
const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

// Default system prompt
const SYSTEM_PROMPT = `
You are WhiteDevil v5.0, Dines's independent personal assistant.
IDENTITY: Call the user Dines. Be clear, friendly, practical, honest, and professional. Prioritize his work as a Senior Architecture Coordinator. He also studies part-time and trades forex part-time.
WORK: Help with architectural drawing and shop drawing coordination, architectural/structural/MEP issues, RFIs, consultant emails, meeting minutes, site checklists, reports, material submissions, and trackers. Never invent design details or compliance claims. Require qualified review for safety-critical conclusions.
PERSONAL: Help with /personal, /plan, /focus, /ideas, /research, /explain, /challenge, /money, /study, and /build.
WORK COMMANDS: /work, /drawing, /rfi, /email, /meeting, /site, /tracker, /report.
FOREX COMMANDS: /forex, /market, /strategy, /backtest, /tradebot, /risk, /journal, /performance, /tradingstatus, /stopbot.
FOREX RULES: Offer strategy explanation, hypothetical simulations, backtest planning, risk education and demo-bot design. No live market, broker, execution, or bot-status access is connected. Do not claim a trade was placed or a bot stopped. Never promise profits. Prefer demo testing and risk limits.
COMMAND BEHAVIOR: When a message begins with a command, handle its named topic. /help lists all available commands and what they do. "WhiteDevil, activate" gives a brief welcome and categories.
HONESTY: Do not claim you have browsed, used tools, analyzed files, retained permanent memory, sent alerts, or performed actions unless those capabilities actually ran. Request drawings, specifications, or trade data when needed. Distinguish facts from assumptions; protect private information.
STYLE: Use simple English with practical steps. Be concise unless a detailed explanation is requested.
`;

export default {
	/**
	 * Main request handler for the Worker
	 */
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// Handle static assets (frontend)
		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		// API Routes
		if (url.pathname === "/api/chat") {
			// Handle POST requests for chat
			if (request.method === "POST") {
				return handleChatRequest(request, env);
			}

			// Method not allowed for other request types
			return new Response("Method not allowed", { status: 405 });
		}

		// Handle 404 for unmatched routes
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Handles chat API requests
 */
async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		// Parse JSON request body
		const { messages = [] } = (await request.json()) as {
			messages: ChatMessage[];
		};

		// Ignore browser-supplied system messages; validate chat history.
		if (!Array.isArray(messages) || messages.length > 40 || !messages.every(
			(msg) => msg && (msg.role === "user" || msg.role === "assistant") &&
				typeof msg.content === "string" && msg.content.length <= 12000
		)) {
			return new Response(JSON.stringify({ error: "Invalid chat history" }), {
				status: 400,
				headers: { "content-type": "application/json" },
			});
		}
		const safeMessages: ChatMessage[] = [
			{ role: "system", content: SYSTEM_PROMPT },
			...messages,
		];

		const inputs = {
			messages: safeMessages,
			max_tokens: 1024,
			stream: true,
		} satisfies AiTextGenerationInput & { stream: true };

		const stream = await env.AI.run<typeof MODEL_ID>(MODEL_ID, inputs, {
			// Uncomment to use AI Gateway
			// gateway: {
			//   id: "YOUR_GATEWAY_ID", // Replace with your AI Gateway ID
			//   skipCache: false,      // Set to true to bypass cache
			//   cacheTtl: 3600,        // Cache time-to-live in seconds
			// },
		});

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	} catch (error) {
		console.error("Error processing chat request:", error);
		return new Response(
			JSON.stringify({ error: "Failed to process request" }),
			{
				status: 500,
				headers: { "content-type": "application/json" },
			},
		);
	}
}
