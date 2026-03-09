"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChartAreaInteractiveProps {
  accessToken: string
  adAccountId: string // numeric, no act_ prefix
}

interface DayPoint {
  date: string   // "YYYY-MM-DD"
  spend: number  // dollars
  clicks: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE = "https://graph.facebook.com/v25.0"

function safeParseJSON(text: string): unknown {
  const safe = text.replace(/:(\s*)(-?\d{16,})([,\}\]])/g, (_m, sp, n, tail) => `:"${n}"${tail}`)
  return JSON.parse(safe)
}

async function fetchDailyInsights(
  accessToken: string,
  adAccountId: string,
  days: number
): Promise<DayPoint[]> {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceStr = since.toISOString().slice(0, 10)
  const untilStr = new Date().toISOString().slice(0, 10)

  const url =
    `${BASE}/act_${adAccountId}/insights` +
    `?fields=date_start,spend,clicks` +
    `&time_increment=1` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since: sinceStr, until: untilStr }))}` +
    `&level=account` +
    `&limit=200` +
    `&access_token=${accessToken}`

  const res = await fetch(url)
  const json = safeParseJSON(await res.text()) as { data?: Array<{ date_start: string; spend: string; clicks: string }> }

  return (json.data ?? []).map((d) => ({
    date: d.date_start,
    spend: parseFloat(d.spend ?? "0"),
    clicks: parseInt(d.clicks ?? "0", 10),
  }))
}

// ─── Chart config ─────────────────────────────────────────────────────────────

const chartConfig = {
  spend: {
    label: "Spend ($)",
    color: "var(--primary)",
  },
  clicks: {
    label: "Clicks",
    color: "var(--chart-2, #60a5fa)",
  },
} satisfies ChartConfig

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ChartSkeleton() {
  return (
    <div className="flex h-[250px] w-full animate-pulse items-end gap-1 px-2">
      {Array.from({ length: 30 }).map((_, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm bg-muted"
          style={{ height: `${20 + Math.random() * 60}%` }}
        />
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ChartAreaInteractive({ accessToken, adAccountId }: ChartAreaInteractiveProps) {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState("90d")
  const [allData, setAllData] = React.useState<DayPoint[] | null>(null)
  const [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(false)

  // Fetch 90 days once — we slice client-side for the toggle
  React.useEffect(() => {
    if (!accessToken || !adAccountId) return
    setLoading(true)
    setError("")
    fetchDailyInsights(accessToken, adAccountId, 90)
      .then(setAllData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [accessToken, adAccountId])

  React.useEffect(() => {
    if (isMobile) setTimeRange("7d")
  }, [isMobile])

  const filteredData = React.useMemo(() => {
    if (!allData) return []
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    return allData.filter((d) => new Date(d.date) >= cutoff)
  }, [allData, timeRange])

  const totalSpend = filteredData.reduce((s, d) => s + d.spend, 0)
  const totalClicks = filteredData.reduce((s, d) => s + d.clicks, 0)
  const rangeLabel = timeRange === "7d" ? "Last 7 days" : timeRange === "30d" ? "Last 30 days" : "Last 3 months"

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>
          Spend &amp; Clicks
          {allData && !loading && (
            <span className="ml-2 text-base font-normal text-muted-foreground">
              ${totalSpend.toFixed(2)} · {totalClicks.toLocaleString()} clicks
            </span>
          )}
        </CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">Daily ad spend and clicks — {rangeLabel}</span>
          <span className="@[540px]/card:hidden">{rangeLabel}</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            value={timeRange}
            onValueChange={setTimeRange}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
          >
            <ToggleGroupItem value="90d">Last 3 months</ToggleGroupItem>
            <ToggleGroupItem value="30d">Last 30 days</ToggleGroupItem>
            <ToggleGroupItem value="7d">Last 7 days</ToggleGroupItem>
          </ToggleGroup>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label="Select a value"
            >
              <SelectValue placeholder="Last 3 months" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="90d" className="rounded-lg">Last 3 months</SelectItem>
              <SelectItem value="30d" className="rounded-lg">Last 30 days</SelectItem>
              <SelectItem value="7d" className="rounded-lg">Last 7 days</SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>

      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {error ? (
          <div className="flex h-[250px] items-center justify-center rounded-md border border-destructive/40 bg-destructive/10 font-mono text-xs text-destructive">
            {error}
          </div>
        ) : loading || allData === null ? (
          <ChartSkeleton />
        ) : filteredData.length === 0 ? (
          <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
            No data for this period
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
            <AreaChart data={filteredData}>
              <defs>
                <linearGradient id="fillSpend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--color-spend)"  stopOpacity={0.9} />
                  <stop offset="95%" stopColor="var(--color-spend)"  stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="fillClicks" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--color-clicks)" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="var(--color-clicks)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) =>
                  new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                }
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) =>
                      new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                    }
                    formatter={(value, name) => {
                      if (name === "spend") return [`$${Number(value).toFixed(2)}`, "Spend"]
                      return [Number(value).toLocaleString(), "Clicks"]
                    }}
                    indicator="dot"
                  />
                }
              />
              {/* Clicks first so spend renders on top */}
              <Area
                dataKey="clicks"
                type="natural"
                fill="url(#fillClicks)"
                stroke="var(--color-clicks)"
                yAxisId="clicks"
              />
              <Area
                dataKey="spend"
                type="natural"
                fill="url(#fillSpend)"
                stroke="var(--color-spend)"
                yAxisId="spend"
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}