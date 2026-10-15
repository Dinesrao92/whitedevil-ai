/**
 * WhiteDevil v5.1 dashboard
 * History is saved only after a complete AI response and verified by the Worker.
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
const historyList = document.getElementById("history-list");
const memoryStatus = document.getElementById("memory-status");
const refreshHistoryButton = document.getElementById("refresh-history");
let conversationId = null;
let memoryEnabled = false;
let saveFailed = false;
let historyLoading = false;
let savedConversations = [];


const WELCOME = "Hello Dines! I'm WhiteDevil v5.1, ready to help with construction work, planning, learning, code or demo forex research. Choose a shortcut or ask me anything.";
const MAX_REQUEST_MESSAGES = 38;
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

function setBusy(busy, responding = busy) {
  isProcessing = busy;
  userInput.disabled = busy;
  sendButton.disabled = busy;
  newChatButton.disabled = busy;
  refreshHistoryButton.disabled = busy;
  typingIndicator.classList.toggle("visible", responding);
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


/** Cloudflare Access JWT is verified by the backend; never supply an owner ID. */
async function historyRequest(path, options = {}) {
  const response = await fetch("/api/history" + path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    cache: "no-store",
    credentials: "same-origin",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || ("History service error (" + response.status + ")"));
  return body;
}

function updateMemoryStatus(message) {
  memoryStatus.textContent = message;
}

function drawHistoryList() {
  historyList.replaceChildren();
  if (!memoryEnabled) {
    const hint = document.createElement("p");
    hint.className = "history-empty";
    hint.textContent = "Saved history unavailable. Chat still works.";
    historyList.appendChild(hint);
    return;
  }
  if (!savedConversations.length) {
    const hint = document.createElement("p");
    hint.className = "history-empty";
    hint.textContent = "No saved conversations yet.";
    historyList.appendChild(hint);
    return;
  }
  for (const item of savedConversations) {
    const entry = document.createElement("div");
    entry.className = "history-entry";
    const load = document.createElement("button");
    load.type = "button";
    load.className = "history-load" + (conversationId === item.id ? " selected" : "");
    load.textContent = item.title;
    load.title = item.title;
    if (conversationId === item.id) load.setAttribute("aria-current", "true");
    load.addEventListener("click", () => { void openSavedConversation(item.id); });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "history-delete";
    remove.textContent = "×";
    remove.title = "Delete this saved conversation";
    remove.setAttribute("aria-label", "Delete saved conversation: " + item.title);
    remove.addEventListener("click", () => { void deleteSavedConversation(item.id, item.title); });
    entry.append(load, remove);
    historyList.appendChild(entry);
  }
}

async function refreshHistory() {
  if (historyLoading) return;
  historyLoading = true;
  try {
    const result = await historyRequest("");
    savedConversations = result.conversations || [];
    memoryEnabled = true;
    if (!saveFailed) updateMemoryStatus("Saved securely in Cloudflare D1");
  } catch (error) {
    memoryEnabled = false;
    if (!saveFailed) updateMemoryStatus("Session-only · Memory unavailable");
    console.warn("History unavailable:", error);
  } finally {
    historyLoading = false;
    drawHistoryList();
  }
}

async function openSavedConversation(id) {
  if (isProcessing) return showToast("Wait for the current operation first.");
  // Lock transcript mutations until the requested conversation has loaded.
  setBusy(true, false);
  try {
    const { conversation } = await historyRequest("/" + encodeURIComponent(id));
    if (!conversation || !Array.isArray(conversation.messages)) throw new Error("Invalid history data");
    conversationId = conversation.id;
    saveFailed = false;
    chatMessages.replaceChildren();
    chatHistory = conversation.messages.filter(item =>
      (item.role === "user" || item.role === "assistant") && typeof item.content === "string"
    );
    if (!chatHistory.length) createMessage("assistant", WELCOME);
    for (const msg of conversation.messages) {
      if ((msg.role === "user" || msg.role === "assistant") && typeof msg.content === "string") {
        createMessage(msg.role, msg.content);
      }
    }
    const lastUser = [...chatHistory].reverse().find(m => m.role === "user");
    setMode(lastUser ? (inferMode(lastUser.content) || "overview") : "overview");
    closeNavigation();
    drawHistoryList();
    updateMemoryStatus("Saved securely in Cloudflare D1");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Couldn't load conversation");
  } finally {
    setBusy(false);
  }
}

async function deleteSavedConversation(id, title) {
  if (isProcessing) return showToast("Wait for the current operation first.");
  if (!confirm('Permanently delete "' + title + '"? This cannot be undone.')) return;
  setBusy(true, false);
  try {
    await historyRequest("/" + encodeURIComponent(id), { method: "DELETE" });
    if (conversationId === id) {
      conversationId = null;
      chatHistory = [];
      chatMessages.replaceChildren();
      createMessage("assistant", WELCOME);
      setMode("overview");
    }
    await refreshHistory();
    showToast("Saved conversation deleted.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Couldn't delete conversation");
  } finally {
    setBusy(false);
  }
}

async function persistCurrentConversation() {
  // The initial history listing may still be loading. Let the backend decide
  // whether saving is available instead of silently dropping a completed reply.
  if (chatHistory.length < 2) return;
  const lastMessage = chatHistory[chatHistory.length - 1];
  if (lastMessage.role !== "assistant") return;
  try {
    const title = (chatHistory.find(m => m.role === "user")?.content || "New conversation").replace(/\s+/g, " ").slice(0, 90);
    if (!conversationId) {
      const created = await historyRequest("", { method: "POST", body: JSON.stringify({ title }) });
      conversationId = created.id;
    }
    await historyRequest("/" + encodeURIComponent(conversationId), {
      method: "PUT",
      body: JSON.stringify({ messages: chatHistory, title }),
    });
    updateMemoryStatus("Saved securely in Cloudflare D1");
    saveFailed = false;
    // Refresh the sidebar after a successful save.
    await refreshHistory();
  } catch (error) {
    saveFailed = true;
    updateMemoryStatus("Not saved · Chat continues");
    showToast("AI replied, but history wasn't saved. Copy anything important.");
    console.warn("Could not save conversation:", error);
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
  // Keep the complete transcript for saving; bound only the AI request context.

  setBusy(true);
  let responseText = "";
  let assistantText = null;
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chatHistory.slice(-MAX_REQUEST_MESSAGES) }),
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
      await persistCurrentConversation();
    } else {
      assistantText.textContent = "I couldn't generate a response this time. Please try again.";
      // Empty responses are failed turns, just like rejected or interrupted requests.
      if (chatHistory[chatHistory.length - 1]?.role === "user") chatHistory.pop();
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
  conversationId = null;
  saveFailed = false;
  chatMessages.replaceChildren();
  createMessage("assistant", WELCOME);
  setMode("overview");
  userInput.value = "";
  updateTextareaHeight();
  drawHistoryList();
  showToast("New conversation started. Existing saved chats remain available.");
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

refreshHistoryButton.addEventListener("click", () => { if (!isProcessing) void refreshHistory(); });
void refreshHistory();

