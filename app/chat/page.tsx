"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

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

type AdAccount = {
  id: string;
  name: string;
  account_status: number;
  currency: string;
  timezone_name: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2);

const TOOL_ICONS: Record<string, string> = {
  list_campaigns: "⬡",
  get_campaign: "◈",
  get_campaign_insights: "◈",
  create_campaign: "◆",
  update_campaign_budget: "◎",
  update_campaign_status: "◉",
  update_campaign_objective: "◎",
  delete_campaign: "⚠",
  bulk_update_campaign_status: "◉",
  list_adsets: "⬡",
  create_adset: "◆",
  update_adset_targeting: "◎",
  update_adset_budget: "◎",
  update_adset_status: "◉",
  get_adset_insights: "◈",
  list_ads: "⬡",
  update_ad_status: "◉",
  list_custom_audiences: "⬡",
  create_custom_audience: "◆",
  create_lookalike_audience: "◆",
};

const STATUS_LABELS: Record<number, string> = {
  1: "Active", 2: "Disabled", 3: "Unsettled", 7: "Pending review",
  8: "Pending closure", 9: "In grace period", 101: "Temporarily unavailable", 201: "Closed",
};

// ─── Avatars ──────────────────────────────────────────────────────────────────

function AIAvatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#aaf345] shadow-[0_0_12px_rgba(24,119,242,0.4)]">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-xs font-semibold text-white">
      U
    </div>
  );
}

// ─── Typing cursor ────────────────────────────────────────────────────────────

function TypingCursor() {
  return (
    <span
      className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[1px] bg-current align-middle"
      style={{ animation: "blink 1s step-start infinite" }}
    />
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
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        <span
          className="inline-block transition-transform duration-200"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▶
        </span>
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
                <span className={`font-mono shrink-0 ${isError ? "text-destructive" : "text-muted-foreground"}`}>
                  {isResult ? (isError ? "✗" : "✓") : icon}
                </span>
                <span className={`font-mono shrink-0 ${isError ? "text-destructive" : "text-blue-400"}`}>
                  {step.tool ?? (isResult ? "result" : "tool")}
                </span>
                <span className={`min-w-0 whitespace-pre-wrap break-words leading-relaxed ${isError ? "text-destructive" : "text-muted-foreground"}`}>
                  {step.text}
                </span>
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
  const hasText = textSteps.length > 0;

  return (
    <div
      className="group flex w-full gap-4 px-4 py-5 transition-colors"
      style={{ animation: "fadeSlideIn 0.2s ease-out" }}
    >
      <AIAvatar />
      <div className="min-w-0 flex-1 pt-0.5">
        <ToolSteps steps={steps} />

        {hasText ? (
          <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none">
            {textSteps.map((step, i) => (
              <div key={i} className="whitespace-pre-wrap text-sm leading-7 text-foreground">
                {step.text}
                {msg.pending && i === textSteps.length - 1 && <TypingCursor />}
              </div>
            ))}
          </div>
        ) : msg.pending ? (
          <div className="flex items-center gap-1 pt-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-2 w-2 rounded-full bg-muted-foreground/50"
                style={{
                  animation: "bounce 1.4s ease-in-out infinite",
                  animationDelay: `${i * 0.16}s`,
                }}
              />
            ))}
          </div>
        ) : null}

        {errorSteps.map((step, i) => (
          <div key={i} className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {step.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function UserMessage({ msg }: { msg: Message }) {
  return (
    <div
      className="flex w-full justify-end gap-4 px-4 py-5"
      style={{ animation: "fadeSlideIn 0.15s ease-out" }}
    >
      <div className="max-w-[75%] rounded-2xl bg-zinc-800 px-4 py-3 text-sm leading-7 text-white shadow-sm dark:bg-zinc-700">
        {msg.content}
      </div>
      <UserAvatar />
    </div>
  );
}

// ─── Facebook Connect Screen ──────────────────────────────────────────────────

function ConnectScreen({ error }: { error: string }) {
  const [loading, setLoading] = useState(false);

  const handleConnect = () => {
    const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
    if (!appId) {
      alert("NEXT_PUBLIC_FACEBOOK_APP_ID is not set in .env.local");
      return;
    }
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
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Manage campaigns, budgets, audiences, and performance — all through natural language conversation.
        </p>
      </div>

      <Card className="w-full max-w-sm border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Permissions requested</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            ["ads_management", "Create and edit campaigns, ad sets, ads"],
            ["ads_read", "View performance insights and reporting"],
            ["business_management", "Access your ad accounts"],
          ].map(([perm, desc]) => (
            <div key={perm} className="flex items-start gap-2">
              <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
              <div>
                <span className="font-mono text-xs text-foreground">{perm}</span>
                <span className="text-xs text-muted-foreground"> — {desc}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {error && (
        <div className="w-full max-w-sm rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-center font-mono text-xs text-destructive">
          Auth error: {error}
        </div>
      )}

      <Button size="lg" onClick={handleConnect} disabled={loading} className="gap-2 bg-[#aaf345] hover:bg-[#1565d8]">
        <FacebookIcon size={16} color="white" />
        {loading ? "Redirecting…" : "Continue with Facebook"}
      </Button>

      <p className="max-w-xs text-center font-mono text-[10px] text-muted-foreground">
        Requires <code>NEXT_PUBLIC_FACEBOOK_APP_ID</code>, <code>FACEBOOK_APP_ID</code>, and <code>FACEBOOK_APP_SECRET</code> in .env.local
      </p>
    </div>
  );
}

// ─── Account Picker ───────────────────────────────────────────────────────────

function AccountPicker({ accounts, onSelect }: { accounts: AdAccount[]; onSelect: (a: AdAccount) => void }) {
  const active = accounts.filter((a) => a.account_status === 1);
  const inactive = accounts.filter((a) => a.account_status !== 1);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <div className="w-full max-w-md">
        <h2 className="text-lg font-semibold">Select an ad account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {accounts.length} account{accounts.length !== 1 ? "s" : ""} found on your Facebook profile
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-2">
        {[...active, ...inactive].map((acct) => {
          const numericId = acct.id.replace("act_", "");
          const isActive = acct.account_status === 1;
          return (
            <button
              key={acct.id}
              onClick={() => isActive && onSelect(acct)}
              disabled={!isActive}
              className="group w-full rounded-lg border border-border/60 bg-card px-4 py-3 text-left transition-all hover:border-primary/50 hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{acct.name}</span>
                <Badge
                  variant={isActive ? "secondary" : "destructive"}
                  className="font-mono text-[10px]"
                >
                  {STATUS_LABELS[acct.account_status] ?? "Unknown"}
                </Badge>
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                {acct.currency} · {acct.timezone_name} · ID: {numericId}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Facebook SVG icon ────────────────────────────────────────────────────────

function FacebookIcon({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

// ─── Inline styles for animations ─────────────────────────────────────────────

const ANIMATION_STYLES = `
  @keyframes fadeSlideIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
  }
  @keyframes bounce {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
    40%           { transform: scale(1);   opacity: 1;   }
  }
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

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Rehydrate from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (searchParams.get("fb_token") || searchParams.get("fb_accounts")) return;
    try {
      const raw = window.localStorage.getItem("meta_ads_auth");
      if (!raw) return;
      const saved: { accessToken: string; accounts: AdAccount[]; selectedAccount?: AdAccount | null } = JSON.parse(raw);
      if (!saved.accessToken || !saved.accounts?.length) return;
      setAccessToken(saved.accessToken);
      setAccounts(saved.accounts);
      if (saved.selectedAccount) {
        setSelectedAccount(saved.selectedAccount);
        setPhase("chat");
      } else {
        setPhase(saved.accounts.length === 1 ? "chat" : "pick");
        if (saved.accounts.length === 1) setSelectedAccount(saved.accounts[0]);
      }
    } catch { /* ignore */ }
  }, [searchParams]);

  // Handle OAuth callback
  useEffect(() => {
    const token = searchParams.get("fb_token");
    const acctJson = searchParams.get("fb_accounts");
    const error = searchParams.get("fb_error");

    if (error) { setAuthError(decodeURIComponent(error)); router.replace("/dashboard/chat"); return; }

    if (token && acctJson) {
      try {
        const parsed: AdAccount[] = JSON.parse(acctJson);
        setAccessToken(token);
        setAccounts(parsed);
        if (parsed.length === 1 && parsed[0].account_status === 1) {
          setSelectedAccount(parsed[0]);
          setPhase("chat");
        } else {
          setPhase("pick");
        }
      } catch { setAuthError("Failed to parse account data from Facebook"); }
      router.replace("/dashboard/chat");
    }
  }, [searchParams, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleAccountSelect = (acct: AdAccount) => {
    setSelectedAccount(acct);
    setPhase("chat");
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const disconnect = () => {
    setAccessToken(""); setSelectedAccount(null); setAccounts([]); setMessages([]); setPhase("connect");
    if (typeof window !== "undefined") window.localStorage.removeItem("meta_ads_auth");
  };

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

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setLoading(true);

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
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const step: Step = JSON.parse(line);
            if (step.type === "done") continue;
            setMessages((prev) => prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, steps: [...(m.steps ?? []), step], content: step.type === "text" ? (m.content ? m.content + "\n" : "") + step.text : m.content }
                : m
            ));
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setMessages((prev) => prev.map((m) =>
        m.id === assistantMsg.id
          ? { ...m, steps: [...(m.steps ?? []), { type: "error", text: "Connection error: " + String(err) }] }
          : m
      ));
    } finally {
      setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, pending: false } : m));
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, accessToken, selectedAccount, messages]);

  useEffect(() => {
    if (typeof window === "undefined" || !accessToken || !accounts.length) return;
    window.localStorage.setItem("meta_ads_auth", JSON.stringify({ accessToken, accounts, selectedAccount }));
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

  return (
    <>
      <style>{ANIMATION_STYLES}</style>

      <div className={"flex min-h-0 flex-col bg-background text-foreground " + (embedded ? "flex-1" : "h-[100svh]")}>

        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-3 md:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#aaf345]">
              <FacebookIcon size={14} color="white" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-tight">Meta Ads AI</div>
              <div className="truncate text-[11px] text-muted-foreground leading-tight">Conversational campaign manager</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {phase === "chat" && selectedAccount ? (
              <>
                <Badge variant="secondary" className="hidden gap-1.5 font-mono text-[10px] sm:flex">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                  {selectedAccount.name}
                </Badge>
                <Button variant="ghost" size="sm" onClick={disconnect} className="text-xs text-muted-foreground hover:text-foreground">
                  Disconnect
                </Button>
              </>
            ) : (
              <Badge variant="outline" className="font-mono text-[10px]">
                {phase === "connect" ? "NOT CONNECTED" : "SELECTING ACCOUNT"}
              </Badge>
            )}
          </div>
        </div>

        {/* Connect screen */}
        {phase === "connect" && <ConnectScreen error={authError} />}

        {/* Account picker */}
        {phase === "pick" && <AccountPicker accounts={accounts} onSelect={handleAccountSelect} />}

        {/* Chat */}
        {phase === "chat" && (
          <>
            {/* Messages */}
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
                  <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => { setInput(s); inputRef.current?.focus(); }}
                        className="rounded-full border border-border/60 bg-muted/30 px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
                      >
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

            {/* Input */}
            <div className="border-t border-border/50 px-4 py-4 md:px-6">
              <div className="mx-auto w-full max-w-3xl">
                <div className="relative flex items-end gap-0 rounded-xl border border-border/60 bg-muted/20 shadow-sm transition-colors focus-within:border-border focus-within:bg-background">
                  <Input
                    ref={inputRef}
                    placeholder="Message Meta Ads AI…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKey}
                    disabled={loading}
                    className="flex-1 border-0 bg-transparent px-4 py-3 shadow-none focus-visible:ring-0 text-sm placeholder:text-muted-foreground/50"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={loading || !input.trim()}
                    className="mr-2 mb-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#aaf345] text-white shadow-sm transition-all hover:bg-[#1565d8] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 2L11 13" />
                        <path d="M22 2L15 22 11 13 2 9l20-7z" />
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
    </>
  );
}

export function MetaAdsChat({ embedded = false }: { embedded?: boolean }) {
  return (
    <Suspense>
      <MetaAdsChatInner embedded={embedded} />
    </Suspense>
  );
}

export default function MetaAdsChatPage() {
  return <MetaAdsChat />;
}