"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  MetaAccountPicker,
  type MetaAdAccount,
  type MetaPage,
  type MetaPixel,
  type MetaSelection,
} from "@/components/MetaAccountPicker";

// ─── Rate limit config ────────────────────────────────────────────────────────
const COOLDOWN_SECONDS = 10;

// ─── Types ────────────────────────────────────────────────────────────────────
type StepType = "text" | "tool_call" | "tool_result" | "error" | "done";
type Platform = "meta" | "google";

type Step = {
  type: StepType;
  text: string;
  tool?: string;
  platform?: Platform;
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
  // For API calls we store the structured content blocks separately
  apiContent?: Array<{ type: string; [key: string]: unknown }>;
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
};

type MetaAccount = {
  id: string;
  name: string;
  currency: string;
  account_status: number;
};

type GoogleAccount = {
  id: string;
  name: string;
  currency_code: string;
  is_manager: boolean;
};

type MetaCreds = {
  accessToken: string;
  adAccountId: string;
  account: MetaAccount;
  page: MetaPage | null;
  pixel: MetaPixel | null;
} | null;

type GoogleCreds = {
  accessToken: string;
  customerId: string;
  account: GoogleAccount;
} | null;

type MetaPending = {
  accessToken: string;
  adAccounts: MetaAdAccount[];
  pages: MetaPage[];
  pixels: MetaPixel[];
} | null;

// ─── OAuth / API config ───────────────────────────────────────────────────────
const FB_APP_ID = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID ?? "";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const META_API_VER = "v25.0";

function redirectToFb() {
  if (!FB_APP_ID) return;
  const state = Math.random().toString(36).slice(2);
  sessionStorage.setItem("fb_oauth_state", state);
  const ru = encodeURIComponent(`${window.location.origin}/api/auth/facebook/callback`);
  window.location.href =
    `https://www.facebook.com/dialog/oauth?client_id=${FB_APP_ID}` +
    `&redirect_uri=${ru}` +
    `&scope=${encodeURIComponent("ads_management,ads_read,business_management,pages_show_list")}` +
    `&state=${state}&response_type=code`;
}

function redirectToGoogle() {
  if (!GOOGLE_CLIENT_ID) return;
  const state = Math.random().toString(36).slice(2);
  sessionStorage.setItem("google_oauth_state", state);
  const ru = encodeURIComponent(`${window.location.origin}/api/auth/google/callback`);
  window.location.href =
    `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${ru}` +
    `&scope=${encodeURIComponent("https://www.googleapis.com/auth/adwords")}` +
    `&state=${state}&response_type=code&access_type=offline&prompt=consent`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function groupSessions(sessions: ChatSession[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const buckets: Record<string, ChatSession[]> = {
    Today: [], Yesterday: [], "This week": [], Older: [],
  };
  for (const s of sessions) {
    const d = new Date(s.updatedAt);
    d.setHours(0, 0, 0, 0);
    if (d >= today) buckets.Today.push(s);
    else if (d >= yesterday) buckets.Yesterday.push(s);
    else if (Date.now() - s.updatedAt < 7 * 86_400_000) buckets["This week"].push(s);
    else buckets.Older.push(s);
  }
  return Object.entries(buckets)
    .filter(([, v]) => v.length > 0)
    .map(([label, sessions]) => ({ label, sessions }));
}

const LS_SESSIONS = "unified_ads_sessions";
const LS_META_AUTH = "unified_ads_meta_auth";
const LS_GOOGLE_AUTH = "unified_ads_google_auth";

function loadSessions(): ChatSession[] {
  try { return JSON.parse(localStorage.getItem(LS_SESSIONS) ?? "[]"); }
  catch { return []; }
}
function saveSessions(s: ChatSession[]) {
  try { localStorage.setItem(LS_SESSIONS, JSON.stringify(s)); } catch { /**/ }
}

// ─── Platform icons ───────────────────────────────────────────────────────────
function MetaIcon({ size = 16, mono }: { size?: number; mono?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={mono ? "currentColor" : "white"}>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function GoogleAdsIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path fill="#FBBC04" d="M3.68 14.87l5.69-9.86a2.87 2.87 0 0 1 4.95 2.87L8.63 17.74A2.87 2.87 0 0 1 3.68 14.87z" />
      <path fill="#4285F4" d="M20.32 14.87a2.87 2.87 0 0 1-4.95 2.87l-.95-1.64 2.47-4.28.95 1.64a2.87 2.87 0 0 1 2.48 1.41z" />
      <circle fill="#34A853" cx="6.16" cy="16.37" r="2.87" />
    </svg>
  );
}

function PlatformBadge({ platform }: { platform: Platform }) {
  return platform === "meta" ? (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold bg-[#1877f2]/15 text-[#1877f2]">
      <MetaIcon size={8} mono /> META
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold bg-[#4285F4]/15 text-[#4285F4]">
      <GoogleAdsIcon size={8} /> GOOGLE
    </span>
  );
}

// ─── Countdown ring ───────────────────────────────────────────────────────────
function CountdownRing({ seconds, total }: { seconds: number; total: number }) {
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - seconds / total);
  return (
    <div className="relative flex items-center justify-center" style={{ width: 28, height: 28 }}>
      <svg width="28" height="28" viewBox="0 0 28 28" className="-rotate-90">
        <circle cx="14" cy="14" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2.5" />
        <circle cx="14" cy="14" r={radius} fill="none" stroke="url(#cooldownGrad)" strokeWidth="2.5"
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={dashOffset}
          style={{ transition: "stroke-dashoffset 1s linear" }} />
        <defs>
          <linearGradient id="cooldownGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#1877f2" />
            <stop offset="100%" stopColor="#4285F4" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute text-[9px] font-bold tabular-nums" style={{ color: "#4285F4" }}>{seconds}</span>
    </div>
  );
}

// ─── Markdown renderer ────────────────────────────────────────────────────────
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let last = 0; let match: RegExpExecArray | null; let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[2]) parts.push(<strong key={key++} className="font-semibold">{match[2]}</strong>);
    else if (match[3]) parts.push(<em key={key++}>{match[3]}</em>);
    else if (match[4]) parts.push(<code key={key++} className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-zinc-200">{match[4]}</code>);
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
  | { type: "code_block"; code: string }
  | { type: "paragraph"; text: string };

function parseMarkdown(raw: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = raw.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const code: string[] = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
      blocks.push({ type: "code_block", code: code.join("\n") }); i++; continue;
    }
    if (i + 1 < lines.length && /^\s*\|?[\s-:]+\|/.test(lines[i + 1])) {
      const pr = (l: string) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const headers = pr(lines[i]); const rows: string[][] = []; i += 2;
      while (i < lines.length && lines[i].includes("|")) { rows.push(pr(lines[i])); i++; }
      blocks.push({ type: "table", headers, rows }); continue;
    }
    const hm = line.match(/^(#{1,6})\s+(.+)$/);
    if (hm) { blocks.push({ type: "heading", level: hm[1].length, text: hm[2] }); i++; continue; }
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
    const pLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|[-*+]\s|\d+\.\s|```|[-*_]{3,})/.test(lines[i])) {
      pLines.push(lines[i]); i++;
    }
    if (pLines.length) blocks.push({ type: "paragraph", text: pLines.join("\n") });
  }
  return blocks;
}

function TypingCursor() {
  return <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[1px] animate-[blink_1s_step-start_infinite] bg-current align-middle" />;
}

function MarkdownRenderer({ text, isPending }: { text: string; isPending?: boolean }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="space-y-3 text-sm leading-7 text-zinc-100">
      {blocks.map((block, bi) => {
        const isLast = bi === blocks.length - 1;
        if (block.type === "table") return (
          <div key={bi} className="overflow-x-auto rounded-lg border border-zinc-700/60">
            <table className="w-full border-collapse text-xs">
              <thead><tr className="border-b border-zinc-700 bg-zinc-800/60">
                {block.headers.map((h, hi) => <th key={hi} className="px-3 py-2 text-left font-semibold text-zinc-300">{renderInline(h)}</th>)}
              </tr></thead>
              <tbody>{block.rows.map((row, ri) => (
                <tr key={ri} className="border-b border-zinc-800/60 last:border-0 hover:bg-zinc-800/30">
                  {row.map((cell, ci) => <td key={ci} className="px-3 py-2 text-zinc-400">{renderInline(cell)}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
        );
        if (block.type === "heading") {
          const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
          const sizes: Record<number, string> = { 1: "text-xl font-bold", 2: "text-lg font-semibold", 3: "text-base font-semibold", 4: "text-sm font-semibold", 5: "text-sm font-medium", 6: "text-xs font-medium" };
          return <Tag key={bi} className={`${sizes[block.level] ?? ""} text-zinc-100`}>{renderInline(block.text)}</Tag>;
        }
        if (block.type === "hr") return <hr key={bi} className="border-zinc-700/50" />;
        if (block.type === "ul") return (
          <ul key={bi} className="space-y-1 pl-5">
            {block.items.map((it, ii) => <li key={ii} className="list-disc text-zinc-200 marker:text-zinc-600">{renderInline(it)}</li>)}
          </ul>
        );
        if (block.type === "ol") return (
          <ol key={bi} className="space-y-1 pl-5">
            {block.items.map((it, ii) => <li key={ii} className="list-decimal text-zinc-200 marker:text-zinc-600">{renderInline(it)}</li>)}
          </ol>
        );
        if (block.type === "code_block") return (
          <pre key={bi} className="overflow-x-auto rounded-lg border border-zinc-700/50 bg-zinc-900 px-4 py-3 font-mono text-xs text-zinc-300">
            <code>{block.code}</code>
          </pre>
        );
        return (
          <p key={bi} className="text-zinc-200">
            {renderInline(block.text)}
            {isPending && isLast && <TypingCursor />}
          </p>
        );
      })}
      {isPending && blocks.length === 0 && <TypingCursor />}
    </div>
  );
}

// ─── Tool steps ───────────────────────────────────────────────────────────────
function ToolSteps({ steps, pending }: { steps: Step[]; pending?: boolean }) {
  const [open, setOpen] = useState(Boolean(pending));
  const actionSteps = steps.filter((s) => s.type === "tool_call" || s.type === "tool_result");
  const hasError = actionSteps.some((s) => s.type === "tool_result" && s.text.startsWith("Error"));
  const platforms = [...new Set(actionSteps.filter((s) => s.platform).map((s) => s.platform as Platform))];
  const callCount = actionSteps.filter((s) => s.type === "tool_call").length;
  const isWorking = !!pending;
  const label = hasError ? "Tool error" : isWorking ? "Working on it"
    : actionSteps.length ? `${platforms.length > 0 ? platforms.map((p) => (p === "meta" ? "Meta" : "Google")).join(" + ") : "Tools"} · ${callCount} calls`
    : "Tools";

  useEffect(() => { if (pending) setOpen(true); }, [pending]);
  if (!actionSteps.length && !pending) return null;

  return (
    <div className="mb-3 overflow-hidden rounded-2xl border border-zinc-800/70 bg-zinc-900/60 shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur-sm">
      <button type="button" onClick={() => { if (!pending) setOpen((v) => !v); }} aria-expanded={open}
        className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors ${pending ? "cursor-default" : "hover:bg-zinc-800/40"}`}>
        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${hasError ? "border-red-500/40 bg-red-500/10 text-red-400" : isWorking ? "border-[#1877f2]/30 bg-[#1877f2]/10 text-[#60a5fa]" : "border-zinc-700 bg-zinc-800/60 text-zinc-500"}`}>
            {isWorking ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <span style={{ transform: open ? "rotate(90deg)" : "none", display: "inline-block", transition: "transform 0.15s" }}>▶</span>
            )}
          </span>
          <div className="min-w-0">
            <div className={`truncate text-xs font-semibold ${hasError ? "text-red-400" : isWorking ? "text-zinc-100" : "text-zinc-300"}`}>{label}</div>
            <div className="truncate text-[10px] text-zinc-500">
              {isWorking ? "Gathering data and executing tools…" : hasError ? "One or more tool calls failed"
                : actionSteps.length > 0 ? `${callCount} tool call${callCount === 1 ? "" : "s"}` : "No tool activity yet"}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {platforms.map((p) => <PlatformBadge key={p} platform={p} />)}
        </div>
      </button>

      {open && (
        <div className="border-t border-zinc-800/60 px-3 py-3 text-xs">
          {isWorking && (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-[#1877f2]/20 bg-[#1877f2]/10 px-3 py-2 text-[11px] text-zinc-200">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#60a5fa]/60 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#60a5fa]" />
              </span>
              <span>Working on it…</span>
            </div>
          )}
          <div className="space-y-2.5">
            {actionSteps.map((step, i) => {
              const isResult = step.type === "tool_result";
              const isError = isResult && step.text.startsWith("Error");
              return (
                <div key={i} className="flex items-start gap-2.5 rounded-lg bg-zinc-950/30 px-2.5 py-2">
                  {step.platform && <PlatformBadge platform={step.platform} />}
                  <span className={`shrink-0 font-mono ${isError ? "text-red-400" : isResult ? "text-emerald-500" : "text-zinc-500"}`}>
                    {isResult ? (isError ? "✗" : "✓") : "→"}
                  </span>
                  <span className={`font-mono shrink-0 text-[10px] ${isError ? "text-red-400" : isResult ? "text-zinc-400" : step.platform === "meta" ? "text-[#1877f2]" : "text-[#4285F4]"}`}>
                    {step.tool ?? (isResult ? "result" : "tool")}
                  </span>
                  <span className={`min-w-0 break-words leading-relaxed ${isError ? "text-red-400" : "text-zinc-400"}`}>{step.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Message components ───────────────────────────────────────────────────────
function AIAvatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1877f2] to-[#4285F4] shadow-[0_0_16px_rgba(66,133,244,0.4)]">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    </div>
  );
}

function UserAvatar() {
  return <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-xs font-bold text-zinc-200">U</div>;
}

function ImagePill({ img, onRemove }: { img: AttachedImage; onRemove?: () => void }) {
  return (
    <div className="group relative flex items-center gap-2 rounded-lg border border-zinc-700/60 bg-zinc-800/50 p-1.5 pr-2.5">
      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-zinc-700/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.dataUrl} alt={img.filename} className="h-full w-full object-cover" />
      </div>
      <div className="min-w-0">
        <div className="max-w-[120px] truncate text-[11px] font-medium text-zinc-300">{img.filename}</div>
        <div className="text-[10px] text-zinc-500">{img.sizeLabel}</div>
      </div>
      {onRemove && (
        <button onClick={onRemove}
          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-600 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-500">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

function AssistantMessage({ msg }: { msg: Message }) {
  const textSteps = (msg.steps ?? []).filter((s) => s.type === "text");
  const errorSteps = (msg.steps ?? []).filter((s) => s.type === "error");
  return (
    <div className="flex w-full gap-4 px-4 py-5" style={{ animation: "fadeIn .2s ease-out" }}>
      <AIAvatar />
      <div className="min-w-0 flex-1 pt-0.5">
        <ToolSteps steps={msg.steps ?? []} pending={msg.pending} />
        {textSteps.length > 0 ? (
          <MarkdownRenderer text={textSteps.map((s) => s.text).join("\n")} isPending={msg.pending} />
        ) : msg.pending ? (
          <div className="flex gap-1 pt-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-2 w-2 rounded-full bg-zinc-600"
                style={{ animation: `bounce 1.4s ease-in-out ${i * 0.16}s infinite` }} />
            ))}
          </div>
        ) : null}
        {errorSteps.map((s, i) => (
          <div key={i} className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{s.text}</div>
        ))}
      </div>
    </div>
  );
}

function UserMessage({ msg }: { msg: Message }) {
  return (
    <div className="flex w-full justify-end gap-4 px-4 py-5" style={{ animation: "fadeIn .15s ease-out" }}>
      <div className="max-w-[75%] space-y-2">
        {msg.images && msg.images.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {msg.images.map((img, i) => <ImagePill key={i} img={img} />)}
          </div>
        )}
        {msg.content && (
          <div className="rounded-2xl bg-zinc-700/80 px-4 py-3 text-sm leading-7 text-zinc-100 shadow-sm">{msg.content}</div>
        )}
      </div>
      <UserAvatar />
    </div>
  );
}

// ─── Connection Panel ─────────────────────────────────────────────────────────
function ConnectionPanel({
  metaCreds, googleCreds, onConnectMeta, onConnectGoogle, onDisconnectMeta, onDisconnectGoogle,
}: {
  metaCreds: MetaCreds; googleCreds: GoogleCreds;
  onConnectMeta: (token: string, accountId: string, account: MetaAccount) => void;
  onConnectGoogle: (token: string, customerId: string, account: GoogleAccount) => void;
  onDisconnectMeta: () => void; onDisconnectGoogle: () => void;
}) {
  const [metaToken, setMetaToken] = useState("");
  const [metaAcctId, setMetaAcctId] = useState("");
  const [googleToken, setGoogleToken] = useState("");
  const [googleCustId, setGoogleCustId] = useState("");
  const [metaLoading, setMetaLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [metaError, setMetaError] = useState("");
  const [googleError, setGoogleError] = useState("");

  const connectMetaManual = async () => {
    const tok = metaToken.trim();
    const id = metaAcctId.trim().replace(/^act_/i, "");
    if (!tok || !id) { setMetaError("Token and Account ID required."); return; }
    setMetaLoading(true); setMetaError("");
    try {
      const res = await fetch(`https://graph.facebook.com/${META_API_VER}/act_${id}?fields=id,name,account_status,currency&access_token=${encodeURIComponent(tok)}`);
      const data = await res.json();
      if (data.error) { setMetaError(data.error.message ?? "Invalid credentials."); return; }
      onConnectMeta(tok, id, data as MetaAccount);
      setMetaToken(""); setMetaAcctId("");
    } catch { setMetaError("Network error."); }
    finally { setMetaLoading(false); }
  };

  const connectGoogleManual = async () => {
    const tok = googleToken.trim();
    const id = googleCustId.trim().replace(/-/g, "");
    if (!tok || !id) { setGoogleError("Token and Customer ID required."); return; }
    setGoogleLoading(true); setGoogleError("");
    try {
      const res = await fetch(`https://googleads.googleapis.com/v18/customers/${id}?fields=id,descriptiveName,currencyCode,manager`, {
        headers: { Authorization: `Bearer ${tok}`, "developer-token": "" },
      });
      const data = await res.json();
      if (data.error) { setGoogleError(data.error.message ?? "Invalid credentials."); return; }
      onConnectGoogle(tok, id, { id, name: data.descriptiveName ?? `Account ${id}`, currency_code: data.currencyCode ?? "USD", is_manager: data.manager ?? false });
      setGoogleToken(""); setGoogleCustId("");
    } catch { setGoogleError("Network error."); }
    finally { setGoogleLoading(false); }
  };

  return (
    <div className="space-y-4">
      {/* Meta */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1877f2]"><MetaIcon size={14} /></div>
            <span className="text-sm font-semibold text-zinc-200">Meta Ads</span>
            {metaCreds && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Connected
              </span>
            )}
          </div>
          {metaCreds ? (
            <button onClick={onDisconnectMeta} className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">Disconnect</button>
          ) : FB_APP_ID && (
            <button onClick={redirectToFb} className="flex items-center gap-1.5 rounded-lg bg-[#1877f2] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#166fe5] transition-colors">
              <MetaIcon size={11} /> OAuth
            </button>
          )}
        </div>
        {metaCreds ? (
          <div className="rounded-lg bg-zinc-800/50 px-3 py-2.5 text-xs space-y-1">
            <div className="font-medium text-zinc-300">{metaCreds.account.name}</div>
            <div className="text-zinc-500">act_{metaCreds.adAccountId} · {metaCreds.account.currency}</div>
            {metaCreds.page && (
              <div className="flex items-center gap-1 text-zinc-500">
                <span className="text-zinc-700">Page:</span>
                <span>{metaCreds.page.name}</span>
                <span className="text-zinc-700">({metaCreds.page.id})</span>
              </div>
            )}
            {!metaCreds.page && (
              <div className="text-amber-500/80 text-[10px]">⚠ No page selected — needed for creating ads</div>
            )}
            {metaCreds.pixel && (
              <div className="flex items-center gap-1 text-zinc-500">
                <span className="text-zinc-700">Pixel:</span>
                <span>{metaCreds.pixel.name}</span>
                <span className="text-zinc-700">({metaCreds.pixel.id})</span>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <Input type="password" placeholder="Access token (EAAxx…)" value={metaToken} onChange={(e) => setMetaToken(e.target.value)}
              className="h-8 bg-zinc-800/60 border-zinc-700 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus-visible:border-[#1877f2]/50 focus-visible:ring-0" />
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-zinc-500">act_</span>
                <Input placeholder="Account ID" value={metaAcctId.replace(/^act_/i, "")} onChange={(e) => setMetaAcctId(e.target.value)}
                  className="h-8 pl-9 bg-zinc-800/60 border-zinc-700 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus-visible:border-[#1877f2]/50 focus-visible:ring-0" />
              </div>
              <button onClick={connectMetaManual} disabled={metaLoading || !metaToken.trim() || !metaAcctId.trim()}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-[#1877f2] px-3 text-[11px] font-semibold text-white hover:bg-[#166fe5] disabled:opacity-40 transition-colors whitespace-nowrap">
                {metaLoading && <svg width="11" height="11" className="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>}
                Connect
              </button>
            </div>
            {metaError && <p className="text-[10px] text-red-400">{metaError}</p>}
          </div>
        )}
      </div>

      {/* Google */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-700 bg-white"><GoogleAdsIcon size={16} /></div>
            <span className="text-sm font-semibold text-zinc-200">Google Ads</span>
            {googleCreds && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Connected
              </span>
            )}
          </div>
          {googleCreds ? (
            <button onClick={onDisconnectGoogle} className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">Disconnect</button>
          ) : GOOGLE_CLIENT_ID && (
            <button onClick={redirectToGoogle} className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 transition-colors">
              <svg width="11" height="11" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              OAuth
            </button>
          )}
        </div>
        {googleCreds ? (
          <div className="rounded-lg bg-zinc-800/50 px-3 py-2.5 text-xs">
            <div className="font-medium text-zinc-300">{googleCreds.account.name}</div>
            <div className="text-zinc-500">{googleCreds.customerId} · {googleCreds.account.currency_code}{googleCreds.account.is_manager && " · MCC"}</div>
          </div>
        ) : (
          <div className="space-y-2">
            <Input type="password" placeholder="Access token (ya29.…)" value={googleToken} onChange={(e) => setGoogleToken(e.target.value)}
              className="h-8 bg-zinc-800/60 border-zinc-700 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus-visible:border-[#4285F4]/50 focus-visible:ring-0" />
            <div className="flex gap-2">
              <Input placeholder="Customer ID (no dashes)" value={googleCustId} onChange={(e) => setGoogleCustId(e.target.value.replace(/-/g, ""))}
                className="h-8 flex-1 bg-zinc-800/60 border-zinc-700 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus-visible:border-[#4285F4]/50 focus-visible:ring-0" />
              <button onClick={connectGoogleManual} disabled={googleLoading || !googleToken.trim() || !googleCustId.trim()}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-[#4285F4] px-3 text-[11px] font-semibold text-white hover:bg-[#3367d6] disabled:opacity-40 transition-colors whitespace-nowrap">
                {googleLoading && <svg width="11" height="11" className="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>}
                Connect
              </button>
            </div>
            {googleError && <p className="text-[10px] text-red-400">{googleError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({
  sessions, activeId, onSelect, onNew, onDelete,
  metaCreds, googleCreds, onConnectMeta, onConnectGoogle, onDisconnectMeta, onDisconnectGoogle,
  collapsed, onToggle,
}: {
  sessions: ChatSession[]; activeId: string | null;
  onSelect: (id: string) => void; onNew: () => void; onDelete: (id: string) => void;
  metaCreds: MetaCreds; googleCreds: GoogleCreds;
  onConnectMeta: (t: string, a: string, acct: MetaAccount) => void;
  onConnectGoogle: (t: string, c: string, acct: GoogleAccount) => void;
  onDisconnectMeta: () => void; onDisconnectGoogle: () => void;
  collapsed: boolean; onToggle: () => void;
}) {
  const groups = groupSessions(sessions);
  return (
    <div className="flex flex-col border-r border-zinc-800/60 bg-zinc-950 transition-all duration-300 shrink-0 overflow-hidden"
      style={{ width: collapsed ? "52px" : "280px", minWidth: collapsed ? "52px" : "280px" }}>
      <div className={`flex items-center border-b border-zinc-800/60 px-3 py-3 ${collapsed ? "justify-center" : "justify-between"}`}>
        {!collapsed && <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Ads Manager AI</span>}
        <div className="flex items-center gap-1">
          {!collapsed && (
            <button onClick={onNew} title="New chat" className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300 transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          )}
          <button onClick={onToggle} className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300 transition-colors">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {collapsed ? <path d="M9 18l6-6-6-6" /> : <path d="M15 18l-6-6 6-6" />}
            </svg>
          </button>
        </div>
      </div>

      {collapsed ? (
        <div className="flex flex-col items-center gap-1.5 overflow-y-auto py-3">
          <button onClick={onNew} className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <div className="my-1 h-px w-6 bg-zinc-800" />
          {sessions.slice(0, 12).map((s) => (
            <button key={s.id} onClick={() => onSelect(s.id)} title={s.title}
              className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold transition-colors ${s.id === activeId ? "bg-gradient-to-br from-[#1877f2]/20 to-[#4285F4]/20 text-blue-400" : "text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"}`}>
              {s.title.charAt(0).toUpperCase()}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-zinc-800/60 px-3 py-3">
            <ConnectionPanel metaCreds={metaCreds} googleCreds={googleCreds}
              onConnectMeta={onConnectMeta} onConnectGoogle={onConnectGoogle}
              onDisconnectMeta={onDisconnectMeta} onDisconnectGoogle={onDisconnectGoogle} />
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {groups.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-zinc-600">No conversations yet</div>
            ) : groups.map((group) => (
              <div key={group.label} className="mb-1">
                <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-700">{group.label}</div>
                {group.sessions.map((session) => (
                  <div key={session.id} className="group/item relative mx-1">
                    <button onClick={() => onSelect(session.id)}
                      className={`relative w-full rounded-lg px-3 py-2 text-left transition-colors ${session.id === activeId ? "bg-zinc-800 text-zinc-200" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"}`}>
                      <div className="truncate text-xs leading-5">{session.title}</div>
                      <div className="text-[9px] text-zinc-700">{formatRelativeTime(session.updatedAt)}</div>
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover/item:flex">
                        <span role="button" onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
                          className="flex h-6 w-6 items-center justify-center rounded text-zinc-600 hover:bg-red-500/10 hover:text-red-400 transition-colors">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" />
                          </svg>
                        </span>
                      </div>
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Suggestion chips ─────────────────────────────────────────────────────────
const BOTH_SUGGESTIONS = [
  "Compare Meta vs Google performance last 30 days",
  "Show all my campaigns across both platforms",
  "Which platform has better ROAS?",
  "Pause underperforming campaigns on both platforms",
];
const META_SUGGESTIONS = ["Show Meta campaigns", "Meta ad insights (last 30 days)", "List Meta ad sets"];
const GOOGLE_SUGGESTIONS = ["Show Google campaigns", "Google Ads metrics last 30 days", "Search terms report"];

// ─── Animations ───────────────────────────────────────────────────────────────
const ANIM = `
@keyframes fadeIn  { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:translateY(0)} }
@keyframes bounce  { 0%,80%,100%{transform:scale(.6);opacity:.4} 40%{transform:scale(1);opacity:1} }
@keyframes blink   { 0%,100%{opacity:1} 50%{opacity:0} }
`;

// ─── Main component ───────────────────────────────────────────────────────────
function UnifiedAdsChatInner() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [metaCreds, setMetaCreds] = useState<MetaCreds>(null);
  const [googleCreds, setGoogleCreds] = useState<GoogleCreds>(null);
  const [metaPending, setMetaPending] = useState<MetaPending>(null);

  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSentAtRef = useRef<number>(0);

  const startCooldown = useCallback(() => {
    setCooldownRemaining(COOLDOWN_SECONDS);
    lastSentAtRef.current = Date.now();
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    cooldownTimerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastSentAtRef.current) / 1000);
      const remaining = Math.max(0, COOLDOWN_SECONDS - elapsed);
      setCooldownRemaining(remaining);
      if (remaining === 0) { clearInterval(cooldownTimerRef.current!); cooldownTimerRef.current = null; }
    }, 250);
  }, []);

  useEffect(() => { return () => { if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current); }; }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isCoolingDown = cooldownRemaining > 0;

  useEffect(() => { if (typeof window !== "undefined") setSessions(loadSessions()); }, []);
  useEffect(() => { if (typeof window !== "undefined") saveSessions(sessions); }, [sessions]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try { const m = localStorage.getItem(LS_META_AUTH); if (m) setMetaCreds(JSON.parse(m)); } catch { /**/ }
    try { const g = localStorage.getItem(LS_GOOGLE_AUTH); if (g) setGoogleCreds(JSON.parse(g)); } catch { /**/ }

    const params = new URLSearchParams(window.location.search);
    const fbPending = params.get("fb_pending_selection");
    const fbDataRaw = params.get("fb_data");
    if (fbPending === "1" && fbDataRaw) {
      try { setMetaPending(JSON.parse(decodeURIComponent(fbDataRaw)) as MetaPending); } catch { /**/ }
    }
    const gToken = params.get("g_token");
    const gAccounts = params.get("g_accounts");
    if (gToken) {
      try {
        const accounts: GoogleAccount[] = JSON.parse(decodeURIComponent(gAccounts ?? "[]"));
        if (accounts[0]) {
          const creds = { accessToken: gToken, customerId: accounts[0].id, account: accounts[0] };
          setGoogleCreds(creds);
          localStorage.setItem(LS_GOOGLE_AUTH, JSON.stringify(creds));
        }
      } catch { /**/ }
    }
    if (fbPending || gToken || params.get("fb_error") || params.get("g_error")) {
      const clean = new URL(window.location.href);
      ["fb_pending_selection", "fb_data", "fb_error", "g_token", "g_accounts", "g_error"].forEach((k) => clean.searchParams.delete(k));
      window.history.replaceState({}, "", clean.pathname + (clean.search !== "?" ? clean.search : ""));
    }
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const connectMetaManual = useCallback((token: string, accountId: string, account: MetaAccount) => {
    const creds: NonNullable<MetaCreds> = { accessToken: token, adAccountId: accountId, account, page: null, pixel: null };
    setMetaCreds(creds);
    try { localStorage.setItem(LS_META_AUTH, JSON.stringify(creds)); } catch { /**/ }
  }, []);

  const handleMetaPickerConfirm = useCallback((selection: MetaSelection) => {
    const id = selection.adAccount.id.replace(/^act_/, "");
    const creds: NonNullable<MetaCreds> = {
      accessToken: selection.accessToken,
      adAccountId: id,
      account: { id: selection.adAccount.id, name: selection.adAccount.name, currency: selection.adAccount.currency, account_status: selection.adAccount.account_status },
      page: selection.page,
      pixel: selection.pixel,
    };
    setMetaCreds(creds);
    setMetaPending(null);
    try { localStorage.setItem(LS_META_AUTH, JSON.stringify(creds)); } catch { /**/ }
  }, []);

  const connectGoogle = useCallback((token: string, customerId: string, account: GoogleAccount) => {
    const creds = { accessToken: token, customerId, account };
    setGoogleCreds(creds);
    try { localStorage.setItem(LS_GOOGLE_AUTH, JSON.stringify(creds)); } catch { /**/ }
  }, []);

  const disconnectMeta = useCallback(() => { setMetaCreds(null); try { localStorage.removeItem(LS_META_AUTH); } catch { /**/ } }, []);
  const disconnectGoogle = useCallback(() => { setGoogleCreds(null); try { localStorage.removeItem(LS_GOOGLE_AUTH); } catch { /**/ } }, []);

  const handleImageFiles = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 4 * 1024 * 1024) { alert(`${file.name} exceeds 4 MB`); continue; }
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setAttachedImages((prev) => [...prev, {
          filename: file.name,
          base64: dataUrl.split(",")[1] ?? "",
          dataUrl,
          // FIX: Extract MIME from the data URL header instead of trusting
          // file.type — browsers sometimes report wrong type (e.g. image/jpeg
          // for a PNG dragged from certain apps), which causes Claude API 400.
          mimeType: dataUrl.split(";")[0].split(":")[1] ?? file.type,
          sizeLabel: formatBytes(file.size),
        }]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); handleImageFiles(e.dataTransfer.files); };
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.items).filter((i) => i.type.startsWith("image/"));
    if (!imgs.length) return;
    e.preventDefault();
    handleImageFiles(imgs.map((i) => i.getAsFile()).filter(Boolean) as File[]);
  }, [handleImageFiles]);

  const startNewChat = useCallback(() => {
    setMessages([]); setActiveSessionId(null); setAttachedImages([]);
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);
  const loadSession = useCallback((id: string) => {
    const s = sessions.find((s) => s.id === id);
    if (s) { setMessages(s.messages); setActiveSessionId(id); }
  }, [sessions]);
  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) { setMessages([]); setActiveSessionId(null); }
  }, [activeSessionId]);

  const isConnected = !!(metaCreds || googleCreds);

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const hasText = input.trim().length > 0;
    const hasImages = attachedImages.length > 0;
    if ((!hasText && !hasImages) || loading || !isConnected || isCoolingDown) return;

    let richContent = input.trim();
    if (hasImages && !hasText) {
      richContent = `I'm attaching ${attachedImages.length} image${attachedImages.length > 1 ? "s" : ""} to use for creating a Meta ad.`;
    }

    // ── Build structured content blocks for the API ────────────────────────
    // Images are sent as proper base64 image blocks so Claude can see and use them.
    const apiContentBlocks: Array<{ type: string; [key: string]: unknown }> = [];
    if (hasImages) {
      for (const img of attachedImages) {
        apiContentBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: img.mimeType,
            data: img.base64, // raw base64, no data: prefix
          },
        });
      }
    }
    apiContentBlocks.push({ type: "text", text: richContent });

    const userMsg: Message = {
      id: uid(),
      role: "user",
      content: richContent,
      // Store structured API content separately for history replay
      apiContent: apiContentBlocks,
      images: hasImages ? [...attachedImages] : undefined,
    };
    const assistantMsg: Message = { id: uid(), role: "assistant", content: "", steps: [], pending: true };

    // Build history for the API — use stored apiContent for user messages if available
    const historyForApi = [
      ...messages.map((m) => ({
        role: m.role,
        content: m.role === "user"
          ? (m.apiContent ?? m.content)  // use structured blocks if available, else plain text
          : m.steps?.filter((s) => s.type === "text").map((s) => s.text).join("\n") || m.content,
      })),
      { role: "user", content: apiContentBlocks },
    ];

    const newMessages = [...messages, userMsg, assistantMsg];
    setMessages(newMessages);
    setInput("");
    setAttachedImages([]);
    setLoading(true);
    startCooldown();

    const sessionId = activeSessionId ?? uid();
    if (!activeSessionId) {
      setActiveSessionId(sessionId);
      const title = richContent.slice(0, 60) + (richContent.length > 60 ? "…" : "");
      setSessions((prev) => [{
        id: sessionId, title, messages: newMessages, createdAt: Date.now(), updatedAt: Date.now(),
      }, ...prev.filter((s) => s.id !== sessionId)]);
    }

    try {
      const body: Record<string, unknown> = { messages: historyForApi };
      if (metaCreds) {
        body.meta = {
          accessToken: metaCreds.accessToken,
          adAccountId: metaCreds.adAccountId,
          pageId: metaCreds.page?.id ?? null,
          pixelId: metaCreds.pixel?.id ?? null,
        };
      }
      if (googleCreds) {
        body.google = { accessToken: googleCreds.accessToken, customerId: googleCreds.customerId };
      }

      const res = await fetch("/api/adsChat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
            setMessages((prev) => {
              const updated = prev.map((m) =>
                m.id === assistantMsg.id
                  ? {
                      ...m,
                      steps: [...(m.steps ?? []), step],
                      content: step.type === "text" ? (m.content ? m.content + "\n" : "") + step.text : m.content,
                    }
                  : m,
              );
              setSessions((ps) => ps.map((s) => s.id === sessionId ? { ...s, messages: updated, updatedAt: Date.now() } : s));
              return updated;
            });
          } catch { /**/ }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, steps: [...(m.steps ?? []), { type: "error" as StepType, text: "Connection error: " + String(err) }] }
            : m,
        );
        setSessions((ps) => ps.map((s) => s.id === sessionId ? { ...s, messages: updated, updatedAt: Date.now() } : s));
        return updated;
      });
    } finally {
      setMessages((prev) => {
        const f = prev.map((m) => m.id === assistantMsg.id ? { ...m, pending: false } : m);
        setSessions((ps) => ps.map((s) => s.id === sessionId ? { ...s, messages: f, updatedAt: Date.now() } : s));
        return f;
      });
      setLoading(false);
      textareaRef.current?.focus();
    }
  }, [input, attachedImages, loading, isConnected, isCoolingDown, messages, activeSessionId, metaCreds, googleCreds, startCooldown]);

  const handleComposerResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, []);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); }
  };

  const suggestions = metaCreds && googleCreds ? BOTH_SUGGESTIONS : metaCreds ? META_SUGGESTIONS : GOOGLE_SUGGESTIONS;
  const sendDisabled = (!input.trim() && attachedImages.length === 0) || loading || !isConnected || isCoolingDown;

  return (
    <>
      <style>{ANIM}</style>
      <div className="flex h-[100svh] flex-col bg-zinc-950 text-zinc-100">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800/60 bg-zinc-950 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#1877f2] to-[#4285F4] shadow-[0_0_20px_rgba(66,133,244,0.3)]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-bold leading-tight text-zinc-100">Ads Manager AI</div>
              <div className="text-[10px] text-zinc-600 leading-tight">Meta + Google unified</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {metaCreds && (
              <Badge className="hidden gap-1.5 border-[#1877f2]/30 bg-[#1877f2]/10 text-[#1877f2] text-[10px] sm:flex">
                <MetaIcon size={8} mono /> {metaCreds.account.name}
              </Badge>
            )}
            {googleCreds && (
              <Badge className="hidden gap-1.5 border-[#4285F4]/30 bg-[#4285F4]/10 text-[#4285F4] text-[10px] sm:flex">
                <GoogleAdsIcon size={8} /> {googleCreds.account.name}
              </Badge>
            )}
            {!metaCreds && !googleCreds && (
              <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-600">NOT CONNECTED</Badge>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          <Sidebar sessions={sessions} activeId={activeSessionId} onSelect={loadSession} onNew={startNewChat} onDelete={deleteSession}
            metaCreds={metaCreds} googleCreds={googleCreds}
            onConnectMeta={connectMetaManual} onConnectGoogle={connectGoogle}
            onDisconnectMeta={disconnectMeta} onDisconnectGoogle={disconnectGoogle}
            collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((v) => !v)} />

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-auto">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-6 px-4 py-16 text-center">
                  <div className="relative">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#1877f2] to-[#4285F4] shadow-[0_0_60px_rgba(66,133,244,0.3)]">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                    </div>
                    <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-zinc-800 bg-zinc-950">
                      <div className="flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-r from-[#1877f2] to-[#4285F4]">
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="white"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                      </div>
                    </div>
                  </div>
                  {!isConnected ? (
                    <div>
                      <h2 className="text-lg font-bold text-zinc-200">Connect your ad platforms</h2>
                      <p className="mt-1.5 max-w-xs text-sm text-zinc-500">Use the sidebar to connect Meta Ads and/or Google Ads, then start chatting.</p>
                    </div>
                  ) : (
                    <>
                      <div>
                        <h2 className="text-lg font-bold text-zinc-200">How can I help with your ads?</h2>
                        <div className="mt-2 flex items-center justify-center gap-2">
                          {metaCreds && (
                            <span className="flex items-center gap-1.5 rounded-full bg-[#1877f2]/10 px-3 py-1 text-[11px] font-semibold text-[#1877f2]">
                              <MetaIcon size={10} mono /> {metaCreds.account.name}
                            </span>
                          )}
                          {metaCreds && googleCreds && <span className="text-zinc-700">+</span>}
                          {googleCreds && (
                            <span className="flex items-center gap-1.5 rounded-full bg-[#4285F4]/10 px-3 py-1 text-[11px] font-semibold text-[#4285F4]">
                              <GoogleAdsIcon size={10} /> {googleCreds.account.name}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex max-w-lg flex-wrap justify-center gap-2">
                        {suggestions.map((s) => (
                          <button key={s} onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                            className="rounded-full border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-xs text-zinc-400 transition-all hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-200">
                            {s}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="mx-auto w-full max-w-3xl divide-y divide-zinc-800/40">
                  {messages.map((msg) =>
                    msg.role === "user" ? <UserMessage key={msg.id} msg={msg} /> : <AssistantMessage key={msg.id} msg={msg} />
                  )}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>

            {/* Input area */}
            <div className="shrink-0 border-t border-zinc-800/60 bg-zinc-950 px-4 py-4" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
              <div className="mx-auto w-full max-w-3xl">
                {attachedImages.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {attachedImages.map((img, i) => (
                      <ImagePill key={i} img={img} onRemove={() => setAttachedImages((prev) => prev.filter((_, idx) => idx !== i))} />
                    ))}
                  </div>
                )}

                {isCoolingDown && !loading && (
                  <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2" style={{ animation: "fadeIn 0.2s ease-out" }}>
                    <CountdownRing seconds={cooldownRemaining} total={COOLDOWN_SECONDS} />
                    <div className="flex flex-col">
                      <span className="text-[11px] font-semibold text-zinc-300">Next message in {cooldownRemaining}s</span>
                      <span className="text-[10px] text-zinc-600">Cooldown prevents accidental rapid requests</span>
                    </div>
                  </div>
                )}

                <div className={`rounded-2xl border bg-zinc-900/85 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] backdrop-blur-sm transition-colors ${isCoolingDown && !loading ? "border-zinc-700/80 opacity-75" : "border-zinc-800 focus-within:border-zinc-700"}`}>
                  <div className="flex items-end gap-2 px-3 py-3">
                    {metaCreds && (
                      <button onClick={() => fileInputRef.current?.click()} disabled={loading || isCoolingDown} title="Attach image (Meta ad)"
                        className="mb-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/40 text-zinc-500 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-[#1877f2] disabled:opacity-30">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                        </svg>
                      </button>
                    )}
                    <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
                      onChange={(e) => { if (e.target.files?.length) handleImageFiles(e.target.files); e.target.value = ""; }} />
                    <div className="min-w-0 flex-1">
                      <textarea ref={textareaRef} rows={1}
                        placeholder={
                          isCoolingDown && !loading ? `Wait ${cooldownRemaining}s before sending next message…`
                          : !isConnected ? "Connect a platform in the sidebar first…"
                          : loading ? "Thinking…"
                          : metaCreds && googleCreds ? "Ask about Meta + Google Ads, compare platforms, manage campaigns…"
                          : metaCreds ? "Ask about Meta Ads campaigns, ad sets, ads… or attach an image to create an image ad"
                          : "Ask about Google Ads campaigns, keywords, metrics…"
                        }
                        value={input}
                        onChange={(e) => { setInput(e.target.value); handleComposerResize(e.currentTarget); }}
                        onInput={(e) => handleComposerResize(e.currentTarget)}
                        onKeyDown={handleKey} onPaste={handlePaste}
                        disabled={loading || !isConnected}
                        className="max-h-[180px] min-h-[52px] w-full resize-none border-0 bg-transparent px-1 py-1.5 text-sm leading-6 text-zinc-100 shadow-none outline-none placeholder:text-zinc-600 focus:ring-0 disabled:cursor-not-allowed" />
                      <div className="mt-1 flex items-center justify-between gap-2 px-1 pb-0.5 text-[10px] text-zinc-600">
                        <span className="truncate">
                          {loading ? "Generating response…"
                          : isCoolingDown ? `Next send available in ${cooldownRemaining}s`
                          : "Enter to send · Shift+Enter for a new line"}
                        </span>
                        {input.trim().length > 0 && <span className="shrink-0 tabular-nums text-zinc-500">{input.length} chars</span>}
                      </div>
                    </div>
                    <button onClick={sendMessage} disabled={sendDisabled}
                      className="mb-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#1877f2] to-[#4285F4] text-white shadow-sm transition-all hover:shadow-[0_0_12px_rgba(66,133,244,0.5)] disabled:opacity-30"
                      title={isCoolingDown ? `Wait ${cooldownRemaining}s` : "Send message"}>
                      {loading ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                      ) : isCoolingDown ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      ) : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 2L11 13" /><path d="M22 2L15 22 11 13 2 9l20-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-center text-[10px] text-zinc-700">
                  {metaCreds && googleCreds ? "Both platforms connected · " : ""}
                  Actions execute immediately · Meta budgets in cents · Google budgets in micros
                  {isCoolingDown && !loading && <span className="ml-1 text-zinc-600">· Cooldown active</span>}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {metaPending && (
        <MetaAccountPicker
          accessToken={metaPending.accessToken}
          adAccounts={metaPending.adAccounts}
          pages={metaPending.pages}
          pixels={metaPending.pixels}
          onConfirm={handleMetaPickerConfirm}
          onCancel={() => setMetaPending(null)} />
      )}
    </>
  );
}

export function UnifiedAdsChat() {
  return <Suspense><UnifiedAdsChatInner /></Suspense>;
}

export default function UnifiedAdsChatPage() {
  return <UnifiedAdsChat />;
}