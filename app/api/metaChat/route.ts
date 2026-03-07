import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const META_VERSION = "v25.0";
const CLAUDE_MODEL = "claude-sonnet-4-5";
const BASE = `https://graph.facebook.com/${META_VERSION}`;

// ─── BigInt-safe JSON parser ──────────────────────────────────────────────────
// Meta IDs are 18-digit integers that exceed JS Number.MAX_SAFE_INTEGER.
// Parsing them naively corrupts them (120212214334200355 → 120212214334200320).
// This quotes bare integers ≥16 digits BEFORE JSON.parse touches them.
function safeParseJSON(text: string): unknown {
  const safe = text.replace(/:(\s*)(-?\d{16,})([,\}\]])/g, (_m, sp, n, tail) => `:"${n}"${tail}`);
  return JSON.parse(safe);
}

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert Meta Ads manager AI. You help users manage Facebook/Instagram campaigns through natural language.

You manage the full hierarchy: Campaigns → Ad Sets → Ads, plus Custom Audiences.

CAMPAIGNS: list, get, create, update budget/status/objective, delete, insights
AD SETS: list, create with targeting, update budget/status/targeting, insights
ADS: list, update status
AUDIENCES: list, create custom, create lookalike
BULK: pause or activate multiple campaigns at once

Behavioral rules:
1. Always fetch real data before acting — never guess IDs or names.
2. "Best performing" = highest ROAS → CTR → lowest CPC.
3. When changing budgets, state: "Increasing from $X to $Y (+Z%)".
4. Be concise and action-oriented. No filler.
5. Budgets are in CENTS (e.g. $50/day = 5000).
6. ARCHIVE vs DELETE: Archive is reversible. Delete is permanent — require explicit confirmation.
7. Warn before any destructive action.
8. Before create_adset, call get_campaign to check bid_strategy. If LOWEST_COST_WITH_BID_CAP or COST_CAP, you MUST include bid_amount_cents — ask the user for it if missing.
9. Never send bid_strategy in create_adset — the ad set inherits it from the campaign.
10. LINK_CLICKS optimization always uses IMPRESSIONS billing (auto-corrected).
11. Always treat ALL IDs as strings, never numbers.
12. For bulk ops, list campaigns first to confirm scope before executing.`;

// ─── Tools ────────────────────────────────────────────────────────────────────
const TOOLS = [
  // Campaigns
  {
    name: "list_campaigns",
    description: "List all campaigns with ID, name, status, objective, daily/lifetime budget.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_campaign",
    description: "Fetch full details for one campaign including bid_strategy. Call before create_adset.",
    input_schema: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"] },
  },
  {
    name: "get_campaign_insights",
    description: "Performance metrics for campaigns: spend, impressions, clicks, CTR, CPC, ROAS.",
    input_schema: {
      type: "object",
      properties: {
        date_preset: { type: "string", enum: ["last_7d", "last_14d", "last_30d", "last_90d"] },
        campaign_ids: { type: "array", items: { type: "string" } },
      },
      required: ["date_preset"],
    },
  },
  {
    name: "create_campaign",
    description: "Create a new campaign. Always starts PAUSED.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        objective: { type: "string", enum: ["OUTCOME_TRAFFIC","OUTCOME_LEADS","OUTCOME_SALES","OUTCOME_ENGAGEMENT","OUTCOME_AWARENESS","OUTCOME_APP_PROMOTION"] },
        special_ad_category: { type: "string", enum: ["NONE","EMPLOYMENT","HOUSING","CREDIT"] },
        daily_budget_cents: { type: "number" },
      },
      required: ["name", "objective", "special_ad_category"],
    },
  },
  {
    name: "update_campaign_budget",
    description: "Update a campaign's daily budget. In CENTS.",
    input_schema: {
      type: "object",
      properties: { campaign_id: { type: "string" }, new_daily_budget_cents: { type: "number" }, reason: { type: "string" } },
      required: ["campaign_id", "new_daily_budget_cents", "reason"],
    },
  },
  {
    name: "update_campaign_status",
    description: "Change campaign status: ACTIVE, PAUSED, or ARCHIVED.",
    input_schema: {
      type: "object",
      properties: { campaign_id: { type: "string" }, status: { type: "string", enum: ["ACTIVE","PAUSED","ARCHIVED"] }, reason: { type: "string" } },
      required: ["campaign_id", "status", "reason"],
    },
  },
  {
    name: "update_campaign_objective",
    description: "Change a campaign's objective.",
    input_schema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        objective: { type: "string", enum: ["OUTCOME_TRAFFIC","OUTCOME_LEADS","OUTCOME_SALES","OUTCOME_ENGAGEMENT","OUTCOME_AWARENESS","OUTCOME_APP_PROMOTION"] },
        reason: { type: "string" },
      },
      required: ["campaign_id", "objective", "reason"],
    },
  },
  {
    name: "delete_campaign",
    description: "PERMANENTLY delete a campaign. Only call when user explicitly confirms.",
    input_schema: {
      type: "object",
      properties: { campaign_id: { type: "string" }, campaign_name: { type: "string" }, confirmed: { type: "boolean" } },
      required: ["campaign_id", "campaign_name", "confirmed"],
    },
  },
  {
    name: "bulk_update_campaign_status",
    description: "Pause or activate multiple campaigns at once.",
    input_schema: {
      type: "object",
      properties: { campaign_ids: { type: "array", items: { type: "string" } }, status: { type: "string", enum: ["ACTIVE","PAUSED"] }, reason: { type: "string" } },
      required: ["campaign_ids", "status", "reason"],
    },
  },

  // Ad Sets
  {
    name: "list_adsets",
    description: "List ad sets in a campaign with targeting, budget, bid_strategy.",
    input_schema: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"] },
  },
  {
    name: "create_adset",
    description: "Create a new ad set. Check campaign bid_strategy with get_campaign first.",
    input_schema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        name: { type: "string" },
        daily_budget_cents: { type: "number" },
        targeting_countries: { type: "array", items: { type: "string" }, description: "ISO codes e.g. ['US','AE']" },
        age_min: { type: "number" },
        age_max: { type: "number" },
        optimization_goal: { type: "string", enum: ["LINK_CLICKS","IMPRESSIONS","REACH","LEAD_GENERATION","CONVERSIONS","APP_INSTALLS"] },
        billing_event: { type: "string", enum: ["IMPRESSIONS","LINK_CLICKS"] },
        bid_amount_cents: { type: "number", description: "Required when campaign uses LOWEST_COST_WITH_BID_CAP or COST_CAP." },
        custom_audience_id: { type: "string" },
      },
      required: ["campaign_id", "name", "daily_budget_cents", "targeting_countries", "optimization_goal", "billing_event"],
    },
  },
  {
    name: "update_adset_targeting",
    description: "Update targeting for an existing ad set: countries, age range, custom audiences.",
    input_schema: {
      type: "object",
      properties: {
        adset_id: { type: "string" },
        targeting_countries: { type: "array", items: { type: "string" } },
        age_min: { type: "number" },
        age_max: { type: "number" },
        custom_audience_ids: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
      },
      required: ["adset_id", "reason"],
    },
  },
  {
    name: "update_adset_budget",
    description: "Update an ad set's daily budget. In CENTS.",
    input_schema: {
      type: "object",
      properties: { adset_id: { type: "string" }, new_daily_budget_cents: { type: "number" }, reason: { type: "string" } },
      required: ["adset_id", "new_daily_budget_cents", "reason"],
    },
  },
  {
    name: "update_adset_status",
    description: "Pause, activate, or archive an ad set.",
    input_schema: {
      type: "object",
      properties: { adset_id: { type: "string" }, status: { type: "string", enum: ["ACTIVE","PAUSED","ARCHIVED"] }, reason: { type: "string" } },
      required: ["adset_id", "status", "reason"],
    },
  },
  {
    name: "get_adset_insights",
    description: "Performance metrics for ad sets within a campaign.",
    input_schema: {
      type: "object",
      properties: { campaign_id: { type: "string" }, date_preset: { type: "string", enum: ["last_7d","last_14d","last_30d","last_90d"] } },
      required: ["campaign_id", "date_preset"],
    },
  },

  // Ads
  {
    name: "list_ads",
    description: "List ads in an ad set.",
    input_schema: { type: "object", properties: { adset_id: { type: "string" } }, required: ["adset_id"] },
  },
  {
    name: "update_ad_status",
    description: "Pause or activate a specific ad.",
    input_schema: {
      type: "object",
      properties: { ad_id: { type: "string" }, status: { type: "string", enum: ["ACTIVE","PAUSED"] }, reason: { type: "string" } },
      required: ["ad_id", "status", "reason"],
    },
  },

  // Custom Audiences
  {
    name: "list_custom_audiences",
    description: "List all custom audiences: ID, name, type, approximate size.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_custom_audience",
    description: "Create a new empty custom audience. Customer data can be uploaded after creation.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" }, description: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "create_lookalike_audience",
    description: "Create a lookalike audience from an existing custom audience.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        source_audience_id: { type: "string" },
        country: { type: "string", description: "ISO country code e.g. 'US'" },
        ratio: { type: "number", description: "0.01-0.20 (1%-20% of population). Lower = more similar." },
      },
      required: ["name", "source_audience_id", "country", "ratio"],
    },
  },
];

// ─── Executor ─────────────────────────────────────────────────────────────────
type ToolInput = Record<string, unknown>;

async function post(url: string, params: URLSearchParams): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params });
  return safeParseJSON(await res.text());
}

async function executeTool(name: string, input: ToolInput, accessToken: string, adAccountId: string): Promise<unknown> {
  const tok = accessToken;
  const acct = `act_${adAccountId}`;

  // Campaigns ──────────────────────────────────────────────────────────────
  if (name === "list_campaigns") {
    const fields = "id,name,status,objective,daily_budget,lifetime_budget,budget_remaining";
    const res = await fetch(`${BASE}/${acct}/campaigns?fields=${fields}&access_token=${tok}`);
    return safeParseJSON(await res.text());
  }

  if (name === "get_campaign") {
    const id = String(input.campaign_id);
    const fields = "id,name,status,objective,daily_budget,lifetime_budget,bid_strategy,special_ad_categories";
    const res = await fetch(`${BASE}/${id}?fields=${fields}&access_token=${tok}`);
    return safeParseJSON(await res.text());
  }

  if (name === "get_campaign_insights") {
    const { date_preset, campaign_ids } = input as { date_preset: string; campaign_ids?: string[] };
    const fields = "campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,actions,action_values,purchase_roas";
    let url = `${BASE}/${acct}/insights?fields=${fields}&level=campaign&date_preset=${date_preset}&access_token=${tok}`;
    if (campaign_ids?.length) url += `&filtering=${encodeURIComponent(JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaign_ids }]))}`;
    const res = await fetch(url);
    return safeParseJSON(await res.text());
  }

  if (name === "create_campaign") {
    const { name: n, objective, special_ad_category, daily_budget_cents } = input as { name: string; objective: string; special_ad_category: string; daily_budget_cents?: number };
    const p = new URLSearchParams({ name: n, objective, status: "PAUSED", special_ad_categories: JSON.stringify([special_ad_category]), access_token: tok });
    if (daily_budget_cents) p.set("daily_budget", String(Math.round(daily_budget_cents)));
    return post(`${BASE}/${acct}/campaigns`, p);
  }

  if (name === "update_campaign_budget") {
    const { campaign_id, new_daily_budget_cents } = input as { campaign_id: string; new_daily_budget_cents: number };
    return post(`${BASE}/${String(campaign_id)}`, new URLSearchParams({ daily_budget: String(Math.round(new_daily_budget_cents)), access_token: tok }));
  }

  if (name === "update_campaign_status") {
    const { campaign_id, status } = input as { campaign_id: string; status: string };
    return post(`${BASE}/${String(campaign_id)}`, new URLSearchParams({ status, access_token: tok }));
  }

  if (name === "update_campaign_objective") {
    const { campaign_id, objective } = input as { campaign_id: string; objective: string };
    return post(`${BASE}/${String(campaign_id)}`, new URLSearchParams({ objective, access_token: tok }));
  }

  if (name === "delete_campaign") {
    const { campaign_id, confirmed } = input as { campaign_id: string; confirmed: boolean };
    if (!confirmed) return { error: "Deletion not confirmed. Ask the user to explicitly confirm." };
    const res = await fetch(`${BASE}/${String(campaign_id)}?access_token=${encodeURIComponent(tok)}`, { method: "DELETE" });
    return safeParseJSON(await res.text());
  }

  if (name === "bulk_update_campaign_status") {
    const { campaign_ids, status } = input as { campaign_ids: string[]; status: string };
    const results = await Promise.all(
      campaign_ids.map(async (id) => {
        const data = await post(`${BASE}/${String(id)}`, new URLSearchParams({ status, access_token: tok }));
        return { campaign_id: id, ...(data as object) };
      })
    );
    return { results, succeeded: results.filter((r) => (r as Record<string,unknown>).success).length, total: campaign_ids.length };
  }

  // Ad Sets ────────────────────────────────────────────────────────────────
  if (name === "list_adsets") {
    const id = String(input.campaign_id);
    const fields = "id,name,status,daily_budget,lifetime_budget,targeting,bid_strategy,optimization_goal,start_time,end_time";
    const res = await fetch(`${BASE}/${id}/adsets?fields=${fields}&access_token=${tok}`);
    return safeParseJSON(await res.text());
  }

  if (name === "create_adset") {
    const { campaign_id, name: n, daily_budget_cents, targeting_countries, age_min, age_max, optimization_goal, billing_event, bid_amount_cents, custom_audience_id } = input as {
      campaign_id: string; name: string; daily_budget_cents: number;
      targeting_countries: string[]; age_min?: number; age_max?: number;
      optimization_goal: string; billing_event: string;
      bid_amount_cents?: number; custom_audience_id?: string;
    };

    const targeting: Record<string, unknown> = { geo_locations: { countries: targeting_countries } };
    if (age_min) targeting.age_min = age_min;
    if (age_max) targeting.age_max = age_max;
    if (custom_audience_id) targeting.custom_audiences = [{ id: String(custom_audience_id) }];

    // LINK_CLICKS optimization requires IMPRESSIONS billing (Meta rule)
    const effectiveBilling = optimization_goal === "LINK_CLICKS" && billing_event === "LINK_CLICKS" ? "IMPRESSIONS" : billing_event;

    const p = new URLSearchParams({
      campaign_id: String(campaign_id), name: n,
      daily_budget: String(Math.round(daily_budget_cents)),
      targeting: JSON.stringify(targeting),
      optimization_goal, billing_event: effectiveBilling,
      status: "PAUSED", access_token: tok,
    });
    // Never send bid_strategy — inherited from campaign. Only send bid_amount when required.
    if (bid_amount_cents) p.set("bid_amount", String(Math.round(bid_amount_cents)));
    return post(`${BASE}/${acct}/adsets`, p);
  }

  if (name === "update_adset_targeting") {
    const { adset_id, targeting_countries, age_min, age_max, custom_audience_ids } = input as {
      adset_id: string; targeting_countries?: string[]; age_min?: number; age_max?: number; custom_audience_ids?: string[];
    };
    const targeting: Record<string, unknown> = {};
    if (targeting_countries?.length) targeting.geo_locations = { countries: targeting_countries };
    if (age_min) targeting.age_min = age_min;
    if (age_max) targeting.age_max = age_max;
    if (custom_audience_ids?.length) targeting.custom_audiences = custom_audience_ids.map((id) => ({ id: String(id) }));
    return post(`${BASE}/${String(adset_id)}`, new URLSearchParams({ targeting: JSON.stringify(targeting), access_token: tok }));
  }

  if (name === "update_adset_budget") {
    const { adset_id, new_daily_budget_cents } = input as { adset_id: string; new_daily_budget_cents: number };
    return post(`${BASE}/${String(adset_id)}`, new URLSearchParams({ daily_budget: String(Math.round(new_daily_budget_cents)), access_token: tok }));
  }

  if (name === "update_adset_status") {
    const { adset_id, status } = input as { adset_id: string; status: string };
    return post(`${BASE}/${String(adset_id)}`, new URLSearchParams({ status, access_token: tok }));
  }

  if (name === "get_adset_insights") {
    const { campaign_id, date_preset } = input as { campaign_id: string; date_preset: string };
    const fields = "adset_id,adset_name,impressions,clicks,spend,ctr,cpc,actions,action_values,purchase_roas";
    const filtering = encodeURIComponent(JSON.stringify([{ field: "campaign.id", operator: "EQUAL", value: String(campaign_id) }]));
    const res = await fetch(`${BASE}/${acct}/insights?fields=${fields}&level=adset&date_preset=${date_preset}&filtering=${filtering}&access_token=${tok}`);
    return safeParseJSON(await res.text());
  }

  // Ads ────────────────────────────────────────────────────────────────────
  if (name === "list_ads") {
    const res = await fetch(`${BASE}/${String(input.adset_id)}/ads?fields=id,name,status,creative{id,name,body,image_url}&access_token=${tok}`);
    return safeParseJSON(await res.text());
  }

  if (name === "update_ad_status") {
    const { ad_id, status } = input as { ad_id: string; status: string };
    return post(`${BASE}/${String(ad_id)}`, new URLSearchParams({ status, access_token: tok }));
  }

  // Audiences ──────────────────────────────────────────────────────────────
  if (name === "list_custom_audiences") {
    const fields = "id,name,subtype,approximate_count,description,delivery_status";
    const res = await fetch(`${BASE}/${acct}/customaudiences?fields=${fields}&access_token=${tok}`);
    return safeParseJSON(await res.text());
  }

  if (name === "create_custom_audience") {
    const { name: n, description } = input as { name: string; description?: string };
    const p = new URLSearchParams({ name: n, subtype: "CUSTOM", access_token: tok });
    if (description) p.set("description", description);
    return post(`${BASE}/${acct}/customaudiences`, p);
  }

  if (name === "create_lookalike_audience") {
    const { name: n, source_audience_id, country, ratio } = input as { name: string; source_audience_id: string; country: string; ratio: number };
    const p = new URLSearchParams({
      name: n, subtype: "LOOKALIKE",
      origin_audience_id: String(source_audience_id),
      lookalike_spec: JSON.stringify({ type: "similarity", ratio, country }),
      access_token: tok,
    });
    return post(`${BASE}/${acct}/customaudiences`, p);
  }

  return { error: `Unknown tool: ${name}` };
}

// ─── Types ────────────────────────────────────────────────────────────────────
type ClaudeMessage = {
  role: "user" | "assistant";
  content: string | ClaudeContentBlock[];
};

type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: ToolInput }
  | { type: "tool_result"; tool_use_id: string; content: string };

// ─── Route handler ────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const { messages, accessToken, adAccountId } = await request.json();

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set in .env.local" }, { status: 500 });
  }
  if (!accessToken || !adAccountId) {
    return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));

      const claudeMessages: ClaudeMessage[] = messages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      let iteration = 0;
      while (iteration++ < 10) {
        const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 2048, system: SYSTEM_PROMPT, tools: TOOLS, messages: claudeMessages }),
        });

        if (!claudeRes.ok) {
          const err = await claudeRes.json().catch(() => ({ message: claudeRes.statusText }));
          send({ type: "error", text: `Claude API error ${claudeRes.status}: ${JSON.stringify(err)}` });
          break;
        }

        // safeParseJSON protects large IDs in Claude's tool_use output too
        const { content, stop_reason } = safeParseJSON(await claudeRes.text()) as { content: ClaudeContentBlock[]; stop_reason: string };

        for (const block of content) {
          if (block.type === "text" && block.text.trim()) send({ type: "text", text: block.text });
        }

        if (stop_reason === "end_turn") break;

        if (stop_reason === "tool_use") {
          claudeMessages.push({ role: "assistant", content });
          const toolResults: ClaudeContentBlock[] = [];

          for (const block of content) {
            if (block.type !== "tool_use") continue;
            send({ type: "tool_call", tool: block.name, input: block.input, text: fmtCall(block.name, block.input) });

            let resultText: string;
            try {
              const result = await executeTool(block.name, block.input, accessToken, adAccountId);
              resultText = JSON.stringify(result);
              send({ type: "tool_result", tool: block.name, text: fmtResult(block.name, result), data: result });
            } catch (err) {
              resultText = JSON.stringify({ error: String(err) });
              send({ type: "error", text: "Tool error: " + String(err) });
            }

            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
          }

          claudeMessages.push({ role: "user", content: toolResults });
          continue;
        }

        break;
      }

      send({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

// ─── Label helpers ────────────────────────────────────────────────────────────
function fmtCall(name: string, i: ToolInput): string {
  const $ = (cents: unknown) => `$${((cents as number) / 100).toFixed(2)}`;
  switch (name) {
    case "list_campaigns":             return "Fetching all campaigns...";
    case "get_campaign":               return `Fetching campaign ${i.campaign_id} details...`;
    case "get_campaign_insights":      return `Fetching campaign performance (${i.date_preset})...`;
    case "create_campaign":            return `Creating campaign "${i.name}" (${i.objective})...`;
    case "update_campaign_budget":     return `Updating campaign ${i.campaign_id} budget → ${$(i.new_daily_budget_cents)}/day`;
    case "update_campaign_status":     return `Setting campaign ${i.campaign_id} → ${i.status}`;
    case "update_campaign_objective":  return `Updating campaign ${i.campaign_id} objective → ${i.objective}`;
    case "delete_campaign":            return `⚠️ Deleting campaign "${i.campaign_name}" permanently...`;
    case "bulk_update_campaign_status":{
      const ids = i.campaign_ids as string[];
      return `Bulk setting ${ids.length} campaign${ids.length !== 1 ? "s" : ""} → ${i.status}...`;
    }
    case "list_adsets":                return `Fetching ad sets for campaign ${i.campaign_id}...`;
    case "create_adset":               return `Creating ad set "${i.name}" in campaign ${i.campaign_id}...`;
    case "update_adset_targeting":     return `Updating targeting for ad set ${i.adset_id}...`;
    case "update_adset_budget":        return `Updating ad set ${i.adset_id} budget → ${$(i.new_daily_budget_cents)}/day`;
    case "update_adset_status":        return `Setting ad set ${i.adset_id} → ${i.status}`;
    case "get_adset_insights":         return `Fetching ad set performance (${i.date_preset})...`;
    case "list_ads":                   return `Fetching ads in ad set ${i.adset_id}...`;
    case "update_ad_status":           return `Setting ad ${i.ad_id} → ${i.status}`;
    case "list_custom_audiences":      return "Fetching custom audiences...";
    case "create_custom_audience":     return `Creating audience "${i.name}"...`;
    case "create_lookalike_audience":  return `Creating lookalike "${i.name}" (${i.country}, ${((i.ratio as number) * 100).toFixed(0)}%)...`;
    default: return `Calling ${name}...`;
  }
}

function fmtResult(name: string, result: unknown): string {
  const r = result as Record<string, unknown>;
  if (r?.error) return `Error: ${JSON.stringify(r.error)}`;
  const count = (key = "data") => { const d = r?.[key] as unknown[]; return d?.length; };
  const ok = (msg: string) => r?.success ? `${msg} ✓` : `Response: ${JSON.stringify(r)}`;
  switch (name) {
    case "list_campaigns":             return `Found ${count() ?? "?"} campaign${count() !== 1 ? "s" : ""}`;
    case "get_campaign":               return r?.id ? `Campaign: ${r.name} (${r.status}, ${r.bid_strategy ?? "auto bid"})` : `Response: ${JSON.stringify(r)}`;
    case "get_campaign_insights":      return `Insights for ${count() ?? "?"} campaign${count() !== 1 ? "s" : ""}`;
    case "create_campaign":            return r?.id ? `Campaign created ✓ (ID: ${r.id})` : `Response: ${JSON.stringify(r)}`;
    case "update_campaign_budget":     return ok("Budget updated");
    case "update_campaign_status":     return ok("Status updated");
    case "update_campaign_objective":  return ok("Objective updated");
    case "delete_campaign":            return ok("Campaign deleted");
    case "bulk_update_campaign_status":return `Bulk update: ${r?.succeeded}/${r?.total} succeeded ✓`;
    case "list_adsets":                return `Found ${count() ?? "?"} ad set${count() !== 1 ? "s" : ""}`;
    case "create_adset":               return r?.id ? `Ad set created ✓ (ID: ${r.id})` : `Response: ${JSON.stringify(r)}`;
    case "update_adset_targeting":     return ok("Targeting updated");
    case "update_adset_budget":        return ok("Ad set budget updated");
    case "update_adset_status":        return ok("Ad set status updated");
    case "get_adset_insights":         return `Insights for ${count() ?? "?"} ad set${count() !== 1 ? "s" : ""}`;
    case "list_ads":                   return `Found ${count() ?? "?"} ad${count() !== 1 ? "s" : ""}`;
    case "update_ad_status":           return ok("Ad status updated");
    case "list_custom_audiences":      return `Found ${count() ?? "?"} audience${count() !== 1 ? "s" : ""}`;
    case "create_custom_audience":     return r?.id ? `Audience created ✓ (ID: ${r.id})` : `Response: ${JSON.stringify(r)}`;
    case "create_lookalike_audience":  return r?.id ? `Lookalike created ✓ (ID: ${r.id})` : `Response: ${JSON.stringify(r)}`;
    default: return "Done";
  }
}