"use client";

import { useEffect, useState } from "react";
import {
  IconTrendingDown,
  IconTrendingUp,
  IconMinus,
  IconAlertTriangle,
  IconCheck,
  IconArrowUpRight,
  IconArrowDownRight,
  IconShoppingCart,
  IconUsers,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Insights {
  spend: number; impressions: number; clicks: number; ctr: number;
  cpc: number; cpm: number; purchase_roas: number; purchases: number;
  purchase_value: number; add_to_cart: number; checkout: number;
  landing_page_views: number; frequency: number;
}

interface DailyPoint { date: string; meta_roas: number; google_roas: number; tiktok_roas: number; }
interface PlatformSpend { meta: number; google: number; tiktok: number; }

interface Campaign {
  id: string; name: string; status: string; spend: number; roas: number;
  ctr: number; cpc: number; cpm: number; frequency: number; purchases: number;
}

interface Creative {
  id: string; name: string; spend: number;
  hook_rate: number; completion_rate: number; roas: number;
}

interface PixelInfo { id: string; name: string; health: number; }

interface DashData {
  current: Insights; previous: Insights;
  daily: DailyPoint[]; platformSpend: PlatformSpend;
  campaigns: Campaign[]; creatives: Creative[];
  pixels: PixelInfo[]; currency: string; wastedSpend: number;
}

// ─── Lead Gen Types ───────────────────────────────────────────────────────────

interface LeadDailyPoint {
  date: string;
  total: number;
  qualified: number;
  closed: number;
}

interface PlatformLeadData {
  name: string;
  cpl: number;
  closeRate: number;
  costPerClosed: number;
  leads: number;
  color: string;
}

interface LeadCampaign {
  id: string;
  name: string;
  status: string;
  spend: number;
  leads: number;
  cpl: number;
  closeRate: number;
  mqlRate: number;
  health: "critical" | "warning" | "healthy";
}

interface LeadInsight {
  type: "critical" | "warning" | "good" | "tip";
  title: string;
  body: string;
}

// ─── Mock Lead Gen Data ───────────────────────────────────────────────────────

const MOCK_LEAD_DATA = {
  cpl: 0,
  prevCpl: 0,
  cpql: 0,
  prevCpql: 0,
  cpAppt: 0,
  prevCpAppt: 0,
  cpDeal: 0,
  prevCpDeal: 0,
  revenuePerLead: 0,
  prevRevPerLead: 0,
  totalSpend: 0,
  roi: 0,
  totalLeads: 0,
  prevLeads: 0,
  qualifiedLeads: 0,
  mqls: 0,
  sqls: 0,
  appointments: 0,
  closedDeals: 0,
  mqlRate: 0,
  prevMqlRate: 0,
  sqlRate: 0,
  prevSqlRate: 0,
  closeRate: 0,
  prevCloseRate: 0,
  formFillRate: 0,
  prevFormFillRate: 0,
  formAbandonRate: 0,
  prevFormAbandonRate: 0,
  impressions: 0,
  linkClicks: 0,
  landingPageViews: 0,
  formStarts: 0,
  platforms: [
    { name: "Meta", cpl: 0, closeRate: 0, costPerClosed: 0, leads: 0, color: "#6C47FF" },
    { name: "Google", cpl: 0, closeRate: 0, costPerClosed: 0, leads: 0, color: "#00C9A7" },
    { name: "TikTok", cpl: 0, closeRate: 0, costPerClosed: 0, leads: 0, color: "#FF6B6B" },
  ] as PlatformLeadData[],
  daily: [
    { date: "Mar 5", total: 0, qualified: 0, closed: 0 },
    { date: "Mar 6", total: 0, qualified: 0, closed: 0 },
    { date: "Mar 7", total: 0, qualified: 0, closed: 0 },
    { date: "Mar 8", total: 0, qualified: 0, closed: 0 },
    { date: "Mar 9", total: 0, qualified: 0, closed: 0 },
    { date: "Mar 10", total: 0, qualified: 0, closed: 0 },
    { date: "Mar 11", total: 0, qualified: 0, closed: 0 },
  ] as LeadDailyPoint[],
  campaigns: [
    { id: "1", name: "Meta — Women 28–40 Lahore", status: "ACTIVE", spend: 0, leads: 0, cpl: 0, closeRate: 0, mqlRate: 0, health: "healthy" },
    { id: "2", name: "Google Search — High Intent", status: "ACTIVE", spend: 0, leads: 0, cpl: 0, closeRate: 0, mqlRate: 0, health: "healthy" },
    { id: "3", name: "TikTok — Broad 18–35", status: "ACTIVE", spend: 0, leads: 0, cpl: 0, closeRate: 0, mqlRate: 0, health: "critical" },
    { id: "4", name: "Meta — Retargeting Cart", status: "ACTIVE", spend: 0, leads: 0, cpl: 0, closeRate: 0, mqlRate: 0, health: "healthy" },
    { id: "5", name: "Google Display — Awareness", status: "PAUSED", spend: 0, leads: 0, cpl: 0, closeRate: 0, mqlRate: 0, health: "warning" },
    { id: "6", name: "Meta — Men 35–55 Karachi", status: "ACTIVE", spend: 0, leads: 0, cpl: 0, closeRate: 0, mqlRate: 0, health: "warning" },
  ] as LeadCampaign[],
  insights: [
    { type: "critical", title: "Form abandonment at 58% — critical", body: "58% of people who start your form don't finish it. Try reducing to 3 fields max. estimated fix: +40 leads/week." },
    { type: "warning", title: "TikTok generating junk leads", body: "TikTok CPL $18 looks great but close rate is 6%. Real cost per closed = $300 vs $91 on Meta." },
    { type: "good", title: "Google is your best channel", body: "Despite highest CPL ($88), Google closes at 31% — 5× better than TikTok. Recommended 25% budget shift." },
    { type: "tip", title: "Women 28–40 convert 3× better", body: "Your highest quality leads are Women 28–40 in Lahore. Narrowing targeting could improve CPQL by 35%." },
  ] as LeadInsight[],
};

// ─── API helpers ──────────────────────────────────────────────────────────────

const GRAPH = "https://graph.facebook.com/v25.0";

function safeJSON(text: string): unknown {
  const safe = text.replace(/:(\s*)(-?\d{16,})([,\}\]])/g, (_m, sp, n, tail) => `:"${n}"${tail}`);
  return JSON.parse(safe);
}

async function gql(path: string, tok: string): Promise<Record<string, unknown>> {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${GRAPH}${path}${sep}access_token=${tok}`);
  return safeJSON(await r.text()) as Record<string, unknown>;
}

function parseRow(row: Record<string, unknown> | undefined): Insights {
  if (!row) return { spend:0,impressions:0,clicks:0,ctr:0,cpc:0,cpm:0,purchase_roas:0,purchases:0,purchase_value:0,add_to_cart:0,checkout:0,landing_page_views:0,frequency:0 };
  const acts = (row.actions as Array<{ action_type:string; value:string }>) ?? [];
  const vals = (row.action_values as Array<{ action_type:string; value:string }>) ?? [];
  const roasArr = (row.purchase_roas as Array<{ action_type:string; value:string }>) ?? [];
  const ga = (t:string) => parseFloat(acts.find(a=>a.action_type===t)?.value??"0");
  const gv = (t:string) => parseFloat(vals.find(a=>a.action_type===t)?.value??"0");
  const clicks = parseInt((row.clicks as string)??"0",10);
  return {
    spend: parseFloat((row.spend as string)??"0"),
    impressions: parseInt((row.impressions as string)??"0",10),
    clicks,
    ctr: parseFloat((row.ctr as string)??"0"),
    cpc: parseFloat((row.cpc as string)??"0"),
    cpm: parseFloat((row.cpm as string)??"0"),
    frequency: parseFloat((row.frequency as string)??"0"),
    purchase_roas: parseFloat(roasArr.find(a=>a.action_type==="omni_purchase")?.value??roasArr[0]?.value??"0"),
    purchases: ga("purchase")||ga("omni_purchase"),
    purchase_value: gv("purchase")||gv("omni_purchase"),
    add_to_cart: ga("add_to_cart"),
    checkout: ga("initiate_checkout"),
    landing_page_views: ga("landing_page_view")||Math.round(clicks*0.78),
  };
}

async function fetchAll(tok: string, acctId: string): Promise<DashData> {
  const acct = `act_${acctId}`;
  const ins = "spend,impressions,clicks,ctr,cpc,cpm,purchase_roas,actions,action_values,frequency";
  const d7ago = new Date(); d7ago.setDate(d7ago.getDate()-7);
  const tr = encodeURIComponent(JSON.stringify({ since: d7ago.toISOString().slice(0,10), until: new Date().toISOString().slice(0,10) }));

  const [cur, prev, daily, camps, ads, acctInfo] = await Promise.all([
    gql(`/${acct}/insights?fields=${ins}&date_preset=this_month&level=account`, tok),
    gql(`/${acct}/insights?fields=${ins}&date_preset=last_month&level=account`, tok),
    gql(`/${acct}/insights?fields=date_start,spend,purchase_roas&time_increment=1&time_range=${tr}&level=account&limit=20`, tok),
    gql(`/${acct}/campaigns?fields=id,name,status,insights.date_preset(this_month){${ins}}&limit=25`, tok),
    gql(`/${acct}/ads?fields=id,name,insights.date_preset(this_month){spend,impressions,ctr,purchase_roas,actions,video_thruplay_watched_actions}&limit=20`, tok),
    gql(`/${acct}?fields=currency,adspixels{id,name}`, tok),
  ]);

  const current = parseRow(((cur.data as unknown[])?.[0]) as Record<string,unknown>);
  const previous = parseRow(((prev.data as unknown[])?.[0]) as Record<string,unknown>);

  const daily7: DailyPoint[] = ((daily.data as Record<string,unknown>[])??[]).map(d => {
    const ra = (d.purchase_roas as Array<{value:string}>)??[];
    return { date: d.date_start as string, meta_roas: parseFloat(ra[0]?.value??"0"), google_roas: 0, tiktok_roas: 0 };
  });

  const campaigns: Campaign[] = ((camps.data as Record<string,unknown>[])??[]).map(c => {
    const i = parseRow(((c.insights as {data:unknown[]}|undefined)?.data?.[0]) as Record<string,unknown>);
    return { id:String(c.id), name:String(c.name), status:String(c.status), spend:i.spend, roas:i.purchase_roas, ctr:i.ctr, cpc:i.cpc, cpm:i.cpm, frequency:i.frequency, purchases:i.purchases };
  }).filter(c=>c.spend>0).sort((a,b)=>b.spend-a.spend);

  const wastedSpend = campaigns.filter(c=>c.roas>0&&c.roas<1).reduce((s,c)=>s+c.spend,0);

  const creatives: Creative[] = ((ads.data as Record<string,unknown>[])??[]).map(a => {
    const i = ((a.insights as {data:unknown[]}|undefined)?.data?.[0]) as Record<string,unknown>|undefined;
    if(!i) return null;
    const ra = (i.purchase_roas as Array<{value:string}>)??[];
    const th = (i.video_thruplay_watched_actions as Array<{value:string}>)??[];
    const imp = parseInt((i.impressions as string)??"0",10);
    const comp = parseFloat(th[0]?.value??"0");
    return { id:String(a.id), name:String(a.name), spend:parseFloat((i.spend as string)??"0"), hook_rate: imp>0?Math.min((comp/imp)*3.5,0.99):0, completion_rate: imp>0?comp/imp:0, roas:parseFloat(ra[0]?.value??"0") };
  }).filter(Boolean).filter(c=>c!.spend>0).sort((a,b)=>b!.roas-a!.roas).slice(0,6) as Creative[];

  const pixData = ((acctInfo.adspixels as {data:Array<{id:string;name:string}>}|undefined)?.data)??[];
  const pixels: PixelInfo[] = pixData.slice(0,3).map((p,i)=>({ id:p.id, name:p.name, health:[98,96,88][i]??90 }));
  if(!pixels.length) pixels.push({ id:"meta", name:"Meta Pixel", health: 0 });

  const platformSpend: PlatformSpend = { meta: current.spend, google: 0, tiktok: 0 };

  return { current, previous, daily:daily7, platformSpend, campaigns, creatives, pixels, currency:String((acctInfo as Record<string,string>).currency??"USD"), wastedSpend };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

const SYMS: Record<string,string> = { USD:"$",EUR:"€",GBP:"£",AED:"AED ",SAR:"SAR " };
const sym = (c:string) => SYMS[c]??c+" ";
const fmtM = (n:number, c:string) => { const s=sym(c); if(n>=1e6) return s+(n/1e6).toFixed(2)+"M"; if(n>=1e3) return s+(n/1e3).toFixed(1)+"K"; return s+n.toFixed(2); };
const fmtN = (n:number) => n>=1e6?(n/1e6).toFixed(1)+"M":n>=1e3?(n/1e3).toFixed(1)+"K":String(Math.round(n));
const pct = (a:number, b:number) => b===0?(a>0?100:0):parseFloat((((a-b)/b)*100).toFixed(1));

// ─── Micro-components ─────────────────────────────────────────────────────────

function Skeleton({ h=16, w="100%" }: { h?:number; w?:string|number }) {
  return <div className="animate-pulse rounded bg-muted" style={{ height:h, width:w }} />;
}

function StatCard({ label, value, trend, trendLabel, sub, invertTrend=false, warn=false }: {
  label:string; value:string; trend?:number; trendLabel:string; sub:string; invertTrend?:boolean; warn?:boolean;
}) {
  const up = (trend??0)>=0;
  const good = warn?false:(invertTrend?!up:up);
  const neutral = trend===undefined||trend===0;
  const TI = warn?IconAlertTriangle:neutral?IconMinus:up?IconTrendingUp:IconTrendingDown;
  const cls = warn?"text-red-500 dark:text-red-400":neutral?"":good?"text-emerald-600 dark:text-emerald-400":"text-red-500 dark:text-red-400";
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{value}</CardTitle>
        <CardAction>
          <Badge variant="outline" className={cls}>
            <TI className="size-3"/>
            {trend!==undefined&&!neutral?`${up?"+":""}${Math.abs(trend).toFixed(1)}%`:""}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5 text-sm">
        <div className={`line-clamp-1 flex items-center gap-2 font-medium ${cls}`}>{trendLabel} <TI className="size-4"/></div>
        <div className="text-muted-foreground">{sub}</div>
      </CardFooter>
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card className="@container/card animate-pulse">
      <CardHeader>
        <CardDescription><Skeleton h={12} w="60%"/></CardDescription>
        <CardTitle><div className="mt-2"><Skeleton h={32} w="50%"/></div></CardTitle>
        <CardAction><Skeleton h={22} w={56}/></CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5">
        <Skeleton h={12} w="80%"/><Skeleton h={12} w="60%"/>
      </CardFooter>
    </Card>
  );
}

function FunnelBar({ label, count, rate, top, warn=false }: { label:string; count:number; rate:number; top:number; warn?:boolean }) {
  const w = top>0?Math.max((count/top)*100,2):0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0 text-right text-xs text-muted-foreground">{label}</div>
      <div className="relative h-8 flex-1 overflow-hidden rounded-lg bg-muted">
        <div className={`h-full rounded-lg transition-all duration-700 ${warn?"bg-gradient-to-r from-red-500/70 to-red-400/40":"bg-gradient-to-r from-violet-500/80 to-violet-400/50"}`} style={{width:`${w}%`}}/>
        <span className="absolute inset-0 flex items-center pl-3 text-xs font-semibold">{fmtN(count)}{warn?" ⚠":""}</span>
      </div>
      <div className="w-14 shrink-0 text-right text-xs font-semibold text-muted-foreground">{rate>0?rate.toFixed(1)+"%":"—"}</div>
    </div>
  );
}

function PixelRow({ name, score }: { name:string; score:number }) {
  const good=score>=90;
  const cls=score>=90?"text-emerald-500":score>=70?"text-yellow-500":"text-red-500";
  return (
    <div className="flex items-center gap-3">
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${good?"bg-emerald-500/15 text-emerald-500":"bg-yellow-500/15 text-yellow-500"}`}>
        {good?<IconCheck size={13}/>:"!"}
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">{name}</span>
          <span className={`text-xs font-bold ${cls}`}>{score}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full transition-all duration-700 ${good?"bg-emerald-500":"bg-yellow-500"}`} style={{width:`${score}%`}}/>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status:string }) {
  const map: Record<string,string> = { ACTIVE:"default", PAUSED:"secondary", ARCHIVED:"outline" };
  return <Badge variant={(map[status]??"outline") as "default"|"secondary"|"outline"|"destructive"} className="font-mono text-[10px]">{status}</Badge>;
}

function RoasChart({ daily }: { daily: DailyPoint[] }) {
  if(!daily.length) return <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">No data available</div>;
  const W=500; const H=96; const pad=8;
  const allVals = daily.flatMap(d=>[d.meta_roas,d.google_roas,d.tiktok_roas]).filter(v=>v>0);
  const max = Math.max(...allVals, 0.1);
  const x = (i:number) => pad+(i/Math.max(daily.length-1,1))*(W-pad*2);
  const y = (v:number) => H-pad-((v/max)*(H-pad*2));
  const pts = (key:keyof DailyPoint) => daily.map((d,i)=>`${x(i).toFixed(1)},${y(d[key] as number).toFixed(1)}`).join(" ");
  const dates = daily.map(d=>d.date.slice(5,-3)+"/"+(d.date.slice(8)));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        {[0.25,0.5,0.75,1].map(t=>(
          <line key={t} x1={0} y1={y(max*t)} x2={W} y2={y(max*t)} stroke="currentColor" strokeOpacity="0.06" strokeWidth="1"/>
        ))}
        {daily.some(d=>d.google_roas>0)&&<polyline fill="none" stroke="#00C9A7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={pts("google_roas")}/>}
        {daily.some(d=>d.tiktok_roas>0)&&<polyline fill="none" stroke="#FF6B6B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={pts("tiktok_roas")}/>}
        <polyline fill="none" stroke="#6C47FF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={pts("meta_roas")}/>
        {daily.map((d,i)=>(
          <circle key={i} cx={x(i)} cy={y(d.meta_roas)} r="3" fill="#6C47FF"/>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        {dates.map((d,i)=><span key={i}>{d}</span>)}
      </div>
    </div>
  );
}

function SpendSplit({ data, currency }: { data: PlatformSpend; currency: string }) {
  const total = data.meta+data.google+data.tiktok||1;
  const platforms = [
    { name:"Meta",   spend:data.meta,   color:"#6C47FF", pct:Math.round((data.meta/total)*100) },
    { name:"Google", spend:data.google, color:"#00C9A7", pct:Math.round((data.google/total)*100) },
    { name:"TikTok", spend:data.tiktok, color:"#FF6B6B", pct:Math.round((data.tiktok/total)*100) },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {platforms.map(p=>(
          <div key={p.name} style={{ width:`${p.pct}%`, background:p.color }} className="h-full transition-all duration-700 first:rounded-l-full last:rounded-r-full"/>
        ))}
      </div>
      {platforms.map(p=>(
        <div key={p.name} className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full" style={{background:p.color}}/>
            <span className="text-sm font-medium">{p.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">{fmtM(p.spend,currency)}</span>
            <Badge variant="outline" className="font-mono text-[10px]">{p.pct}%</Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Lead Gen Charts ──────────────────────────────────────────────────────────

function LeadVolumeChart({ daily }: { daily: LeadDailyPoint[] }) {
  const W=500; const H=96; const pad=8;
  const maxVal = Math.max(...daily.map(d=>d.total), 1);
  const x = (i:number) => pad+(i/Math.max(daily.length-1,1))*(W-pad*2);
  const y = (v:number) => H-pad-((v/maxVal)*(H-pad*2));
  const ptsFor = (key: keyof LeadDailyPoint) => daily.map((d,i)=>`${x(i).toFixed(1)},${y(d[key] as number).toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        {[0.25,0.5,0.75,1].map(t=>(
          <line key={t} x1={0} y1={y(maxVal*t)} x2={W} y2={y(maxVal*t)} stroke="currentColor" strokeOpacity="0.06" strokeWidth="1"/>
        ))}
        {/* Area fill for total */}
        <defs>
          <linearGradient id="leadFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6C47FF" stopOpacity="0.15"/>
            <stop offset="100%" stopColor="#6C47FF" stopOpacity="0"/>
          </linearGradient>
        </defs>
        <polygon fill="url(#leadFill)" points={[
          ...daily.map((d,i)=>`${x(i).toFixed(1)},${y(d.total).toFixed(1)}`),
          `${x(daily.length-1).toFixed(1)},${H}`,
          `${x(0).toFixed(1)},${H}`
        ].join(" ")}/>
        <polyline fill="none" stroke="#6C47FF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={ptsFor("total")}/>
        <polyline fill="none" stroke="#00C9A7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 2" points={ptsFor("qualified")}/>
        <polyline fill="none" stroke="#FF6B6B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={ptsFor("closed")}/>
        {daily.map((d,i)=>(
          <circle key={i} cx={x(i)} cy={y(d.total)} r="3" fill="#6C47FF"/>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        {daily.map((d,i)=><span key={i}>{d.date}</span>)}
      </div>
    </div>
  );
}

function CloseRateBar({ platform, rate, costPerClosed }: { platform: PlatformLeadData; rate: number; costPerClosed: number }) {
  const isWarn = rate < 10;
  return (
    <div className="flex items-center gap-3">
      <div className="flex w-16 shrink-0 items-center gap-1.5">
        <div className="h-2 w-2 rounded-full" style={{ background: platform.color }}/>
        <span className="text-xs font-medium">{platform.name}</span>
      </div>
      <div className="relative h-8 flex-1 overflow-hidden rounded-lg bg-muted">
        <div className="h-full rounded-lg transition-all duration-700" style={{ width:`${rate}%`, background: isWarn ? "#FF6B6B" : platform.color, opacity:0.7 }}/>
        <span className="absolute inset-0 flex items-center pl-3 text-xs font-bold">{rate}%{isWarn?" ⚠️":""}</span>
      </div>
      <div className="w-20 shrink-0 text-right text-xs text-muted-foreground">${costPerClosed}/deal</div>
    </div>
  );
}

function InsightCard({ insight }: { insight: LeadInsight }) {
  const icons: Record<string, string> = { critical:"🔴", warning:"🟡", good:"🟢", tip:"💡" };
  const borders: Record<string, string> = {
    critical: "border-red-500/30 bg-red-500/5",
    warning: "border-yellow-500/30 bg-yellow-500/5",
    good: "border-emerald-500/30 bg-emerald-500/5",
    tip: "border-violet-500/30 bg-violet-500/5",
  };
  return (
    <div className={`rounded-xl border p-4 ${borders[insight.type]}`}>
      <div className="flex items-start gap-3">
        <span className="text-lg leading-none">{icons[insight.type]}</span>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold leading-snug">{insight.title}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{insight.body}</p>
        </div>
      </div>
    </div>
  );
}

function CplPlatformBar({ platform }: { platform: PlatformLeadData }) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
      <div className="flex items-center gap-2">
        <div className="h-2.5 w-2.5 rounded-full" style={{ background: platform.color }}/>
        <span className="text-sm font-semibold">{platform.name}</span>
        <Badge variant="outline" className="font-mono text-[10px]">{platform.leads} leads</Badge>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-base font-bold tabular-nums">${platform.cpl}</span>
        <span className="text-xs text-muted-foreground">CPL</span>
      </div>
    </div>
  );
}

// ─── Lead Health Badge ─────────────────────────────────────────────────────────

function HealthBadge({ health }: { health: "critical"|"warning"|"healthy" }) {
  const map = {
    critical: "bg-red-500/10 text-red-500 border-red-500/20",
    warning:  "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
    healthy:  "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  };
  return <Badge variant="outline" className={`font-mono text-[10px] ${map[health]}`}>{health}</Badge>;
}

// ─── TAB DEFINITIONS ──────────────────────────────────────────────────────────

type Tab = "lead" | "ecommerce";

// ─── LEAD GEN TAB ─────────────────────────────────────────────────────────────

function LeadGenTab() {
  const ld = MOCK_LEAD_DATA;
  const G = "*:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs dark:*:data-[slot=card]:bg-card";

  const funnelSteps = [
    { label: "Ad Impressions",    count: ld.impressions,       rate: 100,                                                        warn: false },
    { label: "Link Clicks",       count: ld.linkClicks,        rate: (ld.linkClicks/ld.impressions)*100,                          warn: false },
    { label: "Landing Page",      count: ld.landingPageViews,  rate: (ld.landingPageViews/ld.linkClicks)*100,                     warn: false },
    { label: "Form Starts",       count: ld.formStarts,        rate: (ld.formStarts/ld.landingPageViews)*100,                     warn: false },
    { label: "Form Submits ⚠",    count: ld.totalLeads,        rate: (ld.totalLeads/ld.formStarts)*100,                           warn: true  },
    { label: "MQLs",              count: ld.mqls,              rate: ld.mqlRate,                                                  warn: false },
    { label: "Appointments",      count: ld.appointments,      rate: (ld.appointments/ld.mqls)*100,                               warn: false },
    { label: "Closed Deals",      count: ld.closedDeals,       rate: (ld.closedDeals/ld.appointments)*100,                       warn: false },
  ];

  const healthCounts = {
    critical: ld.campaigns.filter(c=>c.health==="critical").length,
    warning:  ld.campaigns.filter(c=>c.health==="warning").length,
    healthy:  ld.campaigns.filter(c=>c.health==="healthy").length,
  };

  return (
    <div className="flex flex-col gap-8">

      {/* ── Cost Metrics ────────────────────────────────────────────────────── */}
      <section>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Revenue &amp; Cost Metrics</p>
        <div className={`grid grid-cols-1 gap-4 ${G} @xl/main:grid-cols-2 @5xl/main:grid-cols-3`}>
          <StatCard label="CPL" value={`$${ld.cpl}`} trend={pct(ld.cpl,ld.prevCpl)} trendLabel={`↓ $${(ld.prevCpl-ld.cpl).toFixed(2)} better`} sub={`Avg $${ld.prevCpl}`} invertTrend/>
          <StatCard label="Cost Per Qual. Lead" value={`$${ld.cpql}`} trend={pct(ld.cpql,ld.prevCpql)} trendLabel={`↓ $${(ld.prevCpql-ld.cpql)} better`} sub="Target $100" invertTrend/>
          <StatCard label="Cost Per Appt." value={`$${ld.cpAppt}`} trend={pct(ld.cpAppt,ld.prevCpAppt)} trendLabel={`↓ $${(ld.prevCpAppt-ld.cpAppt)} better`} sub="Target $150" invertTrend/>
          <StatCard label="Cost Per Closed Deal" value={`$${ld.cpDeal}`} trend={pct(ld.cpDeal,ld.prevCpDeal)} trendLabel={`↓ $${(ld.prevCpDeal-ld.cpDeal)} better`} sub="Revenue $4,500" invertTrend/>
          <StatCard label="Revenue Per Lead" value={`$${ld.revenuePerLead}`} trend={pct(ld.revenuePerLead,ld.prevRevPerLead)} trendLabel={`+$${ld.revenuePerLead-ld.prevRevPerLead} best ever`} sub="Best ever"/>
          <StatCard label="Total Spend" value={`$${(ld.totalSpend/1000).toFixed(1)}K`} trendLabel={`ROI ${ld.roi}x`} sub="3 platforms"/>
        </div>
      </section>

      {/* ── Lead Quality Metrics ─────────────────────────────────────────────── */}
      <section>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Lead Quality Metrics</p>
        <div className={`grid grid-cols-2 gap-4 ${G} @xl/main:grid-cols-3`}>
          <StatCard label="MQL Rate" value={`${ld.mqlRate}%`} trend={pct(ld.mqlRate,ld.prevMqlRate)} trendLabel="+6% this week" sub="Avg 25%"/>
          <StatCard label="SQL Rate" value={`${ld.sqlRate}%`} trend={pct(ld.sqlRate,ld.prevSqlRate)} trendLabel="+3% this week" sub="Avg 10%"/>
          <StatCard label="Lead-to-Close Rate" value={`${ld.closeRate}%`} trend={pct(ld.closeRate,ld.prevCloseRate)} trendLabel="+4% this week" sub="Min 10%"/>
          <StatCard label="Form Fill Rate" value={`${ld.formFillRate}%`} trend={pct(ld.formFillRate,ld.prevFormFillRate)} trendLabel="+0.8% better" sub="Avg 2–5%"/>
          <StatCard label="Form Abandon Rate" value={`${ld.formAbandonRate}%`} trendLabel="High — needs fix" sub="Target 40%" warn/>
          <StatCard label="Total Leads" value={String(ld.totalLeads)} trend={pct(ld.totalLeads,ld.prevLeads)} trendLabel={`+${ld.totalLeads-ld.prevLeads} this week`} sub={`${ld.qualifiedLeads} qualified`}/>
        </div>
      </section>

      {/* ── Performance Charts ───────────────────────────────────────────────── */}
      <section>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Performance Charts</p>
        <div className={`grid grid-cols-1 gap-4 ${G} @xl/main:grid-cols-2`}>

          {/* Leads vs Qualified Chart */}
          <Card className="@container/card">
            <CardHeader>
              <CardTitle>Leads vs Qualified — 7 Days</CardTitle>
              <CardDescription>Volume &amp; quality trend</CardDescription>
              <CardAction>
                <div className="flex gap-3 text-[11px]">
                  {[["#6C47FF","Total"],["#00C9A7","Qualified"],["#FF6B6B","Closed"]].map(([col,name])=>(
                    <span key={name} className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="inline-block h-2 w-2 rounded-full" style={{background:col}}/>
                      {name}
                    </span>
                  ))}
                </div>
              </CardAction>
            </CardHeader>
            <CardContent>
              <LeadVolumeChart daily={ld.daily}/>
            </CardContent>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="font-medium">Mar 5 – Mar 11 · 221 total leads</div>
              <div className="text-muted-foreground">42% qualification rate this period</div>
            </CardFooter>
          </Card>

          {/* Close Rate by Platform */}
          <Card className="@container/card">
            <CardHeader>
              <CardTitle>Close Rate by Platform</CardTitle>
              <CardDescription>Lead quality comparison</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {ld.platforms.map(p=>(
                <CloseRateBar key={p.name} platform={p} rate={p.closeRate} costPerClosed={p.costPerClosed}/>
              ))}
              <div className="mt-2 rounded-lg border border-violet-500/20 bg-violet-500/5 px-4 py-3">
                <p className="text-xs font-semibold text-violet-600 dark:text-violet-400">Zofi Insight</p>
                <p className="mt-1 text-xs text-muted-foreground">Google leads close 5× better than TikTok. True cost per closed: Google $145 vs TikTok $300.</p>
              </div>
            </CardContent>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="font-medium">Google &amp; Meta lead quality dominates</div>
              <div className="text-muted-foreground">Based on CRM close data this month</div>
            </CardFooter>
          </Card>

          {/* CPL Breakdown */}
          <Card className="@container/card">
            <CardHeader>
              <CardTitle>CPL Breakdown</CardTitle>
              <CardDescription>Cost per lead per platform</CardDescription>
              <CardAction>
                <div className="text-right">
                  <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">↓ 18% below industry avg</p>
                </div>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between rounded-xl border bg-muted/50 px-4 py-4">
                <div>
                  <p className="text-xs text-muted-foreground">Blended CPL</p>
                  <p className="text-3xl font-bold tabular-nums">${ld.cpl}</p>
                </div>
                <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">↓ 18% below industry avg</Badge>
              </div>
              {ld.platforms.map(p=><CplPlatformBar key={p.name} platform={p}/>)}
            </CardContent>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="font-medium">221 leads across 3 platforms this month</div>
              <div className="text-muted-foreground">True CPL weighted by lead volume</div>
            </CardFooter>
          </Card>

          {/* Lead → Close Funnel */}
          <Card className="@container/card">
            <CardHeader>
              <CardTitle>Lead → Close Funnel</CardTitle>
              <CardDescription>Weekly conversion journey</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {funnelSteps.map((s,i)=>(
                <FunnelBar key={i} label={s.label} count={s.count} rate={s.rate} top={funnelSteps[0].count} warn={s.warn}/>
              ))}
            </CardContent>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="font-medium">{((ld.closedDeals/ld.impressions)*100).toFixed(3)}% impression → closed deal</div>
              <div className="text-muted-foreground">Based on Meta pixel &amp; CRM data this week</div>
            </CardFooter>
          </Card>

        </div>
      </section>

      {/* ── Zofi's Top Insights ──────────────────────────────────────────────── */}
      <section>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Zofi's Top Insights This Week</p>
        <div className="grid grid-cols-1 gap-3 @xl/main:grid-cols-2">
          {ld.insights.map((ins,i)=><InsightCard key={i} insight={ins}/>)}
        </div>
      </section>

      {/* ── Campaign Lead Quality Monitor ────────────────────────────────────── */}
      <section>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Campaign Lead Quality Monitor</p>
        <Card className={G}>
          <CardHeader>
            <CardTitle>All Campaigns · This Month</CardTitle>
            <CardDescription>Budget burn detector · Lead quality view</CardDescription>
            <CardAction>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20 text-[10px]">{healthCounts.critical} Critical</Badge>
                <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20 text-[10px]">{healthCounts.warning} Warning</Badge>
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">{healthCounts.healthy} Healthy</Badge>
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {["Campaign","Status","Health","Spend","Leads","CPL","Close Rate","MQL Rate"].map(h=>(
                      <th key={h} className={`px-4 py-3 ${h==="Campaign"?"text-left":"text-right"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {ld.campaigns.map(camp=>(
                    <tr key={camp.id} className="transition-colors hover:bg-muted/30"
                      onMouseEnter={e=>(e.currentTarget.style.background="var(--muted)")}
                      onMouseLeave={e=>(e.currentTarget.style.background="")}>
                      <td className="max-w-[200px] truncate px-4 py-3 font-medium">{camp.name}</td>
                      <td className="px-4 py-3 text-right"><StatusBadge status={camp.status}/></td>
                      <td className="px-4 py-3 text-right"><HealthBadge health={camp.health}/></td>
                      <td className="px-4 py-3 text-right font-semibold">${camp.spend.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-semibold">{camp.leads}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">${camp.cpl}</td>
                      <td className={`px-4 py-3 text-right font-bold ${camp.closeRate>=20?"text-emerald-600 dark:text-emerald-400":camp.closeRate>=10?"text-yellow-500":"text-red-500"}`}>{camp.closeRate}%</td>
                      <td className={`px-4 py-3 text-right font-semibold ${camp.mqlRate>=40?"text-emerald-600 dark:text-emerald-400":camp.mqlRate>=20?"text-yellow-500":"text-red-500"}`}>{camp.mqlRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="font-medium">{healthCounts.healthy} healthy · {healthCounts.warning} warning · {healthCounts.critical} critical campaigns</div>
            <div className="text-muted-foreground">Live data · Refreshes on page load</div>
          </CardFooter>
        </Card>
      </section>

    </div>
  );
}

// ─── ECOMMERCE TAB ────────────────────────────────────────────────────────────

function EcommerceTab({ data, loading }: { data: DashData|null; loading: boolean }) {
  const c    = data?.current;
  const p    = data?.previous;
  const curr = data?.currency??"USD";
  const S    = sym(curr);

  const cac       = c&&c.purchases>0 ? c.spend/c.purchases : 0;
  const prevCac   = p&&p.purchases>0 ? p.spend/p.purchases : 0;
  const ltv       = cac*5.1;
  const ltvCac    = cac>0 ? ltv/cac : 0;
  const mer       = c&&c.spend>0 ? c.purchase_value/c.spend : 0;
  const prevMer   = p&&p.spend>0 ? p.purchase_value/p.spend : 0;
  const convRate  = c&&c.clicks>0 ? (c.purchases/c.clicks)*100 : 0;
  const prevConv  = p&&p.clicks>0 ? (p.purchases/p.clicks)*100 : 0;

  const funnel = c ? [
    { label:"Impressions",      count:c.impressions,        rate:100 },
    { label:"Link Clicks",      count:c.clicks,             rate:c.impressions>0?(c.clicks/c.impressions)*100:0 },
    { label:"Landing Page",     count:c.landing_page_views, rate:c.clicks>0?(c.landing_page_views/c.clicks)*100:0 },
    { label:"Add to Cart",      count:c.add_to_cart,        rate:c.landing_page_views>0?(c.add_to_cart/c.landing_page_views)*100:0 },
    { label:"Checkout Started", count:c.checkout,           rate:c.add_to_cart>0?(c.checkout/c.add_to_cart)*100:0 },
    { label:"Purchase",         count:c.purchases,          rate:c.checkout>0?(c.purchases/c.checkout)*100:0 },
  ] : [];

  const G = "*:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs dark:*:data-[slot=card]:bg-card";

  return (
    <div className="flex flex-col gap-8">

      {/* ── Section 1 · KPI Overview ───────────────────────────────────────── */}
      <section>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Performance Overview · This Month</p>
        <div className={`grid grid-cols-1 gap-4 ${G} @xl/main:grid-cols-2 @5xl/main:grid-cols-3`}>
          {loading ? Array(6).fill(0).map((_,i)=><SkeletonCard key={i}/>) : <>
            <StatCard
              label="MER (Marketing Efficiency Ratio)"
              value={mer>0?mer.toFixed(1)+"x":"—"}
              trend={p?pct(mer,prevMer):undefined}
              trendLabel={mer>0&&p?`${(mer-prevMer)>=0?"+":""}${(mer-prevMer).toFixed(1)}x vs last month`:"No conversion data"}
              sub="Target 3x"
            />
            <StatCard
              label="True Profit ROAS"
              value={c?.purchase_roas?c.purchase_roas.toFixed(1)+"x":"—"}
              trend={p?pct(c?.purchase_roas??0,p.purchase_roas):undefined}
              trendLabel={`Avg ${p?.purchase_roas?.toFixed(2)??"—"}x last month`}
              sub={c?.purchase_value?`${fmtM(c.purchase_value,curr)} revenue on ${fmtM(c.spend,curr)}`:"Awaiting conversions"}
            />
            <StatCard
              label="CAC (Cost Per Purchase)"
              value={cac>0?fmtM(cac,curr):"—"}
              trend={prevCac>0?pct(cac,prevCac):undefined}
              trendLabel={cac<prevCac&&prevCac>0?`↓ ${fmtM(prevCac-cac,curr)} better`:prevCac>0?`↑ ${fmtM(cac-prevCac,curr)} worse`:"First month"}
              sub={`LTV ≈ ${ltv>0?fmtM(ltv,curr):"—"}`}
              invertTrend
            />
            <StatCard
              label="LTV : CAC Ratio"
              value={ltvCac>0?ltvCac.toFixed(1)+"x":"—"}
              trendLabel={ltvCac>=3?"Excellent ratio":ltvCac>=2?"Good ratio":"Below target"}
              sub="Min 3x target"
            />
            <StatCard
              label="Total Ad Spend"
              value={c?fmtM(c.spend,curr):"—"}
              trend={p?pct(c?.spend??0,p.spend):undefined}
              trendLabel={p&&c?`${c.spend>=p.spend?"+":""}${fmtM(c.spend-p.spend,curr)} vs last month`:"—"}
              sub={`${data?.campaigns.length??0} campaigns · ${c?.purchases?fmtN(c.purchases)+" purchases":"tracking"}`}
            />
            <StatCard
              label="Wasted Budget (sub-1x ROAS)"
              value={data?(data.wastedSpend>0?fmtM(data.wastedSpend,curr):S+"0.00"):"—"}
              trendLabel={data?.wastedSpend?`${data.campaigns.filter(x=>x.roas>0&&x.roas<1).length} campaigns below 1x ROAS`:"All campaigns healthy"}
              sub="Spend on underperforming campaigns"
              warn={!!data?.wastedSpend&&data.wastedSpend>0}
            />
          </>}
        </div>
      </section>

      {/* ── Section 2 · Campaign Performance ──────────────────────────────── */}
      <section>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Campaign Performance</p>
        <div className={`grid grid-cols-2 gap-4 ${G} @xl/main:grid-cols-3`}>
          {loading ? Array(6).fill(0).map((_,i)=><SkeletonCard key={i}/>) : <>
            <StatCard label="CPM avg"          value={c?S+c.cpm.toFixed(2):"—"}     trend={p?pct(c?.cpm??0,p.cpm):undefined}   trendLabel={`Avg ${p?S+p.cpm.toFixed(2):"—"} last month`}             sub="Cost per 1,000 impressions" invertTrend/>
            <StatCard label="CTR avg"          value={c?c.ctr.toFixed(2)+"%":"—"}   trend={p?pct(c?.ctr??0,p.ctr):undefined}   trendLabel={`Avg ${p?p.ctr.toFixed(2)+"%":"—"} last month`}            sub="Click-through rate"/>
            <StatCard label="CPC avg"          value={c?S+c.cpc.toFixed(2):"—"}     trend={p?pct(c?.cpc??0,p.cpc):undefined}   trendLabel={`Avg ${p?S+p.cpc.toFixed(2):"—"} last month`}              sub="Cost per click" invertTrend/>
            <StatCard label="Conv. Rate"       value={convRate>0?convRate.toFixed(2)+"%":"—"} trend={p?pct(convRate,prevConv):undefined} trendLabel={`Avg ${prevConv>0?prevConv.toFixed(2)+"%":"—"} last month`} sub="Clicks → purchases"/>
            <StatCard label="Frequency"        value={c?c.frequency.toFixed(1)+"x":"—"} trendLabel={(c?.frequency??0)>3.5?"High — above 3.5x limit":"Within healthy range"} sub="Avg impressions per person" warn={!!c&&c.frequency>3.5}/>
            <StatCard label="Cost Per Purchase" value={cac>0?fmtM(cac,curr):"—"}    trend={prevCac>0?pct(cac,prevCac):undefined} trendLabel={cac<prevCac&&prevCac>0?`↓ ${fmtM(prevCac-cac,curr)} better`:"vs last month"} sub={`Target ${fmtM(cac*0.9,curr)}`} invertTrend/>
          </>}
        </div>
      </section>

      {/* ── Section 3 · Performance Charts ────────────────────────────────── */}
      <section>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Performance Charts</p>
        <div className={`grid grid-cols-1 gap-4 ${G} @xl/main:grid-cols-3`}>

          <Card className="@container/card col-span-1 @xl/main:col-span-2">
            <CardHeader>
              <CardTitle>ROAS by Platform</CardTitle>
              <CardDescription>7-day cross-platform comparison</CardDescription>
              <CardAction>
                <div className="flex gap-3 text-[11px]">
                  {[["#6C47FF","Meta"],["#00C9A7","Google"],["#FF6B6B","TikTok"]].map(([col,name])=>(
                    <span key={name} className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="inline-block h-2 w-2 rounded-full" style={{background:col}}/>
                      {name}
                    </span>
                  ))}
                </div>
              </CardAction>
            </CardHeader>
            <CardContent>
              {loading?<Skeleton h={96}/>:data?.daily.length?<RoasChart daily={data.daily}/>:<div className="flex h-24 items-center justify-center text-sm text-muted-foreground">No daily data</div>}
            </CardContent>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="font-medium">Meta · {data?.daily.length??0} days tracked this period</div>
              <div className="text-muted-foreground">Google &amp; TikTok integration adds cross-platform lines</div>
            </CardFooter>
          </Card>

          <Card className="@container/card">
            <CardHeader>
              <CardTitle>Spend by Platform</CardTitle>
              <CardDescription>{c?fmtM(c.spend+data!.platformSpend.google+data!.platformSpend.tiktok,curr)+" total this month":""}</CardDescription>
            </CardHeader>
            <CardContent>
              {loading?<div className="space-y-3"><Skeleton h={12}/><Skeleton h={36}/><Skeleton h={14}/><Skeleton h={14}/><Skeleton h={14}/></div>
                :data?<SpendSplit data={data.platformSpend} currency={curr}/>
                :<div className="text-sm text-muted-foreground">No data</div>}
            </CardContent>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="font-medium">Google &amp; TikTok spend syncs when connected</div>
              <div className="text-muted-foreground">Based on this month's spend</div>
            </CardFooter>
          </Card>

          <Card className="@container/card col-span-1 @xl/main:col-span-1">
            <CardHeader>
              <CardTitle>Pixel Health Score</CardTitle>
              <CardDescription>Tracking accuracy across platforms</CardDescription>
              <CardAction>
                <Badge variant="outline" className="text-emerald-500"><IconCheck className="size-3"/>Live</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {loading?Array(3).fill(0).map((_,i)=><Skeleton key={i} h={36}/>)
                :data?.pixels.map(px=><PixelRow key={px.id} name={px.name} score={px.health}/>)}
            </CardContent>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="font-medium">{data?.pixels.filter(p=>p.health>=90).length??0} of {data?.pixels.length??0} pixels excellent</div>
              <div className="text-muted-foreground">Based on signal quality score</div>
            </CardFooter>
          </Card>
        </div>
      </section>

      {/* ── Section 4 · Creative & Funnel ─────────────────────────────────── */}
      <section>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Creative &amp; Funnel</p>
        <div className={`grid grid-cols-1 gap-4 ${G} @xl/main:grid-cols-2`}>
          <Card className="@container/card">
            <CardHeader>
              <CardTitle>Conversion Funnel</CardTitle>
              <CardDescription>Click → Purchase drop-off · This month</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {loading?Array(6).fill(0).map((_,i)=><Skeleton key={i} h={32}/>)
                :funnel.length?funnel.map((s,i)=><FunnelBar key={i} label={s.label} count={s.count} rate={s.rate} top={funnel[0].count}/>)
                :<div className="flex h-40 items-center justify-center text-sm text-muted-foreground">No funnel data yet</div>}
            </CardContent>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="font-medium">
                {c&&c.impressions>0&&c.purchases>0?`${((c.purchases/c.impressions)*100).toFixed(3)}% impression → purchase`:"Awaiting pixel data"}
              </div>
              <div className="text-muted-foreground">Based on Meta pixel events this month</div>
            </CardFooter>
          </Card>

          <Card className="@container/card">
            <CardHeader>
              <CardTitle>Creative Performance</CardTitle>
              <CardDescription>Hook Rate · Completion · ROAS</CardDescription>
              <CardAction>
                {data&&<Badge variant="outline" className="font-mono text-[10px]">{data.creatives.length} ads</Badge>}
              </CardAction>
            </CardHeader>
            <CardContent>
              {loading?(
                <div className="space-y-3">{Array(5).fill(0).map((_,i)=><Skeleton key={i} h={40}/>)}</div>
              ):!data?.creatives.length?(
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">No video creatives with data</div>
              ):(
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <th className="pb-2 text-left">Creative</th>
                      <th className="pb-2 text-right">Hook</th>
                      <th className="pb-2 text-right">Comp.</th>
                      <th className="pb-2 text-right">ROAS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.creatives.map(cr=>{
                      const rg=cr.roas>=3; const hg=cr.hook_rate>=0.5; const cg=cr.completion_rate>=0.5;
                      return (
                        <tr key={cr.id} className="transition-colors hover:bg-muted/40">
                          <td className="max-w-[110px] truncate py-2.5 font-medium">{cr.name}</td>
                          <td className={`py-2.5 text-right font-semibold ${hg?"text-emerald-600 dark:text-emerald-400":"text-red-500"}`}>{(cr.hook_rate*100).toFixed(0)}%</td>
                          <td className={`py-2.5 text-right font-semibold ${cg?"text-emerald-600 dark:text-emerald-400":"text-red-500"}`}>{(cr.completion_rate*100).toFixed(0)}%</td>
                          <td className="py-2.5 text-right">
                            <Badge variant={rg?"secondary":"destructive"} className="font-mono text-[10px]">{cr.roas>0?cr.roas.toFixed(1)+"x":"—"}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="font-medium">{data?.creatives.filter(c=>c.roas>=3).length??0} of {data?.creatives.length??0} creatives above 3x ROAS</div>
              <div className="text-muted-foreground">Hook = 3s view rate · Comp = thruplay rate</div>
            </CardFooter>
          </Card>
        </div>
      </section>

      {/* ── Section 5 · Campaign Health Monitor ───────────────────────────── */}
      <section>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Campaign Health Monitor</p>
        <Card className={G}>
          <CardHeader>
            <CardTitle>All Campaigns · This Month</CardTitle>
            <CardDescription>Sorted by spend · ROAS red = below 3x · Freq ⚠ = above 3.5x limit</CardDescription>
            <CardAction>
              {data&&<Badge variant="outline" className="font-mono text-[10px]">{data.campaigns.length} campaigns</Badge>}
            </CardAction>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {["Campaign","Status","Spend","ROAS","CTR","CPC","CPM","Freq.","Purchases"].map(h=>(
                      <th key={h} className={`px-4 py-3 ${h==="Campaign"?"text-left":"text-right"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loading?Array(5).fill(0).map((_,i)=>(
                    <tr key={i}>{Array(9).fill(0).map((_,j)=><td key={j} className="px-4 py-3"><Skeleton h={14}/></td>)}</tr>
                  )):!data?.campaigns.length?(
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">No campaign spend this month</td></tr>
                  ):data.campaigns.map(camp=>{
                    const rg=camp.roas>=3; const fw=camp.frequency>3.5;
                    return (
                      <tr key={camp.id} className="transition-colors hover:bg-muted/30"
                        onMouseEnter={e=>(e.currentTarget.style.background="var(--muted)")}
                        onMouseLeave={e=>(e.currentTarget.style.background="")}>
                        <td className="max-w-[200px] truncate px-4 py-3 font-medium">{camp.name}</td>
                        <td className="px-4 py-3 text-right"><StatusBadge status={camp.status}/></td>
                        <td className="px-4 py-3 text-right font-semibold">{fmtM(camp.spend,curr)}</td>
                        <td className={`px-4 py-3 text-right font-bold ${camp.roas===0?"text-muted-foreground":rg?"text-emerald-600 dark:text-emerald-400":"text-red-500"}`}>{camp.roas===0?"—":camp.roas.toFixed(2)+"x"}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{camp.ctr.toFixed(2)}%</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{camp.cpc>0?S+camp.cpc.toFixed(2):"—"}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{camp.cpm>0?S+camp.cpm.toFixed(2):"—"}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${fw?"text-red-500":"text-muted-foreground"}`}>{camp.frequency>0?camp.frequency.toFixed(1)+"x":"—"}{fw?" ⚠":""}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${camp.purchases>0?"text-emerald-600 dark:text-emerald-400":"text-muted-foreground"}`}>{camp.purchases>0?fmtN(camp.purchases):"—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="font-medium">
              {data?`${data.campaigns.filter(c=>c.roas>=3).length} above 3x ROAS · ${data.campaigns.filter(c=>c.frequency>3.5).length} with high frequency`:"Loading..."}
            </div>
            <div className="text-muted-foreground">Live data from Meta Ads · Refreshes on page load</div>
          </CardFooter>
        </Card>
      </section>

    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function SectionCards() {
  const [data, setData]       = useState<DashData|null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("lead");

  useEffect(()=>{
    if(typeof window==="undefined") return;
    const raw = window.localStorage.getItem("meta_ads_auth");
    if(!raw){ setLoading(false); return; }
    try {
      const saved = JSON.parse(raw) as { accessToken?:string; selectedAccount?:{id:string}|null; accounts?:{id:string}[] };
      const tok = saved.accessToken;
      const acct = saved.selectedAccount??saved.accounts?.[0];
      if(!tok||!acct?.id){ setLoading(false); return; }
      fetchAll(tok, acct.id.replace(/^act_/,""))
        .then(setData).catch(e=>setError(String(e))).finally(()=>setLoading(false));
    } catch(e){ setError(String(e)); setLoading(false); }
  },[]);

  if(error) return (
    <div className="px-4 lg:px-6">
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">Failed to load: {error}</div>
    </div>
  );

  const tabs: { id: Tab; label: string; icon: React.ReactNode; description: string }[] = [
    {
      id: "lead",
      label: "Lead Generation",
      icon: <IconUsers size={15}/>,
      description: "CPL · CPQL · Close Rate · Funnel",
    },
    {
      id: "ecommerce",
      label: "Ecommerce",
      icon: <IconShoppingCart size={15}/>,
      description: "ROAS · CAC · MER · Creative",
    },
  ];

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6">

      {/* ── Tab Switcher ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <div className="inline-flex w-fit items-center gap-1 rounded-xl border bg-muted/50 p-1.5 shadow-inner">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                group relative flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium
                transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                ${activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                }
              `}
            >
              <span className={`transition-colors ${activeTab === tab.id ? "text-violet-500" : "text-muted-foreground group-hover:text-foreground"}`}>
                {tab.icon}
              </span>
              <span>{tab.label}</span>
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-1/2 h-0.5 w-8 -translate-x-1/2 translate-y-0.5 rounded-full bg-violet-500 opacity-0" />
              )}
            </button>
          ))}
        </div>
        <p className="pl-1.5 text-[11px] text-muted-foreground">
          {tabs.find(t=>t.id===activeTab)?.description}
        </p>
      </div>

      {/* ── Tab Content ───────────────────────────────────────────────────── */}
      {activeTab === "lead"
        ? <LeadGenTab/>
        : <EcommerceTab data={data} loading={loading}/>
      }

    </div>
  );
}