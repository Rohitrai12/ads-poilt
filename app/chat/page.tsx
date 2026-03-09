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

// ─── Step components ──────────────────────────────────────────────────────────

function ToolCallStep({ step }: { step: Step }) {
  const icon = TOOL_ICONS[step.tool ?? ""] ?? "◆";
  return (
    <div className="flex items-start gap-2 text-xs text-muted-foreground">
      <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
        {icon} {step.tool ?? "tool"}
      </Badge>
      <div className="min-w-0 whitespace-pre-wrap break-words">{step.text}</div>
    </div>
  );
}

function ToolResultStep({ step }: { step: Step }) {
  const icon = TOOL_ICONS[step.tool ?? ""] ?? "◆";
  const isError = step.text.startsWith("Error");
  return (
    <div className="flex items-start gap-2 text-xs">
      <Badge
        variant={isError ? "destructive" : "secondary"}
        className="shrink-0 font-mono text-[10px]"
      >
        {isError ? "✗" : icon} {step.tool ?? "result"}
      </Badge>
      <div className={"min-w-0 whitespace-pre-wrap break-words " + (isError ? "text-destructive" : "text-muted-foreground")}>
        {step.text}
      </div>
    </div>
  );
}

function TextStep({ step }: { step: Step }) {
  return <div className="whitespace-pre-wrap text-sm text-foreground">{step.text}</div>;
}

function AssistantMessage({ msg }: { msg: Message }) {
  const steps = msg.steps ?? [];
  const textSteps = steps.filter((s) => s.type === "text");
  const actionSteps = steps.filter((s) => s.type === "tool_call" || s.type === "tool_result");
  const errorSteps = steps.filter((s) => s.type === "error");

  return (
    <div className="max-w-[52rem]">
      <Card className="border-border/60">
        <CardHeader className="space-y-1 py-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono text-[10px]">META ADS AI</Badge>
            {msg.pending && <Badge variant="outline" className="font-mono text-[10px]">PROCESSING</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {actionSteps.length > 0 && (
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              {actionSteps.map((step, i) =>
                step.type === "tool_call"
                  ? <ToolCallStep key={i} step={step} />
                  : <ToolResultStep key={i} step={step} />
              )}
            </div>
          )}
          {textSteps.length > 0 && (
            <div className="space-y-2">
              {textSteps.map((step, i) => <TextStep key={i} step={step} />)}
            </div>
          )}
          {errorSteps.map((step, i) => (
            <div key={i} className="text-sm text-destructive">{step.text}</div>
          ))}
          {msg.pending && steps.length === 0 && (
            <div className="text-sm text-muted-foreground">
              Thinking<span className="animate-pulse">…</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UserMessage({ msg }: { msg: Message }) {
  return (
    <div className="ml-auto max-w-[52rem]">
      <Card className="border-border/60 bg-primary text-primary-foreground">
        <CardHeader className="space-y-1 py-3">
          <Badge className="w-fit font-mono text-[10px]">YOU</Badge>
        </CardHeader>
        <CardContent className="whitespace-pre-wrap text-sm">{msg.content}</CardContent>
      </Card>
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
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#1877f2] shadow-[0_0_60px_rgba(24,119,242,0.3)]">
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

      <Button size="lg" onClick={handleConnect} disabled={loading} className="gap-2 bg-[#1877f2] hover:bg-[#1565d8]">
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

  // Rehydrate from localStorage so we don't ask every time
  useEffect(() => {
    if (typeof window === "undefined") return;
    // If URL params are present, let the OAuth handler below take precedence.
    if (searchParams.get("fb_token") || searchParams.get("fb_accounts")) return;
    try {
      const raw = window.localStorage.getItem("meta_ads_auth");
      if (!raw) return;
      const saved: {
        accessToken: string;
        accounts: AdAccount[];
        selectedAccount?: AdAccount | null;
      } = JSON.parse(raw);
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
    } catch {
      // ignore
    }
  }, [searchParams]);

  // Handle OAuth callback params ─────────────────────────────────────────────
  useEffect(() => {
    const token = searchParams.get("fb_token");
    const acctJson = searchParams.get("fb_accounts");
    const error = searchParams.get("fb_error");

    if (error) {
      setAuthError(decodeURIComponent(error));
      router.replace("/dashboard/chat");
      return;
    }

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
      } catch {
        setAuthError("Failed to parse account data from Facebook");
      }
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
    setAccessToken("");
    setSelectedAccount(null);
    setAccounts([]);
    setMessages([]);
    setPhase("connect");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("meta_ads_auth");
    }
  };

  // Send message ─────────────────────────────────────────────────────────────
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
          } catch { /* ignore malformed */ }
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

  // Persist auth to localStorage whenever it changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!accessToken || !accounts.length) return;
    const payload = {
      accessToken,
      accounts,
      selectedAccount,
    };
    window.localStorage.setItem("meta_ads_auth", JSON.stringify(payload));
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
    <div className={"flex min-h-0 flex-col bg-background text-foreground " + (embedded ? "flex-1" : "h-[100svh]")}>

      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 md:px-6">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">Meta Ads AI</div>
          <div className="truncate text-xs text-muted-foreground">Conversational campaign manager</div>
        </div>
        <div className="flex items-center gap-2">
          {phase === "chat" && selectedAccount ? (
            <>
              <Badge variant="secondary" className="hidden gap-1.5 font-mono text-[10px] sm:flex">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                {selectedAccount.name}
              </Badge>
              <Button variant="outline" size="sm" onClick={disconnect}>
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
      <Separator />

      {/* Connect screen */}
      {phase === "connect" && <ConnectScreen error={authError} />}

      {/* Account picker */}
      {phase === "pick" && <AccountPicker accounts={accounts} onSelect={handleAccountSelect} />}

      {/* Chat */}
      {phase === "chat" && (
        <>
          <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
            {messages.length === 0 ? (
              <Card className="border-border/60">
                <CardHeader>
                  <CardTitle className="text-base">
                    Ready to manage your ads
                  </CardTitle>
                  <CardDescription>
                    Connected to <strong>{selectedAccount?.name}</strong>. Ask anything about your campaigns, ad sets, or audiences.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm font-medium">Try one of these</div>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                      <Button
                        key={s}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => { setInput(s); inputRef.current?.focus(); }}
                      >
                        {s}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="mx-auto flex w-full max-w-[52rem] flex-col gap-4">
                {messages.map((msg) =>
                  msg.role === "user"
                    ? <UserMessage key={msg.id} msg={msg} />
                    : <AssistantMessage key={msg.id} msg={msg} />
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <Separator />
          <div className="px-4 py-4 md:px-6">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Input
                  ref={inputRef}
                  placeholder="Ask about your campaigns…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  disabled={loading}
                />
                <Button onClick={sendMessage} disabled={loading || !input.trim()}>
                  {loading ? "Running…" : "Send"}
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Press Enter to send. Actions are executed immediately against your live account.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
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