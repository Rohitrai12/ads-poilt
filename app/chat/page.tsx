"use client";

import { useState, useRef, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type StepType = "text" | "tool_call" | "tool_result" | "error" | "done";

type Step = {
  type: StepType;
  text: string;
  tool?: string;
  data?: unknown;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;        // plain text for history
  steps?: Step[];         // streamed steps for assistant
  pending?: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2);

const TOOL_ICONS: Record<string, string> = {
  list_campaigns: "⬡",
  get_campaign_insights: "◈",
  update_campaign_budget: "◎",
  update_campaign_status: "◉",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToolCallStep({ step }: { step: Step }) {
  const icon = TOOL_ICONS[step.tool ?? ""] ?? "◆";
  return (
    <div className="step-tool-call">
      <span className="step-icon">{icon}</span>
      <span className="step-tool-name">{step.tool}</span>
      <span className="step-tool-text">{step.text}</span>
    </div>
  );
}

function ToolResultStep({ step }: { step: Step }) {
  const icon = TOOL_ICONS[step.tool ?? ""] ?? "◆";
  const isError = step.text.startsWith("Error");
  return (
    <div className={`step-tool-result ${isError ? "step-error" : ""}`}>
      <span className="step-icon">{isError ? "✗" : icon}</span>
      <span className="step-result-text">{step.text}</span>
    </div>
  );
}

function TextStep({ step }: { step: Step }) {
  return (
    <div className="step-text">
      <span className="step-text-content">{step.text}</span>
    </div>
  );
}

function AssistantMessage({ msg }: { msg: Message }) {
  const steps = msg.steps ?? [];
  const textSteps = steps.filter((s) => s.type === "text");
  const actionSteps = steps.filter(
    (s) => s.type === "tool_call" || s.type === "tool_result"
  );
  const errorSteps = steps.filter((s) => s.type === "error");

  return (
    <div className="msg-assistant">
      <div className="msg-label">
        <span className="label-dot ai-dot" />
        <span className="label-text">META ADS AI</span>
        {msg.pending && <span className="pending-badge">PROCESSING</span>}
      </div>
      <div className="msg-body">
        {actionSteps.length > 0 && (
          <div className="action-log">
            {actionSteps.map((step, i) =>
              step.type === "tool_call" ? (
                <ToolCallStep key={i} step={step} />
              ) : (
                <ToolResultStep key={i} step={step} />
              )
            )}
          </div>
        )}
        {textSteps.map((step, i) => (
          <TextStep key={i} step={step} />
        ))}
        {errorSteps.map((step, i) => (
          <div key={i} className="step-error-text">{step.text}</div>
        ))}
        {msg.pending && steps.length === 0 && (
          <div className="thinking-dots">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
    </div>
  );
}

function UserMessage({ msg }: { msg: Message }) {
  return (
    <div className="msg-user">
      <div className="msg-label">
        <span className="label-dot user-dot" />
        <span className="label-text">YOU</span>
      </div>
      <div className="msg-body user-body">{msg.content}</div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MetaAdsChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [credentials, setCredentials] = useState({
    accessToken: "",
    adAccountId: "",
  });
  const [settingsOpen, setSettingsOpen] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const credentialsSet =
    credentials.accessToken.length > 0 && credentials.adAccountId.length > 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading || !credentialsSet) return;

    const userMsg: Message = {
      id: uid(),
      role: "user",
      content: input.trim(),
    };

    const assistantMsg: Message = {
      id: uid(),
      role: "assistant",
      content: "",
      steps: [],
      pending: true,
    };

    const historyForApi = [
      ...messages.map((m) => ({
        role: m.role,
        content:
          m.role === "assistant"
            ? m.steps
                ?.filter((s) => s.type === "text")
                .map((s) => s.text)
                .join("\n") || m.content
            : m.content,
      })),
      { role: "user", content: input.trim() },
    ];

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/metaChat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: historyForApi,
          accessToken: credentials.accessToken,
          adAccountId: credentials.adAccountId,
        }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const step: Step = JSON.parse(line);
            if (step.type === "done") continue;

            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? {
                      ...m,
                      steps: [...(m.steps ?? []), step],
                      content:
                        step.type === "text"
                          ? (m.content ? m.content + "\n" : "") + step.text
                          : m.content,
                    }
                  : m
              )
            );
          } catch {
            // ignore malformed
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? {
                ...m,
                steps: [
                  ...(m.steps ?? []),
                  { type: "error", text: "Connection error: " + String(err) },
                ],
              }
            : m
        )
      );
    } finally {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id ? { ...m, pending: false } : m
        )
      );
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, credentialsSet, credentials, messages]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const SUGGESTIONS = [
    "Show all my campaigns",
    "Which campaign has the best ROAS?",
    "Increase budget of my best campaign by 20%",
    "Pause underperforming campaigns",
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body { background: #080c10; }

        .app {
          display: flex;
          flex-direction: column;
          height: 100vh;
          background: #080c10;
          color: #c9d1d9;
          font-family: 'IBM Plex Sans', sans-serif;
        }

        /* ─── Header ─── */
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 24px;
          height: 52px;
          border-bottom: 1px solid #21262d;
          background: #0d1117;
          flex-shrink: 0;
        }
        .header-brand {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .header-logo {
          width: 28px;
          height: 28px;
          background: linear-gradient(135deg, #1877f2, #0b5fcc);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 700;
          color: white;
          font-family: 'IBM Plex Mono', monospace;
        }
        .header-title {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.08em;
          color: #e6edf3;
          text-transform: uppercase;
        }
        .header-sub {
          font-size: 11px;
          color: #6e7681;
          letter-spacing: 0.04em;
        }
        .settings-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 5px 12px;
          background: transparent;
          border: 1px solid #30363d;
          border-radius: 6px;
          color: #8b949e;
          font-size: 12px;
          font-family: 'IBM Plex Mono', monospace;
          cursor: pointer;
          transition: all 0.15s;
        }
        .settings-btn:hover {
          border-color: #58a6ff;
          color: #58a6ff;
        }
        .cred-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: ${credentialsSet ? "#3fb950" : "#f0883e"};
        }

        /* ─── Settings Panel ─── */
        .settings-panel {
          background: #0d1117;
          border-bottom: 1px solid #21262d;
          overflow: hidden;
          transition: max-height 0.2s ease;
          flex-shrink: 0;
        }
        .settings-inner {
          padding: 16px 24px;
          display: flex;
          gap: 12px;
          align-items: flex-end;
          flex-wrap: wrap;
        }
        .settings-field {
          display: flex;
          flex-direction: column;
          gap: 5px;
          flex: 1;
          min-width: 200px;
        }
        .settings-label {
          font-size: 10px;
          letter-spacing: 0.1em;
          color: #6e7681;
          text-transform: uppercase;
          font-family: 'IBM Plex Mono', monospace;
        }
        .settings-input {
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 8px 12px;
          color: #e6edf3;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          outline: none;
          transition: border-color 0.15s;
        }
        .settings-input:focus { border-color: #58a6ff; }
        .settings-input::placeholder { color: #484f58; }
        .settings-status {
          font-size: 11px;
          font-family: 'IBM Plex Mono', monospace;
          padding: 8px 14px;
          border-radius: 6px;
          border: 1px solid ${credentialsSet ? "#238636" : "#6e7681"};
          color: ${credentialsSet ? "#3fb950" : "#6e7681"};
          background: ${credentialsSet ? "#0d2d1a" : "transparent"};
          white-space: nowrap;
        }

        /* ─── Chat Area ─── */
        .chat-area {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 24px;
          scroll-behavior: smooth;
        }
        .chat-area::-webkit-scrollbar { width: 4px; }
        .chat-area::-webkit-scrollbar-track { background: transparent; }
        .chat-area::-webkit-scrollbar-thumb { background: #21262d; border-radius: 2px; }

        /* ─── Empty State ─── */
        .empty-state {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 32px;
          padding: 40px;
        }
        .empty-icon {
          width: 56px;
          height: 56px;
          background: linear-gradient(135deg, #1877f2 0%, #0b5fcc 100%);
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 26px;
          font-family: 'IBM Plex Mono', monospace;
          font-weight: 700;
          color: white;
          box-shadow: 0 0 40px rgba(24,119,242,0.25);
        }
        .empty-title {
          font-size: 18px;
          font-weight: 600;
          color: #e6edf3;
          text-align: center;
        }
        .empty-desc {
          font-size: 13px;
          color: #6e7681;
          text-align: center;
          max-width: 400px;
          line-height: 1.6;
        }
        .suggestions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: center;
          max-width: 520px;
        }
        .suggestion-btn {
          padding: 7px 14px;
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 20px;
          color: #8b949e;
          font-size: 12px;
          font-family: 'IBM Plex Mono', monospace;
          cursor: pointer;
          transition: all 0.15s;
        }
        .suggestion-btn:hover {
          border-color: #58a6ff;
          color: #58a6ff;
          background: #0d1f35;
        }

        /* ─── Messages ─── */
        .msg-assistant, .msg-user {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-width: 760px;
          width: 100%;
        }
        .msg-user { align-self: flex-end; align-items: flex-end; }
        .msg-assistant { align-self: flex-start; }

        .msg-label {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .label-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }
        .ai-dot { background: #58a6ff; }
        .user-dot { background: #3fb950; }
        .label-text {
          font-size: 10px;
          letter-spacing: 0.1em;
          font-family: 'IBM Plex Mono', monospace;
          color: #6e7681;
          text-transform: uppercase;
        }
        .pending-badge {
          font-size: 9px;
          letter-spacing: 0.1em;
          font-family: 'IBM Plex Mono', monospace;
          color: #f0883e;
          border: 1px solid #f0883e40;
          padding: 1px 6px;
          border-radius: 3px;
          animation: pulse 1.4s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .msg-body {
          background: #0d1117;
          border: 1px solid #21262d;
          border-radius: 10px;
          padding: 14px 16px;
          font-size: 13.5px;
          line-height: 1.65;
          color: #c9d1d9;
        }
        .user-body {
          background: #0d1f35;
          border-color: #1f4a7a;
          color: #e6edf3;
          text-align: right;
        }

        /* ─── Action Log ─── */
        .action-log {
          margin-bottom: 12px;
          border: 1px solid #21262d;
          border-radius: 6px;
          overflow: hidden;
          background: #080c10;
        }
        .step-tool-call, .step-tool-result {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 7px 12px;
          font-size: 12px;
          font-family: 'IBM Plex Mono', monospace;
          border-bottom: 1px solid #161b22;
        }
        .step-tool-call:last-child, .step-tool-result:last-child {
          border-bottom: none;
        }
        .step-tool-call {
          color: #8b949e;
        }
        .step-tool-result {
          color: #3fb950;
        }
        .step-tool-result.step-error {
          color: #f85149;
        }
        .step-icon {
          color: #58a6ff;
          font-size: 10px;
          flex-shrink: 0;
        }
        .step-tool-result .step-icon { color: #3fb950; }
        .step-tool-result.step-error .step-icon { color: #f85149; }
        .step-tool-name {
          color: #58a6ff;
          flex-shrink: 0;
          font-size: 11px;
        }
        .step-tool-text {
          color: #6e7681;
        }
        .step-result-text { color: inherit; }

        .step-text { }
        .step-text-content {
          white-space: pre-wrap;
        }
        .step-error-text {
          color: #f85149;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
        }

        /* ─── Thinking dots ─── */
        .thinking-dots {
          display: flex;
          gap: 5px;
          align-items: center;
          height: 20px;
        }
        .thinking-dots span {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #58a6ff;
          animation: bounce 1.2s ease-in-out infinite;
        }
        .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
        .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes bounce {
          0%, 100% { opacity: 0.3; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-3px); }
        }

        /* ─── Input Bar ─── */
        .input-bar {
          padding: 16px 24px;
          border-top: 1px solid #21262d;
          background: #0d1117;
          display: flex;
          gap: 10px;
          flex-shrink: 0;
        }
        .chat-input {
          flex: 1;
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 8px;
          padding: 10px 14px;
          color: #e6edf3;
          font-family: 'IBM Plex Sans', sans-serif;
          font-size: 14px;
          outline: none;
          transition: border-color 0.15s;
        }
        .chat-input:focus { border-color: #58a6ff; }
        .chat-input::placeholder { color: #484f58; }
        .chat-input:disabled { opacity: 0.5; cursor: not-allowed; }

        .send-btn {
          padding: 10px 18px;
          background: #1877f2;
          border: none;
          border-radius: 8px;
          color: white;
          font-size: 13px;
          font-family: 'IBM Plex Mono', monospace;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
          letter-spacing: 0.04em;
        }
        .send-btn:hover:not(:disabled) { background: #1d6fd8; }
        .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .input-hint {
          font-size: 11px;
          color: #484f58;
          font-family: 'IBM Plex Mono', monospace;
          text-align: center;
          padding-bottom: 4px;
        }
      `}</style>

      <div className="app">
        {/* Header */}
        <div className="header">
          <div className="header-brand">
            <div className="header-logo">f</div>
            <div>
              <div className="header-title">Meta Ads AI</div>
              <div className="header-sub">Conversational campaign manager</div>
            </div>
          </div>
          <button
            className="settings-btn"
            onClick={() => setSettingsOpen((o) => !o)}
          >
            <span className="cred-dot" />
            {credentialsSet ? "Connected" : "Configure"}
          </button>
        </div>

        {/* Settings Panel */}
        <div
          className="settings-panel"
          style={{ maxHeight: settingsOpen ? "120px" : "0px" }}
        >
          <div className="settings-inner">
            <div className="settings-field">
              <label className="settings-label">Access Token</label>
              <input
                type="password"
                className="settings-input"
                placeholder="EAAxxxxxxxxx..."
                value={credentials.accessToken}
                onChange={(e) =>
                  setCredentials((c) => ({ ...c, accessToken: e.target.value }))
                }
              />
            </div>
            <div className="settings-field">
              <label className="settings-label">Ad Account ID</label>
              <input
                type="text"
                className="settings-input"
                placeholder="act_123456789 or 123456789"
                value={credentials.adAccountId}
                onChange={(e) =>
                  setCredentials((c) => ({
                    ...c,
                    adAccountId: e.target.value.replace(/^act_/, ""),
                  }))
                }
              />
            </div>
            <div className="settings-status">
              {credentialsSet ? "● READY" : "○ NOT SET"}
            </div>
          </div>
        </div>

        {/* Chat Area */}
        <div className="chat-area">
          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">f</div>
              <div>
                <div className="empty-title">Meta Ads AI Assistant</div>
                <p className="empty-desc" style={{ marginTop: 8 }}>
                  Manage your campaigns with natural language. Analyze
                  performance, adjust budgets, and control campaign status — all
                  through conversation.
                </p>
              </div>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    className="suggestion-btn"
                    onClick={() => {
                      setInput(s);
                      inputRef.current?.focus();
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) =>
              msg.role === "user" ? (
                <UserMessage key={msg.id} msg={msg} />
              ) : (
                <AssistantMessage key={msg.id} msg={msg} />
              )
            )
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input Bar */}
        <div style={{ flexShrink: 0 }}>
          <div className="input-bar">
            <input
              ref={inputRef}
              className="chat-input"
              placeholder={
                credentialsSet
                  ? "Ask about your campaigns..."
                  : "Configure credentials above first"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              disabled={loading || !credentialsSet}
            />
            <button
              className="send-btn"
              onClick={sendMessage}
              disabled={loading || !input.trim() || !credentialsSet}
            >
              {loading ? "RUNNING" : "SEND ↵"}
            </button>
          </div>
          <div className="input-hint">
            Enter ↵ to send · Actions are executed immediately against your live account
          </div>
        </div>
      </div>
    </>
  );
}