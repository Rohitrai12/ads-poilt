"use client";

import { useEffect, useState } from "react";
import { IconTrendingDown, IconTrendingUp, IconMinus } from "@tabler/icons-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CardData {
  label: string;
  value: string;
  trend: number;        // percentage change, e.g. +12.5 or -8.0
  trendLabel: string;
  subLabel: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE = "https://graph.facebook.com/v25.0";

function safeParseJSON(text: string): unknown {
  const safe = text.replace(/:(\s*)(-?\d{16,})([,\}\]])/g, (_m, sp, n, tail) => `:"${n}"${tail}`);
  return JSON.parse(safe);
}

async function metaGet(path: string, token: string): Promise<Record<string, unknown>> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${path}${sep}access_token=${token}`);
  return safeParseJSON(await res.text()) as Record<string, unknown>;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function fmtMoney(cents: number, currency: string): string {
  const amount = cents / 100;
  if (amount >= 1_000_000) return currency + (amount / 1_000_000).toFixed(2) + "M";
  if (amount >= 1_000) return currency + (amount / 1_000).toFixed(1) + "K";
  return currency + amount.toFixed(2);
}

function pct(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return parseFloat((((current - previous) / previous) * 100).toFixed(1));
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

async function fetchCardData(accessToken: string, adAccountId: string): Promise<CardData[]> {
  const acct = `act_${adAccountId}`;

  // Date presets: this_month vs last_month
  const insightsParams = (preset: string) =>
    `/insights?date_preset=${preset}&fields=spend,impressions,clicks,ctr,cpc&level=account`;

  const [
    campaignsRes,
    adSetsRes,
    adsRes,
    insightsThisRes,
    insightsLastRes,
  ] = await Promise.all([
    metaGet(`/${acct}/campaigns?fields=id,status&limit=500`, accessToken),
    metaGet(`/${acct}/adsets?fields=id,status&limit=500`, accessToken),
    metaGet(`/${acct}/ads?fields=id,status&limit=1000`, accessToken),
    metaGet(`/${acct}${insightsParams("this_month")}`, accessToken),
    metaGet(`/${acct}${insightsParams("last_month")}`, accessToken),
  ]);

  // Campaigns
  const campaigns = (campaignsRes.data as Array<{ status: string }>) ?? [];
  const totalCampaigns = campaigns.length;
  const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE").length;

  // Ad sets
  const adSets = (adSetsRes.data as Array<{ status: string }>) ?? [];
  const activeAdSets = adSets.filter((s) => s.status === "ACTIVE").length;

  // Ads
  const ads = (adsRes.data as Array<{ status: string }>) ?? [];
  const totalAds = ads.length;
  const activeAds = ads.filter((a) => a.status === "ACTIVE").length;

  // Insights
  const thisData = ((insightsThisRes.data as unknown[]) ?? [])[0] as Record<string, string> | undefined;
  const lastData = ((insightsLastRes.data as unknown[]) ?? [])[0] as Record<string, string> | undefined;

  const thisSpend = parseFloat(thisData?.spend ?? "0");
  const lastSpend = parseFloat(lastData?.spend ?? "0");
  const thisClicks = parseInt(thisData?.clicks ?? "0", 10);
  const lastClicks = parseInt(lastData?.clicks ?? "0", 10);
  const thisCtr = parseFloat(thisData?.ctr ?? "0");
  const lastCtr = parseFloat(lastData?.ctr ?? "0");
  const thisCpc = parseFloat(thisData?.cpc ?? "0");

  const spendTrend = pct(thisSpend, lastSpend);
  const clicksTrend = pct(thisClicks, lastClicks);
  const ctrTrend = pct(thisCtr, lastCtr);

  // Guess currency from account info (fallback USD)
  const acctInfo = await metaGet(`/${acct}?fields=currency`, accessToken).catch(() => ({ currency: "USD" }));
  const currency = ((acctInfo as Record<string, string>).currency ?? "USD").toUpperCase();
  const currencySymbols: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", AED: "AED ", SAR: "SAR " };
  const sym = currencySymbols[currency] ?? currency + " ";

  return [
    {
      label: "Total Campaigns",
      value: String(totalCampaigns),
      trend: activeCampaigns > 0 ? parseFloat(((activeCampaigns / totalCampaigns) * 100).toFixed(1)) : 0,
      trendLabel: `${activeCampaigns} of ${totalCampaigns} active`,
      subLabel: `${adSets.length} ad sets · ${activeAdSets} active`,
    },
    {
      label: "Total Ads",
      value: fmt(totalAds),
      trend: activeAds > 0 ? parseFloat(((activeAds / totalAds) * 100).toFixed(1)) : 0,
      trendLabel: `${activeAds} of ${totalAds} running`,
      subLabel: `Across ${adSets.length} ad sets`,
    },
    {
      label: "Spend This Month",
      value: fmtMoney(thisSpend * 100, sym),
      trend: spendTrend,
      trendLabel: spendTrend >= 0 ? `Up ${Math.abs(spendTrend)}% vs last month` : `Down ${Math.abs(spendTrend)}% vs last month`,
      subLabel: thisClicks > 0 ? `${fmt(thisClicks)} clicks · ${sym}${thisCpc.toFixed(2)} CPC` : "No clicks yet this month",
    },
    {
      label: "Click-Through Rate",
      value: thisCtr > 0 ? thisCtr.toFixed(2) + "%" : "—",
      trend: ctrTrend,
      trendLabel: ctrTrend >= 0 ? `Up ${Math.abs(ctrTrend)}% vs last month` : `Down ${Math.abs(ctrTrend)}% vs last month`,
      subLabel: clicksTrend >= 0 ? `${fmt(thisClicks)} clicks, +${Math.abs(clicksTrend)}% vs last month` : `${fmt(thisClicks)} clicks, ${clicksTrend}% vs last month`,
    },
  ];
}

// ─── Card skeleton ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <Card className="@container/card animate-pulse">
      <CardHeader>
        <CardDescription>
          <div className="h-3 w-24 rounded bg-muted" />
        </CardDescription>
        <CardTitle>
          <div className="mt-2 h-8 w-20 rounded bg-muted" />
        </CardTitle>
        <CardAction>
          <div className="h-5 w-14 rounded-full bg-muted" />
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5">
        <div className="h-3 w-36 rounded bg-muted" />
        <div className="h-3 w-28 rounded bg-muted" />
      </CardFooter>
    </Card>
  );
}

// ─── Single stat card ─────────────────────────────────────────────────────────

function StatCard({ card }: { card: CardData }) {
  const up = card.trend >= 0;
  const neutral = card.trend === 0;
  const TrendIcon = neutral ? IconMinus : up ? IconTrendingUp : IconTrendingDown;
  const trendColor = neutral ? "" : up ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>{card.label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
          {card.value}
        </CardTitle>
        <CardAction>
          <Badge variant="outline" className={trendColor}>
            <TrendIcon className="size-3" />
            {neutral ? "—" : `${up ? "+" : ""}${card.trend}%`}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5 text-sm">
        <div className={`line-clamp-1 flex items-center gap-2 font-medium ${trendColor}`}>
          {card.trendLabel}
          <TrendIcon className="size-4" />
        </div>
        <div className="text-muted-foreground">{card.subLabel}</div>
      </CardFooter>
    </Card>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function SectionCards() {
  const [cards, setCards] = useState<CardData[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Try to read Meta Ads auth from localStorage (set by chat connect flow)
    const raw = window.localStorage.getItem("meta_ads_auth");
    if (!raw) return;

    try {
      setCards(null);
      setError("");

      const saved = JSON.parse(raw) as {
        accessToken?: string;
        accounts?: { id: string }[];
        selectedAccount?: { id: string } | null;
      };

      const accessToken = saved.accessToken;
      const account =
        saved.selectedAccount ??
        (Array.isArray(saved.accounts) ? saved.accounts[0] : null);

      if (!accessToken || !account?.id) return;

      const adAccountId = account.id.replace(/^act_/, "");

      fetchCardData(accessToken, adAccountId)
        .then(setCards)
        .catch((err) => setError(String(err)));
    } catch (err) {
      setError(String(err));
    }
  }, []);

  if (error) {
    return (
      <div className="px-4 lg:px-6">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
          Failed to load stats: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      {cards === null
        ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        : cards.map((card) => <StatCard key={card.label} card={card} />)
      }
    </div>
  );
}