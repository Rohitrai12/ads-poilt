"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// ─── Types ────────────────────────────────────────────────────────────────────

type StepType = "text" | "tool_call" | "tool_result" | "error" | "done";

type Step = {
  type: StepType;
  text: string;
  tool?: string;
  data?: unknown;
};

type AttachedImage = {
  filename: string;
  base64: string;
  dataUrl: string;
  mimeType: string;
  sizeLabel: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps?: Step[];
  pending?: boolean;
  images?: AttachedImage[];
};

type ChatSession = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  accountId: string;
  accountName: string;
};

type AdAccount = {
  id: string;
  name: string;
  account_status: number;
  currency: string;
  timezone_name: string;
};

// ─── Facebook OAuth config ────────────────────────────────────────────────────
const FB_APP_ID = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID ?? "";
const FB_OAUTH_SCOPES = "ads_management,ads_read,business_management";
const FB_API_VERSION = "v25.0";

// Build the Facebook OAuth redirect URL.
// After the user grants permissions, Facebook redirects to /api/auth/facebook/callback
// which exchanges the code for an access token and redirects back to the app.
function getFbOAuthUrl(): string {
  if (typeof window === "undefined") return "";
  const redirectUri = encodeURIComponent(`${window.location.origin}/api/auth/facebook/callback`);
  const state = Math.random().toString(36).slice(2); // CSRF token
  if (typeof window !== "undefined") sessionStorage.setItem("fb_oauth_state", state);
  return (
    `https://www.facebook.com/dialog/oauth` +
    `?client_id=${FB_APP_ID}` +
    `&redirect_uri=${redirectUri}` +
    `&scope=${encodeURIComponent(FB_OAUTH_SCOPES)}` +
    `&state=${state}` +
    `&response_type=code`
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2);

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString();
}

function groupSessionsByDate(sessions: ChatSession[]) {
  const groups: { label: string; sessions: ChatSession[] }[] = [];
  const now = Date.now();
  const DAY = 86400000;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

  const buckets: Record<string, ChatSession[]> = {
    Today: [], Yesterday: [], "Previous 7 days": [], "Previous 30 days": [], Older: [],
  };

  for (const s of sessions) {
    const d = new Date(s.updatedAt); d.setHours(0, 0, 0, 0);
    if (d.getTime() >= today.getTime()) buckets["Today"].push(s);
    else if (d.getTime() >= yesterday.getTime()) buckets["Yesterday"].push(s);
    else if (now - s.updatedAt < 7 * DAY) buckets["Previous 7 days"].push(s);
    else if (now - s.updatedAt < 30 * DAY) buckets["Previous 30 days"].push(s);
    else buckets["Older"].push(s);
  }

  for (const [label, sess] of Object.entries(buckets)) {
    if (sess.length > 0) groups.push({ label, sessions: sess });
  }
  return groups;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

const LS_SESSIONS = "meta_ads_sessions";
const LS_AUTH = "meta_ads_auth";

function loadSessions(): ChatSession[] {
  try { return JSON.parse(localStorage.getItem(LS_SESSIONS) ?? "[]"); } catch { return []; }
}
function saveSessions(s: ChatSession[]) {
  try { localStorage.setItem(LS_SESSIONS, JSON.stringify(s)); } catch { /* quota */ }
}

// ─── Tool icons ───────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  list_campaigns: "⬡", get_campaign: "◈", get_campaign_insights: "◈",
  create_campaign: "◆", update_campaign_budget: "◎", update_campaign_status: "◉",
  update_campaign_objective: "◎", delete_campaign: "⚠", bulk_update_campaign_status: "◉",
  list_adsets: "⬡", create_adset: "◆", update_adset_targeting: "◎",
  update_adset_budget: "◎", update_adset_status: "◉", get_adset_insights: "◈",
  list_ads: "⬡", update_ad_status: "◉", get_ad_insights: "◈",
  upload_ad_image: "◼", create_ad: "◆", create_ad_from_creative: "◆",
  list_custom_audiences: "⬡", create_custom_audience: "◆", create_lookalike_audience: "◆",
};

// ─── Markdown Renderer ────────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let last = 0; let match: RegExpExecArray | null; let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[2]) parts.push(<strong key={key++} className="font-semibold text-foreground">{match[2]}</strong>);
    else if (match[3]) parts.push(<em key={key++}>{match[3]}</em>);
    else if (match[4]) parts.push(<code key={key++} className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">{match[4]}</code>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

type MdBlock =
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "heading"; level: number; text: string }
  | { type: "hr" }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code_block"; lang: string; code: string }
  | { type: "paragraph"; text: string };

function parseMarkdown(raw: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = raw.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim(); const codeLines: string[] = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) { codeLines.push(lines[i]); i++; }
      blocks.push({ type: "code_block", lang, code: codeLines.join("\n") }); i++; continue;
    }
    if (i + 1 < lines.length && /^\s*\|?[\s-:]+[\|[\s-:]]+\|?\s*$/.test(lines[i + 1])) {
      const sepLine = lines[i + 1];
      if (/^[\|\s\-:]+$/.test(sepLine.replace(/[^|\-:\s]/g, ""))) {
        const parseRow = (l: string) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        const headers = parseRow(lines[i]); const rows: string[][] = []; i += 2;
        while (i < lines.length && lines[i].includes("|")) { rows.push(parseRow(lines[i])); i++; }
        blocks.push({ type: "table", headers, rows }); continue;
      }
    }
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) { blocks.push({ type: "heading", level: hMatch[1].length, text: hMatch[2] }); i++; continue; }
    if (/^[-*_]{3,}\s*$/.test(line)) { blocks.push({ type: "hr" }); i++; continue; }
    if (/^[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) { items.push(lines[i].replace(/^[-*+]\s+/, "")); i++; }
      blocks.push({ type: "ul", items }); continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, "")); i++; }
      blocks.push({ type: "ol", items }); continue;
    }
    if (!line.trim()) { i++; continue; }
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() &&
      !/^(#{1,6}\s|[-*+]\s|\d+\.\s|```|[-*_]{3,})/.test(lines[i]) &&
      !(i + 1 < lines.length && /^\s*\|?[\s\-:]+[\|[\s\-:]]+\|?\s*$/.test(lines[i + 1]))) {
      paraLines.push(lines[i]); i++;
    }
    if (paraLines.length) blocks.push({ type: "paragraph", text: paraLines.join("\n") });
  }
  return blocks;
}

function MarkdownRenderer({ text, isPending }: { text: string; isPending?: boolean }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="space-y-3 text-sm leading-7 text-foreground">
      {blocks.map((block, bi) => {
        const isLast = bi === blocks.length - 1;
        if (block.type === "table") return (
          <div key={bi} className="overflow-x-auto rounded-lg border border-border/50">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/40">
                  {block.headers.map((h, hi) => <th key={hi} className="px-4 py-2.5 text-left font-semibold text-foreground text-xs tracking-wide">{renderInline(h)}</th>)}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-border/30 transition-colors hover:bg-muted/20 last:border-0">
                    {row.map((cell, ci) => <td key={ci} className="px-4 py-2.5 text-muted-foreground align-middle">{renderInline(cell)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        if (block.type === "heading") {
          const Tag = `h${block.level}` as "h1"|"h2"|"h3"|"h4"|"h5"|"h6";
          const sizes: Record<number,string> = {1:"text-xl font-bold",2:"text-lg font-semibold",3:"text-base font-semibold",4:"text-sm font-semibold",5:"text-sm font-medium",6:"text-xs font-medium"};
          return <Tag key={bi} className={`${sizes[block.level]??""} text-foreground`}>{renderInline(block.text)}</Tag>;
        }
        if (block.type === "hr") return <hr key={bi} className="border-border/40" />;
        if (block.type === "ul") return (
          <ul key={bi} className="space-y-1 pl-5">
            {block.items.map((item,ii) => <li key={ii} className="list-disc text-foreground marker:text-muted-foreground/50">{renderInline(item)}</li>)}
          </ul>
        );
        if (block.type === "ol") return (
          <ol key={bi} className="space-y-1 pl-5">
            {block.items.map((item,ii) => <li key={ii} className="list-decimal text-foreground marker:text-muted-foreground/50">{renderInline(item)}</li>)}
          </ol>
        );
        if (block.type === "code_block") return (
          <pre key={bi} className="overflow-x-auto rounded-lg border border-border/40 bg-muted/50 px-4 py-3 font-mono text-xs leading-relaxed text-foreground">
            <code>{block.code}</code>
          </pre>
        );
        return (
          <p key={bi} className="text-foreground">
            {renderInline(block.text)}
            {isPending && isLast && <TypingCursor />}
          </p>
        );
      })}
      {isPending && blocks.length === 0 && <TypingCursor />}
    </div>
  );
}

// ─── Avatars & Cursor ─────────────────────────────────────────────────────────

function AIAvatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#aaf345] shadow-[0_0_12px_rgba(24,119,242,0.4)]">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
      </svg>
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-xs font-semibold text-white">U</div>
  );
}

function TypingCursor() {
  return (
    <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[1px] bg-current align-middle"
      style={{ animation: "blink 1s step-start infinite" }} />
  );
}

// ─── Image Preview Pills ──────────────────────────────────────────────────────

function ImagePill({ img, onRemove }: { img: AttachedImage; onRemove?: () => void }) {
  return (
    <div className="group relative flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 p-1.5 pr-2.5">
      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.dataUrl} alt={img.filename} className="h-full w-full object-cover" />
      </div>
      <div className="min-w-0">
        <div className="max-w-[120px] truncate text-[11px] font-medium text-foreground">{img.filename}</div>
        <div className="text-[10px] text-muted-foreground">{img.sizeLabel}</div>
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-700 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive"
          title="Remove image"
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ─── Tool Steps ───────────────────────────────────────────────────────────────

function ToolSteps({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(false);
  const actionSteps = steps.filter((s) => s.type === "tool_call" || s.type === "tool_result");
  if (actionSteps.length === 0) return null;
  const hasError = actionSteps.some((s) => s.type === "tool_result" && s.text.startsWith("Error"));
  const toolNames = [...new Set(actionSteps.filter((s) => s.type === "tool_call").map((s) => s.tool).filter(Boolean))];
  return (
    <div className="mb-3">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
        <span className="inline-block transition-transform duration-200" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
        <span className={hasError ? "text-destructive" : ""}>
          {hasError ? "⚠ Error in tool call" : `Used ${toolNames.length > 0 ? toolNames.slice(0, 2).join(", ") : "tools"}`}
          {toolNames.length > 2 ? ` +${toolNames.length - 2} more` : ""}
        </span>
      </button>
      {open && (
        <div className="mt-1 space-y-2 rounded-lg border border-border/40 bg-muted/30 px-3 py-2.5 text-xs">
          {actionSteps.map((step, i) => {
            const icon = TOOL_ICONS[step.tool ?? ""] ?? "◆";
            const isResult = step.type === "tool_result";
            const isError = isResult && step.text.startsWith("Error");
            return (
              <div key={i} className="flex items-start gap-2">
                <span className={`font-mono shrink-0 ${isError ? "text-destructive" : "text-muted-foreground"}`}>{isResult ? (isError ? "✗" : "✓") : icon}</span>
                <span className={`font-mono shrink-0 ${isError ? "text-destructive" : "text-blue-400"}`}>{step.tool ?? (isResult ? "result" : "tool")}</span>
                <span className={`min-w-0 whitespace-pre-wrap break-words leading-relaxed ${isError ? "text-destructive" : "text-muted-foreground"}`}>{step.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Message components ───────────────────────────────────────────────────────

function AssistantMessage({ msg }: { msg: Message }) {
  const steps = msg.steps ?? [];
  const textSteps = steps.filter((s) => s.type === "text");
  const errorSteps = steps.filter((s) => s.type === "error");
  return (
    <div className="group flex w-full gap-4 px-4 py-5 transition-colors" style={{ animation: "fadeSlideIn 0.2s ease-out" }}>
      <AIAvatar />
      <div className="min-w-0 flex-1 pt-0.5">
        <ToolSteps steps={steps} />
        {textSteps.length > 0 ? (
          <MarkdownRenderer text={textSteps.map((s) => s.text).join("\n")} isPending={msg.pending} />
        ) : msg.pending ? (
          <div className="flex items-center gap-1 pt-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-2 w-2 rounded-full bg-muted-foreground/50"
                style={{ animation: "bounce 1.4s ease-in-out infinite", animationDelay: `${i * 0.16}s` }} />
            ))}
          </div>
        ) : null}
        {errorSteps.map((step, i) => (
          <div key={i} className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{step.text}</div>
        ))}
      </div>
    </div>
  );
}

function UserMessage({ msg }: { msg: Message }) {
  return (
    <div className="flex w-full justify-end gap-4 px-4 py-5" style={{ animation: "fadeSlideIn 0.15s ease-out" }}>
      <div className="max-w-[75%] space-y-2">
        {msg.images && msg.images.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {msg.images.map((img, i) => (
              <ImagePill key={i} img={img} />
            ))}
          </div>
        )}
        {msg.content && (
          <div className="rounded-2xl bg-zinc-800 px-4 py-3 text-sm leading-7 text-white shadow-sm dark:bg-zinc-700">{msg.content}</div>
        )}
      </div>
      <UserAvatar />
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({
  sessions, activeId, onSelect, onNew, onDelete, onRename, collapsed, onToggle,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (renamingId) renameRef.current?.focus(); }, [renamingId]);

  const groups = groupSessionsByDate(sessions);

  return (
    <div
      className="flex flex-col border-r border-border/50 bg-muted/10 transition-all duration-300 shrink-0 overflow-hidden"
      style={{ width: collapsed ? "52px" : "260px", minWidth: collapsed ? "52px" : "260px" }}
    >
      <div className={`flex items-center border-b border-border/30 px-3 py-3 ${collapsed ? "justify-center" : "justify-between"}`}>
        {!collapsed && (
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Chats</span>
        )}
        <div className="flex items-center gap-1">
          {!collapsed && (
            <button onClick={onNew} title="New chat"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
          <button onClick={onToggle} title={collapsed ? "Expand" : "Collapse"}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {collapsed ? <path d="M9 18l6-6-6-6" /> : <path d="M15 18l-6-6 6-6" />}
            </svg>
          </button>
        </div>
      </div>

      {collapsed ? (
        <div className="flex flex-col items-center gap-1.5 overflow-y-auto py-3">
          <button onClick={onNew} title="New chat"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <div className="my-1 h-px w-6 bg-border/40" />
          {sessions.slice(0, 12).map((s) => (
            <button key={s.id} onClick={() => onSelect(s.id)} title={s.title}
              className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold transition-colors
                ${s.id === activeId ? "bg-[#aaf345]/15 text-[#aaf345]" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
              {s.title.charAt(0).toUpperCase()}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-2 scrollbar-thin">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <p className="text-xs text-muted-foreground">No conversations yet.<br />Start by sending a message.</p>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="mb-1">
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                  {group.label}
                </div>
                {group.sessions.map((session) => (
                  <div key={session.id} className="group/item relative mx-1">
                    {renamingId === session.id ? (
                      <div className="mx-1 flex items-center rounded-lg bg-muted px-2 py-2">
                        <input
                          ref={renameRef}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { onRename(session.id, renameValue.trim() || session.title); setRenamingId(null); }
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          onBlur={() => { onRename(session.id, renameValue.trim() || session.title); setRenamingId(null); }}
                          className="w-full bg-transparent text-xs text-foreground outline-none"
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => onSelect(session.id)}
                        className={`relative w-full rounded-lg px-3 py-2 text-left transition-colors
                          ${session.id === activeId
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          }`}
                      >
                        <div className="flex items-start gap-1">
                          <span className="flex-1 min-w-0 truncate text-xs leading-5">{session.title}</span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground/40">{formatRelativeTime(session.updatedAt)}</div>
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden items-center gap-0.5 group-hover/item:flex">
                          <div className="absolute -left-6 top-0 h-full w-6 bg-gradient-to-l from-muted/80 to-transparent" />
                          <span role="button" title="Rename"
                            onClick={(e) => { e.stopPropagation(); setRenamingId(session.id); setRenameValue(session.title); }}
                            className="relative z-10 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </span>
                          <span role="button" title="Delete"
                            onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
                            className="relative z-10 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14H6L5 6" />
                              <path d="M10 11v6M14 11v6" />
                              <path d="M9 6V4h6v2" />
                            </svg>
                          </span>
                        </div>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Facebook icon ────────────────────────────────────────────────────────────

function FacebookIcon({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

// ─── Facebook OAuth helpers ───────────────────────────────────────────────────

/**
 * Redirect-based Facebook OAuth (works in dev mode / before app review).
 * Navigates full-page to Facebook's dialog; Facebook redirects back to
 * /api/auth/facebook/callback which exchanges the code for a token, then
 * redirects to /?fb_token=<token> so we can pick it up from the URL.
 */
function redirectToFacebookLogin() {
  if (typeof window === "undefined" || !FB_APP_ID) return;
  const state = Math.random().toString(36).slice(2);
  sessionStorage.setItem("fb_oauth_state", state);
  const redirectUri = encodeURIComponent(`${window.location.origin}/api/auth/facebook/callback`);
  const url =
    `https://www.facebook.com/dialog/oauth` +
    `?client_id=${FB_APP_ID}` +
    `&redirect_uri=${redirectUri}` +
    `&scope=${encodeURIComponent(FB_OAUTH_SCOPES)}` +
    `&state=${state}` +
    `&response_type=code`;
  window.location.href = url;
}

async function fetchAdAccountsForUser(accessToken: string): Promise<AdAccount[]> {
  const fields = "id,name,account_status,currency,timezone_name";
  const res = await fetch(
    `https://graph.facebook.com/${FB_API_VERSION}/me/adaccounts?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message ?? "Could not fetch ad accounts.");
  return (data.data ?? []) as AdAccount[];
}

// ─── Ad Account Picker Modal ──────────────────────────────────────────────────

function AdAccountPicker({
  accounts,
  onSelect,
  onCancel,
}: {
  accounts: AdAccount[];
  onSelect: (account: AdAccount) => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      style={{ animation: "fadeSlideIn 0.15s ease-out" }}>
      <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/40 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold">Select Ad Account</h3>
            <p className="text-[11px] text-muted-foreground">Choose which account to manage</p>
          </div>
          <button onClick={onCancel}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto py-2">
          {accounts.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              No ad accounts found for this Facebook account.
            </div>
          ) : (
            accounts.map((acct) => {
              const isActive = acct.account_status === 1;
              const numericId = acct.id.replace(/^act_/, "");
              return (
                <button
                  key={acct.id}
                  onClick={() => onSelect(acct)}
                  disabled={!isActive}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold
                    ${isActive ? "bg-[#aaf345]/20 text-[#6db52b]" : "bg-muted text-muted-foreground"}`}>
                    {acct.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-foreground">{acct.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      act_{numericId} · {acct.currency}
                      {!isActive && <span className="ml-1.5 text-amber-500">Inactive</span>}
                    </div>
                  </div>
                  {isActive && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-border/40 px-5 py-3">
          <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Connect screen ───────────────────────────────────────────────────────────

function ConnectScreen({ onConnect }: {
  onConnect: (accessToken: string, adAccountId: string) => void;
}) {
  const [mode, setMode] = useState<"choose" | "manual">("choose");
  const [token, setToken] = useState("");
  const [adAccountId, setAdAccountId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ── Facebook OAuth button ──────────────────────────────────────────────────
  const handleFbLogin = () => {
    if (!FB_APP_ID) {
      setError("NEXT_PUBLIC_FACEBOOK_APP_ID is not configured. Please add it to .env.local and restart the server.");
      return;
    }
    setError("");
    redirectToFacebookLogin();
  };

  // ── Manual token submit ───────────────────────────────────────────────────
  const handleSubmit = async () => {
    const cleanToken = token.trim();
    const cleanAcct = adAccountId.trim().replace(/^act_/i, "");
    if (!cleanToken) { setError("Access token is required."); return; }
    if (!cleanAcct || !/^\d+$/.test(cleanAcct)) { setError("Ad Account ID must be numeric (e.g. 123456789)."); return; }

    setError("");
    setLoading(true);
    try {
      const res = await fetch(
        `https://graph.facebook.com/${FB_API_VERSION}/act_${cleanAcct}?fields=id,name,account_status,currency,timezone_name&access_token=${encodeURIComponent(cleanToken)}`
      );
      const data = await res.json();
      if (data.error) {
        setError(data.error.message ?? "Invalid token or account ID.");
        setLoading(false);
        return;
      }
      onConnect(cleanToken, cleanAcct);
    } catch {
      setError("Network error — could not reach Meta API.");
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#aaf345] shadow-[0_0_50px_rgba(170,243,69,0.25)]">
          <FacebookIcon size={28} color="white" />
        </div>

        <div className="text-center">
          <h2 className="text-xl font-semibold">Connect Meta Ads</h2>
          <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
            Sign in with Facebook or paste your credentials to start managing campaigns with AI.
          </p>
        </div>

        {mode === "choose" && (
          <div className="flex w-full max-w-sm flex-col gap-3">
            {/* ── Facebook OAuth button ── */}
            <button
              onClick={handleFbLogin}
              className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-xl border border-[#1877f2]/40 bg-[#1877f2] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_2px_12px_rgba(24,119,242,0.35)] transition-all hover:bg-[#166fe5] hover:shadow-[0_4px_20px_rgba(24,119,242,0.45)]"
            >
              <FacebookIcon size={18} color="white" />
              Continue with Facebook
              {/* Shine effect */}
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-500 group-hover:translate-x-full" />
            </button>

            <div className="flex items-center gap-3 py-1">
              <div className="h-px flex-1 bg-border/50" />
              <span className="text-[11px] text-muted-foreground">or use a token manually</span>
              <div className="h-px flex-1 bg-border/50" />
            </div>

            <button
              onClick={() => setMode("manual")}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Enter access token manually
            </button>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <details className="pt-1">
              <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
                Why Facebook login? ▸
              </summary>
              <div className="mt-2 rounded-lg border border-border/40 bg-muted/20 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
                <p>Signing in with Facebook uses OAuth 2.0 — no password is shared with this app. Your ad accounts are fetched automatically, and you can revoke access any time from your <a href="https://www.facebook.com/settings?tab=applications" target="_blank" rel="noopener noreferrer" className="text-[#aaf345] hover:underline">Facebook App Settings</a>.</p>
              </div>
            </details>
          </div>
        )}

        {mode === "manual" && (
          <>
            <Card className="w-full max-w-sm border-border/60">
              <CardContent className="space-y-4 pt-5">
                <button
                  onClick={() => { setMode("choose"); setError(""); }}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 12H5M12 5l-7 7 7 7" />
                  </svg>
                  Back
                </button>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Access Token</label>
                  <Input
                    type="password"
                    placeholder="EAAxxxxxxxxxxxxxxxx…"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="font-mono text-xs"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Get it from{" "}
                    <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer"
                      className="text-[#aaf345] underline-offset-2 hover:underline">
                      Graph API Explorer
                    </a>
                    {" "}with <code className="rounded bg-muted px-1 text-[10px]">ads_management</code> + <code className="rounded bg-muted px-1 text-[10px]">ads_read</code> scopes.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Ad Account ID</label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 select-none font-mono text-xs text-muted-foreground">act_</span>
                    <Input
                      placeholder="123456789"
                      value={adAccountId.replace(/^act_/i, "")}
                      onChange={(e) => setAdAccountId(e.target.value.replace(/^act_/i, ""))}
                      className="pl-10 font-mono text-xs"
                      autoComplete="off"
                      inputMode="numeric"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Found in Meta Ads Manager → Account Settings, or in the URL as <code className="rounded bg-muted px-1 text-[10px]">act_XXXXXXX</code>.
                  </p>
                </div>

                {error && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {error}
                  </div>
                )}

                <Button
                  className="w-full gap-2 bg-[#aaf345] text-black hover:bg-[#96da2e] disabled:opacity-40"
                  onClick={handleSubmit}
                  disabled={loading || !token.trim() || !adAccountId.trim()}
                >
                  {loading ? (
                    <>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                      Verifying…
                    </>
                  ) : (
                    <>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                      Connect
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            <details className="w-full max-w-sm">
              <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
                How to get a long-lived token ▸
              </summary>
              <div className="mt-2 space-y-1.5 rounded-lg border border-border/40 bg-muted/20 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
                <p>1. Open <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" className="text-[#aaf345] hover:underline">Graph API Explorer</a>.</p>
                <p>2. Select your App → Generate Access Token → check <code className="rounded bg-muted px-1">ads_management</code> and <code className="rounded bg-muted px-1">ads_read</code>.</p>
                <p>3. Copy the token above. Short-lived tokens expire in 1 hour; exchange via <code className="rounded bg-muted px-1">/oauth/access_token?grant_type=fb_exchange_token</code> for a 60-day token.</p>
              </div>
            </details>
          </>
        )}
      </div>
    </>
  );
}

// ─── Token Refresh Banner ─────────────────────────────────────────────────────

function TokenRefreshBanner({
  accountName,
  token,
  onTokenChange,
  onSubmit,
  onFbRefresh,
  onDismiss,
  loading,
  error,
}: {
  accountName: string;
  token: string;
  onTokenChange: (v: string) => void;
  onSubmit: () => void;
  onFbRefresh: () => void;
  onDismiss: () => void;
  loading: boolean;
  error: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  return (
    <div
      className="shrink-0 border-b border-amber-500/30 bg-amber-950/40 px-4 py-3 md:px-6"
      style={{ animation: "fadeSlideIn 0.2s ease-out" }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center">
        {/* Icon + message */}
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/15">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-amber-400">Access token expired</p>
            <p className="text-[11px] text-amber-300/70">
              Your token for <span className="font-medium text-amber-300">{accountName}</span> has expired. Refresh to continue — your chat history is preserved.
            </p>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex shrink-0 flex-col gap-1.5 sm:w-72">
          {/* Facebook re-login button */}
          {FB_APP_ID && (
            <button
              onClick={onFbRefresh}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-[#1877f2] px-3 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-[#166fe5] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FacebookIcon size={11} color="white" />
              Re-connect with Facebook
            </button>
          )}

          <div className="flex gap-1.5">
            <Input
              ref={ref}
              type="password"
              placeholder="Or paste new access token…"
              value={token}
              onChange={(e) => onTokenChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); }}
              disabled={loading}
              className="h-8 flex-1 border-amber-500/30 bg-amber-950/50 font-mono text-[11px] text-amber-100 placeholder:text-amber-700 focus-visible:border-amber-500/60 focus-visible:ring-0"
            />
            <button
              onClick={onSubmit}
              disabled={loading || !token.trim()}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-amber-500 px-3 text-[11px] font-semibold text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              )}
              Paste
            </button>
            <button
              onClick={onDismiss}
              title="Dismiss"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-amber-500/60 transition-colors hover:bg-amber-500/10 hover:text-amber-400"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          {error && <p className="text-[10px] text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}

const ANIMATION_STYLES = `
  @keyframes fadeSlideIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  @keyframes bounce { 0%,80%,100%{transform:scale(0.6);opacity:0.4} 40%{transform:scale(1);opacity:1} }
`;

// ─── Main Component ───────────────────────────────────────────────────────────

function MetaAdsChatInner({ embedded = false }: { embedded?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<"connect" | "chat">("connect");
  const [accessToken, setAccessToken] = useState("");
  const [adAccountId, setAdAccountId] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<AdAccount | null>(null);

  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Multi-account OAuth picker (shown after redirect callback) ────────────
  const [oauthToken, setOauthToken] = useState("");
  const [oauthAccounts, setOauthAccounts] = useState<AdAccount[]>([]);
  const [showOauthPicker, setShowOauthPicker] = useState(false);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ── Auth expiry ───────────────────────────────────────────────────────────
  const [authExpired, setAuthExpired] = useState(false);
  const [refreshToken, setRefreshToken] = useState("");
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setSessions(loadSessions());
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") saveSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LS_AUTH);
      if (!raw) return;
      const saved: { accessToken: string; adAccountId: string; selectedAccount?: AdAccount | null } = JSON.parse(raw);
      if (!saved.accessToken || !saved.adAccountId) return;
      setAccessToken(saved.accessToken);
      setAdAccountId(saved.adAccountId);
      if (saved.selectedAccount) { setSelectedAccount(saved.selectedAccount); setPhase("chat"); }
    } catch { /* ignore */ }
  }, []);

  // ── Pick up OAuth token from URL after Facebook redirect callback ──────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fbToken = params.get("fb_token");
    const fbError = params.get("fb_error");

    if (fbError) {
      // Clean the URL and let the user see the connect screen with an error
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    if (!fbToken) return;

    // Clean the token from the URL immediately
    window.history.replaceState({}, "", window.location.pathname);

    // Fetch ad accounts, then auto-connect (single account) or show picker
    (async () => {
      try {
        const accounts = await fetchAdAccountsForUser(fbToken);
        if (accounts.length === 0) return;
        // Auto-connect to the first (or only) account
        const acct = accounts[0];
        const numericId = acct.id.replace(/^act_/, "");
        setAccessToken(fbToken);
        setAdAccountId(numericId);
        setSelectedAccount(acct);
        setPhase("chat");
        window.localStorage.setItem(LS_AUTH, JSON.stringify({ accessToken: fbToken, adAccountId: numericId, selectedAccount: acct }));
        if (accounts.length > 1) {
          // Multiple accounts — show the picker
          setOauthAccounts(accounts);
          setOauthToken(fbToken);
          setShowOauthPicker(true);
        }
      } catch { /* ignore — user can connect manually */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleManualConnect = useCallback(async (token: string, acctId: string) => {
    try {
      const res = await fetch(
        `https://graph.facebook.com/${FB_API_VERSION}/act_${acctId}?fields=id,name,account_status,currency,timezone_name&access_token=${encodeURIComponent(token)}`
      );
      const data = await res.json();
      const acct: AdAccount = {
        id: `act_${acctId}`,
        name: data.name ?? `Account ${acctId}`,
        account_status: data.account_status ?? 1,
        currency: data.currency ?? "USD",
        timezone_name: data.timezone_name ?? "",
      };
      setAccessToken(token);
      setAdAccountId(acctId);
      setSelectedAccount(acct);
      setPhase("chat");
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LS_AUTH, JSON.stringify({ accessToken: token, adAccountId: acctId, selectedAccount: acct }));
      }
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch { /* ignore */ }
  }, []);

  const disconnect = () => {
    setAccessToken(""); setAdAccountId(""); setSelectedAccount(null); setMessages([]);
    setPhase("connect"); setActiveSessionId(null); setAttachedImages([]);
    setAuthExpired(false); setRefreshToken(""); setRefreshError("");
    if (typeof window !== "undefined") window.localStorage.removeItem(LS_AUTH);
  };

  // ── Auth error detection ──────────────────────────────────────────────────

  function isAuthError(text: string): boolean {
    try {
      const jsonMatch = text.match(/Error:\s*(\{[\s\S]*?\})/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.code === 190) return true;
      }
      if (/"code"\s*:\s*190/.test(text)) return true;
    } catch { /* ignore */ }
    return false;
  }

  // ── Token refresh (keeps all messages / sessions intact) ──────────────────

  const handleTokenRefresh = useCallback(async () => {
    const newToken = refreshToken.trim();
    if (!newToken || !adAccountId) return;
    setRefreshLoading(true);
    setRefreshError("");
    try {
      const res = await fetch(
        `https://graph.facebook.com/${FB_API_VERSION}/act_${adAccountId}?fields=id,name,account_status,currency,timezone_name&access_token=${encodeURIComponent(newToken)}`
      );
      const data = await res.json();
      if (data.error) {
        setRefreshError(data.error.message ?? "Invalid token — please try again.");
        setRefreshLoading(false);
        return;
      }
      const updatedAcct: AdAccount = {
        id: `act_${adAccountId}`,
        name: data.name ?? selectedAccount?.name ?? `Account ${adAccountId}`,
        account_status: data.account_status ?? 1,
        currency: data.currency ?? "USD",
        timezone_name: data.timezone_name ?? "",
      };
      setAccessToken(newToken);
      setSelectedAccount(updatedAcct);
      setAuthExpired(false);
      setRefreshToken("");
      setRefreshError("");
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LS_AUTH, JSON.stringify({ accessToken: newToken, adAccountId, selectedAccount: updatedAcct }));
      }
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch {
      setRefreshError("Network error — could not reach Meta API.");
    } finally {
      setRefreshLoading(false);
    }
  }, [refreshToken, adAccountId, selectedAccount]);

  // ── Facebook re-login for token refresh ───────────────────────────────────

  const handleFbRefresh = useCallback(() => {
    // Re-run the full OAuth redirect flow — the callback will update the token
    redirectToFacebookLogin();
  }, []);

  // ── Image attachment ──────────────────────────────────────────────────────

  const handleImageFiles = useCallback((files: FileList | File[]) => {
    const fileArr = Array.from(files);
    const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    const maxSize = 4 * 1024 * 1024;

    for (const file of fileArr) {
      if (!validTypes.includes(file.type)) {
        alert(`"${file.name}" is not a supported image type. Please use JPG, PNG, GIF, or WebP.`);
        continue;
      }
      if (file.size > maxSize) {
        alert(`"${file.name}" is too large (max 4 MB).`);
        continue;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const base64 = dataUrl.split(",")[1] ?? "";
        setAttachedImages((prev) => [
          ...prev,
          { filename: file.name, base64, dataUrl, mimeType: file.type, sizeLabel: formatBytes(file.size) },
        ]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleImageFiles(e.target.files);
    e.target.value = "";
  };

  const removeImage = (idx: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) handleImageFiles(e.dataTransfer.files);
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length === 0) return;
    e.preventDefault();
    const files = imageItems.map((item) => item.getAsFile()).filter(Boolean) as File[];
    handleImageFiles(files);
  }, [handleImageFiles]);

  // ── Session management ────────────────────────────────────────────────────

  const startNewChat = useCallback(() => {
    setMessages([]); setActiveSessionId(null); setAttachedImages([]);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const loadSession = useCallback((id: string) => {
    const s = sessions.find((s) => s.id === id);
    if (!s) return;
    setMessages(s.messages); setActiveSessionId(id);
  }, [sessions]);

  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) { setMessages([]); setActiveSessionId(null); }
  }, [activeSessionId]);

  const renameSession = useCallback((id: string, title: string) => {
    setSessions((prev) => prev.map((s) => s.id === id ? { ...s, title } : s));
  }, []);

  // ── Send message ──────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const hasText = input.trim().length > 0;
    const hasImages = attachedImages.length > 0;
    if ((!hasText && !hasImages) || loading || !accessToken || !selectedAccount) return;

    let richContent = input.trim();
    if (hasImages && !hasText) {
      richContent = `I'm attaching ${attachedImages.length} image${attachedImages.length > 1 ? "s" : ""} to use for creating an ad.`;
    }

    let apiContent = richContent;
    if (hasImages) {
      const imageDescriptions = attachedImages.map((img, i) =>
        `[Image ${i + 1}: filename="${img.filename}", base64_data_available=true, image_base64="${img.base64.slice(0, 20)}..."]`
      ).join("\n");

      const imageInstructions = attachedImages.map((img, i) =>
        `IMAGE_${i + 1}_FILENAME: ${img.filename}\nIMAGE_${i + 1}_BASE64: ${img.base64}`
      ).join("\n\n");

      apiContent = `${richContent}\n\nThe user has attached ${attachedImages.length} image${attachedImages.length > 1 ? "s" : ""} for ad creation:\n${imageDescriptions}\n\nFull image data for upload_ad_image tool:\n${imageInstructions}`;
    }

    const userMsg: Message = {
      id: uid(),
      role: "user",
      content: richContent,
      images: hasImages ? [...attachedImages] : undefined,
    };
    const assistantMsg: Message = { id: uid(), role: "assistant", content: "", steps: [], pending: true };

    const historyForApi = [
      ...messages.map((m) => ({
        role: m.role,
        content: m.role === "assistant"
          ? m.steps?.filter((s) => s.type === "text").map((s) => s.text).join("\n") || m.content
          : m.content,
      })),
      { role: "user", content: apiContent },
    ];

    const newMessages = [...messages, userMsg, assistantMsg];
    setMessages(newMessages);
    setInput("");
    setAttachedImages([]);
    setLoading(true);

    const isFirst = messages.length === 0;
    const sessionId = activeSessionId ?? uid();
    if (isFirst || !activeSessionId) {
      setActiveSessionId(sessionId);
      const title = richContent.slice(0, 60) + (richContent.length > 60 ? "…" : "");
      setSessions((prev) => [{
        id: sessionId, title, messages: newMessages,
        createdAt: Date.now(), updatedAt: Date.now(),
        accountId: selectedAccount.id, accountName: selectedAccount.name,
      }, ...prev.filter((s) => s.id !== sessionId)]);
    }

    try {
      const res = await fetch("/api/metaChat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: historyForApi, accessToken, adAccountId }),
      });
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const step: Step = JSON.parse(line);
            if (step.type === "done") continue;
            if (step.type === "tool_result" && isAuthError(step.text)) {
              setAuthExpired(true);
            }
            setMessages((prev) => {
              const updated = prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, steps: [...(m.steps ?? []), step], content: step.type === "text" ? (m.content ? m.content + "\n" : "") + step.text : m.content }
                  : m
              );
              setSessions((ps) => ps.map((s) => s.id === sessionId ? { ...s, messages: updated, updatedAt: Date.now() } : s));
              return updated;
            });
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === assistantMsg.id ? { ...m, steps: [...(m.steps ?? []), { type: "error" as StepType, text: "Connection error: " + String(err) }] } : m
        );
        setSessions((ps) => ps.map((s) => s.id === sessionId ? { ...s, messages: updated, updatedAt: Date.now() } : s));
        return updated;
      });
    } finally {
      setMessages((prev) => {
        const finalized = prev.map((m) => m.id === assistantMsg.id ? { ...m, pending: false } : m);
        setSessions((ps) => ps.map((s) => s.id === sessionId ? { ...s, messages: finalized, updatedAt: Date.now() } : s));
        return finalized;
      });
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, attachedImages, loading, accessToken, selectedAccount, messages, activeSessionId, adAccountId]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const SUGGESTIONS = [
    "Show all my campaigns and their budgets",
    "Which campaign has the best ROAS last 30 days?",
    "Show ad sets for my best campaign",
    "Pause all underperforming campaigns",
    "Create a new ad with an image",
    "Create a text/link ad without an image",
    "List my custom audiences",
  ];

  const canSend = (input.trim().length > 0 || attachedImages.length > 0) && !loading && !authExpired;

  const handleOauthAccountPick = useCallback((acct: AdAccount) => {
    const numericId = acct.id.replace(/^act_/, "");
    setAccessToken(oauthToken);
    setAdAccountId(numericId);
    setSelectedAccount(acct);
    setPhase("chat");
    setShowOauthPicker(false);
    window.localStorage.setItem(LS_AUTH, JSON.stringify({ accessToken: oauthToken, adAccountId: numericId, selectedAccount: acct }));
  }, [oauthToken]);

  return (
    <>
      <style>{ANIMATION_STYLES}</style>
      {showOauthPicker && (
        <AdAccountPicker
          accounts={oauthAccounts}
          onSelect={handleOauthAccountPick}
          onCancel={() => setShowOauthPicker(false)}
        />
      )}
      <div className={"flex min-h-0 flex-col bg-background text-foreground " + (embedded ? "flex-1" : "h-[100svh]")}>

        {/* Top header */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-4 py-3 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#aaf345]">
              <FacebookIcon size={14} color="white" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-tight">Meta Ads AI</div>
              <div className="truncate text-[11px] leading-tight text-muted-foreground">Conversational campaign manager</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {phase === "chat" && selectedAccount ? (
              <>
                <Badge
                  variant="secondary"
                  className={`hidden gap-1.5 font-mono text-[10px] sm:flex ${authExpired ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : ""}`}
                >
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${authExpired ? "bg-amber-500" : "bg-green-500"}`} />
                  {authExpired ? "Token expired" : selectedAccount.name}
                </Badge>
                <Button variant="ghost" size="sm" onClick={disconnect} className="text-xs text-muted-foreground hover:text-foreground">Disconnect</Button>
              </>
            ) : (
              <Badge variant="outline" className="font-mono text-[10px]">NOT CONNECTED</Badge>
            )}
          </div>
        </div>

        {/* Token refresh banner — shown inline when token expires */}
        {phase === "chat" && authExpired && (
          <TokenRefreshBanner
            accountName={selectedAccount?.name ?? "your account"}
            token={refreshToken}
            onTokenChange={setRefreshToken}
            onSubmit={handleTokenRefresh}
            onFbRefresh={handleFbRefresh}
            onDismiss={() => { setAuthExpired(false); setRefreshError(""); }}
            loading={refreshLoading}
            error={refreshError}
          />
        )}

        {/* Body */}
        <div className="flex min-h-0 flex-1">

          {/* Sidebar */}
          {phase === "chat" && (
            <Sidebar
              sessions={sessions}
              activeId={activeSessionId}
              onSelect={loadSession}
              onNew={startNewChat}
              onDelete={deleteSession}
              onRename={renameSession}
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed((v) => !v)}
            />
          )}

          {/* Main */}
          <div className="flex min-h-0 flex-1 flex-col">
            {phase === "connect" && <ConnectScreen onConnect={handleManualConnect} />}
            {phase === "chat" && (
              <>
                <div className="min-h-0 flex-1 overflow-auto">
                  {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-6 px-4 py-16 text-center">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#aaf345] shadow-[0_0_40px_rgba(24,119,242,0.25)]">
                        <FacebookIcon size={26} color="white" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold">How can I help with your ads?</h2>
                        <p className="mt-1.5 text-sm text-muted-foreground">
                          Connected to <span className="font-medium text-foreground">{selectedAccount?.name}</span>
                        </p>
                      </div>
                      <div className="flex max-w-lg flex-wrap justify-center gap-2">
                        {SUGGESTIONS.map((s) => (
                          <button key={s} type="button"
                            onClick={() => { setInput(s); inputRef.current?.focus(); }}
                            className="rounded-full border border-border/60 bg-muted/30 px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground">
                            {s}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                          <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                        </svg>
                        <span>Attach images for image ads — or skip to create text/link ads without images</span>
                      </div>
                    </div>
                  ) : (
                    <div className="mx-auto w-full max-w-3xl divide-y divide-border/20">
                      {messages.map((msg) =>
                        msg.role === "user"
                          ? <UserMessage key={msg.id} msg={msg} />
                          : <AssistantMessage key={msg.id} msg={msg} />
                      )}
                      <div ref={bottomRef} />
                    </div>
                  )}
                </div>

                {/* Input area */}
                <div className="shrink-0 border-t border-border/50 px-4 py-4 md:px-6" onDragOver={handleDragOver} onDrop={handleDrop}>
                  <div className="mx-auto w-full max-w-3xl">

                    {attachedImages.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {attachedImages.map((img, i) => (
                          <ImagePill key={i} img={img} onRemove={() => removeImage(i)} />
                        ))}
                      </div>
                    )}

                    <div className="relative flex items-end rounded-xl border border-border/60 bg-muted/20 shadow-sm transition-colors focus-within:border-border focus-within:bg-background">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={loading}
                        title="Attach image for ad creation"
                        className="mb-2 ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                        </svg>
                      </button>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        multiple
                        className="hidden"
                        onChange={handleFileInputChange}
                      />

                      <Input
                        ref={inputRef}
                        placeholder={authExpired ? "Refresh your token above to continue…" : attachedImages.length > 0 ? "Describe how to use this image for an ad…" : "Message Meta Ads AI…"}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKey}
                        onPaste={handlePaste}
                        disabled={loading}
                        className="flex-1 border-0 bg-transparent px-3 py-3 text-sm shadow-none placeholder:text-muted-foreground/50 focus-visible:ring-0"
                      />

                      <button onClick={sendMessage} disabled={!canSend}
                        className="mb-2 mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#aaf345] text-white shadow-sm transition-all hover:bg-[#1565d8] disabled:cursor-not-allowed disabled:opacity-30">
                        {loading ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 2L11 13" /><path d="M22 2L15 22 11 13 2 9l20-7z" />
                          </svg>
                        )}
                      </button>
                    </div>
                    <p className="mt-2 text-center text-[11px] text-muted-foreground/50">
                      Actions are executed immediately · Image ads: attach JPG/PNG/GIF/WebP (max 4 MB) · Text/link ads: no image needed
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export function MetaAdsChat({ embedded = false }: { embedded?: boolean }) {
  return <Suspense><MetaAdsChatInner embedded={embedded} /></Suspense>;
}

export default function MetaAdsChatPage() {
  return <MetaAdsChat />;
}