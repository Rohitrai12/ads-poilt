"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps?: Step[];
  pending?: boolean;
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
  list_ads: "⬡", update_ad_status: "◉", list_custom_audiences: "⬡",
  create_custom_audience: "◆", create_lookalike_audience: "◆",
};

const STATUS_LABELS: Record<number, string> = {
  1: "Active", 2: "Disabled", 3: "Unsettled", 7: "Pending review",
  8: "Pending closure", 9: "In grace period", 101: "Temporarily unavailable", 201: "Closed",
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
      <div className="max-w-[75%] rounded-2xl bg-zinc-800 px-4 py-3 text-sm leading-7 text-white shadow-sm dark:bg-zinc-700">{msg.content}</div>
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
      {/* Header */}
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
        /* Collapsed mode */
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
        /* Expanded mode */
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
                        {/* Fade + actions overlay */}
                        <div className="flex items-start gap-1">
                          <span className="flex-1 min-w-0 truncate text-xs leading-5">{session.title}</span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground/40">{formatRelativeTime(session.updatedAt)}</div>

                        {/* Hover action buttons */}
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

// ─── Connect + Account Picker screens ────────────────────────────────────────

function ConnectScreen({ error }: { error: string }) {
  const [loading, setLoading] = useState(false);
  const handleConnect = () => {
    const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
    if (!appId) { alert("NEXT_PUBLIC_FACEBOOK_APP_ID is not set"); return; }
    setLoading(true);
    const redirectUri = encodeURIComponent(`${window.location.origin}/api/auth/facebook/callback`);
    const scope = encodeURIComponent("ads_management,ads_read,business_management");
    window.location.href = `https://www.facebook.com/v25.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code`;
  };
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#aaf345] shadow-[0_0_60px_rgba(24,119,242,0.3)]">
        <FacebookIcon size={32} color="white" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold">Connect your Meta Ads account</h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">Manage campaigns, budgets, audiences, and performance — all through natural language.</p>
      </div>
      <Card className="w-full max-w-sm border-border/60">
        <CardHeader className="pb-3"><CardTitle className="text-sm">Permissions requested</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {[["ads_management","Create and edit campaigns, ad sets, ads"],["ads_read","View performance insights and reporting"],["business_management","Access your ad accounts"]].map(([perm,desc]) => (
            <div key={perm} className="flex items-start gap-2">
              <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
              <div><span className="font-mono text-xs text-foreground">{perm}</span><span className="text-xs text-muted-foreground"> — {desc}</span></div>
            </div>
          ))}
        </CardContent>
      </Card>
      {error && <div className="w-full max-w-sm rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-center font-mono text-xs text-destructive">Auth error: {error}</div>}
      <Button size="lg" onClick={handleConnect} disabled={loading} className="gap-2 bg-[#aaf345] hover:bg-[#1565d8]">
        <FacebookIcon size={16} color="white" />{loading ? "Redirecting…" : "Continue with Facebook"}
      </Button>
    </div>
  );
}

function AccountPicker({ accounts, onSelect }: { accounts: AdAccount[]; onSelect: (a: AdAccount) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <div className="w-full max-w-md">
        <h2 className="text-lg font-semibold">Select an ad account</h2>
        <p className="mt-1 text-sm text-muted-foreground">{accounts.length} account{accounts.length !== 1 ? "s" : ""} found</p>
      </div>
      <div className="flex w-full max-w-md flex-col gap-2">
        {accounts.map((acct) => {
          const isActive = acct.account_status === 1;
          return (
            <button key={acct.id} onClick={() => isActive && onSelect(acct)} disabled={!isActive}
              className="w-full rounded-lg border border-border/60 bg-card px-4 py-3 text-left transition-all hover:border-primary/50 hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-40">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{acct.name}</span>
                <Badge variant={isActive ? "secondary" : "destructive"} className="font-mono text-[10px]">{STATUS_LABELS[acct.account_status] ?? "Unknown"}</Badge>
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">{acct.currency} · {acct.timezone_name} · ID: {acct.id.replace("act_","")}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Animation styles ─────────────────────────────────────────────────────────

const ANIMATION_STYLES = `
  @keyframes fadeSlideIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  @keyframes bounce { 0%,80%,100%{transform:scale(0.6);opacity:0.4} 40%{transform:scale(1);opacity:1} }
`;

// ─── Main Component ───────────────────────────────────────────────────────────

function MetaAdsChatInner({ embedded = false }: { embedded?: boolean }) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<"connect" | "pick" | "chat">("connect");
  const [accessToken, setAccessToken] = useState("");
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<AdAccount | null>(null);
  const [authError, setAuthError] = useState("");

  // History
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load sessions
  useEffect(() => {
    if (typeof window !== "undefined") setSessions(loadSessions());
  }, []);

  // Persist sessions
  useEffect(() => {
    if (typeof window !== "undefined") saveSessions(sessions);
  }, [sessions]);

  // Rehydrate auth
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (searchParams.get("fb_token") || searchParams.get("fb_accounts")) return;
    try {
      const raw = window.localStorage.getItem(LS_AUTH);
      if (!raw) return;
      const saved: { accessToken: string; accounts: AdAccount[]; selectedAccount?: AdAccount | null } = JSON.parse(raw);
      if (!saved.accessToken || !saved.accounts?.length) return;
      setAccessToken(saved.accessToken); setAccounts(saved.accounts);
      if (saved.selectedAccount) { setSelectedAccount(saved.selectedAccount); setPhase("chat"); }
      else { setPhase(saved.accounts.length === 1 ? "chat" : "pick"); if (saved.accounts.length === 1) setSelectedAccount(saved.accounts[0]); }
    } catch { /* ignore */ }
  }, [searchParams]);

  // OAuth callback
  useEffect(() => {
    const token = searchParams.get("fb_token");
    const acctJson = searchParams.get("fb_accounts");
    const error = searchParams.get("fb_error");
    if (error) { setAuthError(decodeURIComponent(error)); router.replace("/dashboard/chat"); return; }
    if (token && acctJson) {
      try {
        const parsed: AdAccount[] = JSON.parse(acctJson);
        setAccessToken(token); setAccounts(parsed);
        if (parsed.length === 1 && parsed[0].account_status === 1) { setSelectedAccount(parsed[0]); setPhase("chat"); }
        else setPhase("pick");
      } catch { setAuthError("Failed to parse account data"); }
      router.replace("/dashboard/chat");
    }
  }, [searchParams, router]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleAccountSelect = (acct: AdAccount) => {
    setSelectedAccount(acct); setPhase("chat");
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const disconnect = () => {
    setAccessToken(""); setSelectedAccount(null); setAccounts([]); setMessages([]);
    setPhase("connect"); setActiveSessionId(null);
    if (typeof window !== "undefined") window.localStorage.removeItem(LS_AUTH);
  };

  // ── Session management ────────────────────────────────────────────────────

  const startNewChat = useCallback(() => {
    setMessages([]); setActiveSessionId(null);
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
    if (!input.trim() || loading || !accessToken || !selectedAccount) return;

    const adAccountId = selectedAccount.id.replace("act_", "");
    const userMsg: Message = { id: uid(), role: "user", content: input.trim() };
    const assistantMsg: Message = { id: uid(), role: "assistant", content: "", steps: [], pending: true };

    const historyForApi = [
      ...messages.map((m) => ({
        role: m.role,
        content: m.role === "assistant"
          ? m.steps?.filter((s) => s.type === "text").map((s) => s.text).join("\n") || m.content
          : m.content,
      })),
      { role: "user", content: input.trim() },
    ];

    const newMessages = [...messages, userMsg, assistantMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    // Create session on first message
    const isFirst = messages.length === 0;
    const sessionId = activeSessionId ?? uid();
    if (isFirst || !activeSessionId) {
      setActiveSessionId(sessionId);
      const title = input.trim().slice(0, 60) + (input.trim().length > 60 ? "…" : "");
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
  }, [input, loading, accessToken, selectedAccount, messages, activeSessionId]);

  useEffect(() => {
    if (typeof window === "undefined" || !accessToken || !accounts.length) return;
    window.localStorage.setItem(LS_AUTH, JSON.stringify({ accessToken, accounts, selectedAccount }));
  }, [accessToken, accounts, selectedAccount]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const SUGGESTIONS = [
    "Show all my campaigns and their budgets",
    "Which campaign has the best ROAS last 30 days?",
    "Show ad sets for my best campaign",
    "Pause all underperforming campaigns",
    "Increase budget of my best campaign by 20%",
    "List my custom audiences",
  ];

  const accountSessions = selectedAccount
    ? sessions.filter((s) => s.accountId === selectedAccount.id)
    : sessions;

  return (
    <>
      <style>{ANIMATION_STYLES}</style>
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
                <Badge variant="secondary" className="hidden gap-1.5 font-mono text-[10px] sm:flex">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />{selectedAccount.name}
                </Badge>
                <Button variant="ghost" size="sm" onClick={disconnect} className="text-xs text-muted-foreground hover:text-foreground">Disconnect</Button>
              </>
            ) : (
              <Badge variant="outline" className="font-mono text-[10px]">
                {phase === "connect" ? "NOT CONNECTED" : "SELECTING ACCOUNT"}
              </Badge>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1">

          {/* Sidebar */}
          {phase === "chat" && (
            <Sidebar
              sessions={accountSessions}
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
            {phase === "connect" && <ConnectScreen error={authError} />}
            {phase === "pick" && <AccountPicker accounts={accounts} onSelect={handleAccountSelect} />}

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

                <div className="shrink-0 border-t border-border/50 px-4 py-4 md:px-6">
                  <div className="mx-auto w-full max-w-3xl">
                    <div className="relative flex items-end rounded-xl border border-border/60 bg-muted/20 shadow-sm transition-colors focus-within:border-border focus-within:bg-background">
                      <Input
                        ref={inputRef}
                        placeholder="Message Meta Ads AI…"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKey}
                        disabled={loading}
                        className="flex-1 border-0 bg-transparent px-4 py-3 text-sm shadow-none placeholder:text-muted-foreground/50 focus-visible:ring-0"
                      />
                      <button onClick={sendMessage} disabled={loading || !input.trim()}
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
                      Actions are executed immediately against your live account.
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