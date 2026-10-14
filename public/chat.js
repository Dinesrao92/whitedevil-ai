/**
 * WhiteDevil v5.0 dashboard
 * Client-side session chat only. No keys, persistence or third-party scripts.
 * AI responses are streamed from the existing /api/chat Workers AI endpoint.
 */
"use strict";

const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");
const chatForm = document.getElementById("chat-form");
const newChatButton = document.getElementById("new-chat");
const modeLabel = document.getElementById("mode-label");
const appShell = document.getElementById("app-shell");
const mobileMenu = document.getElementById("mobile-menu");
const sidebarClose = document.getElementById("sidebar-close");
const mobileOverlay = document.getElementById("mobile-overlay");
const toast = document.getElementById("toast");

const WELCOME = "Hello Dines! I'm WhiteDevil v5.0, ready to help with construction work, planning, learning, code or demo forex research. Choose a shortcut or ask me anything.";
const MAX_HISTORY = 38;
const MODES = {
  overview: "General assistant",
  work: "Work & construction",
  forex: "Forex research · demo",
  study: "Study & learning",
  build: "Build & coding",
  personal: "Personal assistant",
};

let chatHistory = [];
let isProcessing = false;
let toastTimeout;

function createMessage(role, content) {
  const wrapper = document.createElement("div");
  wrapper.className = "message " + (role === "user" ? "user-message" : "assistant-message");

  const avatar = document.createElement("span");
  avatar.className = "message-avatar " + (role === "user" ? "user-avatar" : "assistant-avatar");
  if (role === "user") {
    avatar.textContent = "D";
  } else {
    const graphic = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    graphic.setAttribute("class", "icon");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#ic-spark");
    graphic.appendChild(use);
    avatar.appendChild(graphic);
  }

  const body = document.createElement("div");
  body.className = "message-inner";
  const meta = document.createElement("span");
  meta.className = "message-meta";
  meta.textContent = role === "user" ? "YOU · DINES" : "WHITEDEVIL · AI ASSISTANT";
  const paragraph = document.createElement("p");
  // Always render user and model content as text, never raw HTML.
  paragraph.textContent = content;
  body.append(meta, paragraph);
  wrapper.append(avatar, body);
  chatMessages.appendChild(wrapper);
  scrollToBottom();
  return paragraph;
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setMode(mode) {
  const selected = Object.prototype.hasOwnProperty.call(MODES, mode) ? mode : "overview";
  modeLabel.textContent = MODES[selected];
  for (const button of document.querySelectorAll(".nav-item")) {
    const active = button.dataset.mode === selected;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}

function inferMode(message) {
  const command = message.trim().split(/\s+/)[0].toLowerCase();
  if (["/work", "/drawing", "/rfi", "/email", "/meeting", "/site", "/tracker", "/report"].includes(command)) return "work";
  if (["/forex", "/market", "/strategy", "/backtest", "/tradebot", "/risk", "/journal", "/performance", "/tradingstatus", "/stopbot"].includes(command)) return "forex";
  if (command === "/study" || command === "/explain") return "study";
  if (command === "/build") return "build";
  if (["/personal", "/plan", "/focus", "/ideas", "/research", "/challenge", "/money"].includes(command)) return "personal";
  if (command === "/help") return "overview";
  return null;
}

function updateTextareaHeight() {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 170) + "px";
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 3000);
}

function setBusy(busy) {
  isProcessing = busy;
  userInput.disabled = busy;
  sendButton.disabled = busy;
  newChatButton.disabled = busy;
  typingIndicator.classList.toggle("visible", busy);
  chatMessages.setAttribute("aria-busy", String(busy));
}

function closeNavigation() {
  appShell.classList.remove("sidebar-open");
  mobileMenu.setAttribute("aria-expanded", "false");
}

function parseEvents(buffer) {
  const normalized = buffer.replace(/\r/g, "");
  const parts = normalized.split("\n\n");
  const remainder = parts.pop() || "";
  const events = [];
  for (const raw of parts) {
    const data = raw.split("\n")
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart())
      .join("\n");
    if (data) events.push(data);
  }
  return { events, remainder };
}

function readTextChunk(data) {
  try {
    const parsed = JSON.parse(data);
    if (typeof parsed.response === "string") return parsed.response;
    const choice = parsed.choices?.[0]?.delta?.content;
    return typeof choice === "string" ? choice : "";
  } catch (error) {
    console.warn("Could not parse streamed response event", error);
    return "";
  }
}

async function sendMessage(raw) {
  if (isProcessing) return;
  const message = (typeof raw === "string" ? raw : userInput.value).trim();
  if (!message) return;
  if (message.length > 12000) {
    showToast("Please shorten your message to 12,000 characters.");
    return;
  }

  const detected = inferMode(message);
  if (detected) setMode(detected);
  createMessage("user", message);
  userInput.value = "";
  updateTextareaHeight();
  chatHistory.push({ role: "user", content: message });
  // Keep the oldest messages out of the request. The on-screen transcript remains.
  if (chatHistory.length > MAX_HISTORY) chatHistory = chatHistory.slice(-MAX_HISTORY);

  setBusy(true);
  let responseText = "";
  let assistantText = null;
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chatHistory }),
    });
    if (!response.ok) {
      throw new Error(response.status === 400 ? "Your message could not be processed." : "AI service unavailable (" + response.status + ").");
    }
    if (!response.body) throw new Error("No response stream returned.");

    assistantText = createMessage("assistant", "");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completed = false;
    const appendData = (data) => {
      if (data === "[DONE]") {
        completed = true;
        return;
      }
      const chunk = readTextChunk(data);
      if (chunk) {
        responseText += chunk;
        assistantText.textContent = responseText;
        scrollToBottom();
      }
    };
    while (!completed) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        const parsed = parseEvents(buffer + "\n\n");
        for (const data of parsed.events) appendData(data);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseEvents(buffer);
      buffer = parsed.remainder;
      for (const data of parsed.events) {
        appendData(data);
        if (completed) break;
      }
    }
    if (responseText.trim()) {
      chatHistory.push({ role: "assistant", content: responseText });
    } else {
      assistantText.textContent = "I couldn't generate a response this time. Please try again.";
    }
  } catch (error) {
    console.error("WhiteDevil chat request failed:", error);
    const message = "Sorry, the AI request didn't complete. Please try again in a moment.";
    if (assistantText) assistantText.textContent = message;
    else createMessage("assistant", message);
    showToast(error instanceof Error ? error.message : "Connection error.");
    // Discard a failed user submission from conversation context.
    if (chatHistory.length && chatHistory[chatHistory.length - 1].role === "user") chatHistory.pop();
  } finally {
    setBusy(false);
    userInput.focus();
    scrollToBottom();
  }
}

function resetChat() {
  if (isProcessing) return;
  chatHistory = [];
  chatMessages.replaceChildren();
  createMessage("assistant", WELCOME);
  setMode("overview");
  userInput.value = "";
  updateTextareaHeight();
  showToast("New conversation started. Previous messages were cleared.");
  userInput.focus();
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMessage();
});
userInput.addEventListener("input", updateTextareaHeight);
userInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void sendMessage();
  }
});
newChatButton.addEventListener("click", resetChat);

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-prompt], [data-command]");
  if (!action || !action.matches("button")) return;
  if (isProcessing) {
    showToast("Wait for the current reply to finish.");
    return;
  }
  const command = action.dataset.prompt || action.dataset.command;
  if (action.dataset.mode) setMode(action.dataset.mode);
  closeNavigation();
  void sendMessage(command);
});

mobileMenu.addEventListener("click", () => {
  const open = !appShell.classList.contains("sidebar-open");
  appShell.classList.toggle("sidebar-open", open);
  mobileMenu.setAttribute("aria-expanded", String(open));
});
sidebarClose.addEventListener("click", closeNavigation);
mobileOverlay.addEventListener("click", closeNavigation);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeNavigation();
});
