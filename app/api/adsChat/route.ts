import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const CLAUDE_MODEL = "claude-sonnet-4-5";
const META_VERSION = "v25.0";
const META_BASE = `https://graph.facebook.com/${META_VERSION}`;
const GOOGLE_ADS_VERSION = "v18";
const GOOGLE_ADS_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}`;

const AUTO_BID_CAP_CENTS = 500; // default dummy/test bid cap in cents

// ─── BigInt-safe JSON ─────────────────────────────────────────────────────────
function safeParseJSON(text: string): unknown {
  const safe = text.replace(/:(\s*)(-?\d{16,})([,\}\]])/g, (_m, sp, n, tail) => `:"${n}"${tail}`);
  return JSON.parse(safe);
}

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert unified Ad Manager AI that manages BOTH Meta Ads (Facebook/Instagram) AND Google Ads campaigns through natural language in a single conversation.

You manage the full hierarchy for each platform:
- META: Campaigns → Ad Sets → Ads, Custom Audiences, image uploads
- GOOGLE: Campaigns → Ad Groups → Ads → Keywords, Audiences, GAQL reports

PLATFORM PREFIXES: All tool names are prefixed:
- meta_* = Meta Ads (Facebook/Instagram) tools
- google_* = Google Ads tools

CONNECTED PLATFORMS will be provided in the session context. Only call tools for platforms that are connected.

BEHAVIORAL RULES:
1. Always fetch real data before acting — never guess IDs or names.
2. "Best performing" = highest ROAS/ConvRate → CTR → lowest CPC/CPA.
3. When changing budgets, state: "Increasing from $X to $Y (+Z%)".
4. Be concise and action-oriented. No filler.
5. META budgets are in CENTS ($50/day = 5000). GOOGLE budgets are in MICROS ($50/day = 50000000).
6. Always treat ALL IDs and resource names as strings, never numbers.
7. CROSS-PLATFORM INSIGHTS: When both platforms are connected and the user asks general questions (e.g. "how are my campaigns doing?"), proactively fetch data from BOTH platforms and give a unified summary.
8. CROSS-PLATFORM COMPARISONS: You can compare Meta vs Google performance side-by-side — e.g. "Google is driving 3x more conversions but Meta has lower CPCs".
9. DESTRUCTIVE ACTIONS: Warn before any archive/delete/remove. Require explicit confirmation.
10. META image ads: upload_ad_image first → then meta_create_ad with image_hash.
11. GOOGLE RSAs: provide 3–15 headlines and 2–4 descriptions.
12. META Campaign Budget Optimization (CBO): ad sets under CBO campaigns must NOT have daily_budget.
13. GOOGLE tokens expire hourly — if you get UNAUTHENTICATED errors, inform the user their Google token needs refreshing.
14. After any create operation, always confirm the ID/resource name so users know where to find it.
15. When the user says "my campaigns" without specifying a platform, query BOTH if connected.
16. META CAMPAIGN CREATION: Always pass use_cbo. Set use_cbo=true when providing a campaign-level daily_budget_cents (CBO). Set use_cbo=false when budgets will be managed per ad set. This is required by the Meta API.
17. META AD SET CREATION: Before calling meta_create_adset, collect the needed inputs from the user when they are real campaign settings. For dummy/test setups, you may auto-fill safe defaults.
    (a) Destination/conversion location (destination_type) — ask "Where should the ad send people? Website, App, Messenger, Instagram Direct, WhatsApp, or Facebook Page?" Use WEBSITE as the dummy default only for test flows.
    (b) Interests — ask "Do you want to target specific interests? If so, tell me the keywords and I will search for matching interest categories."
    (c) Bid cap — if the user does not provide one for a dummy/test setup, auto-add a small default bid cap. If the user explicitly asks for no cap, use lowest-cost automatic bidding instead.
    Never guess real campaign settings; only auto-fill defaults for dummy/test flows.
18. META INTERESTS: When a user mentions interest targeting keywords, call meta_search_interests with those keywords, present the results to the user, confirm which interests to add, then pass the confirmed interest objects into meta_create_adset. Never skip the confirmation step.
19. META OPTIMIZATION GOAL MAPPING — always use the correct API value for the campaign objective:
    - OUTCOME_SALES → optimization_goal: OFFSITE_CONVERSIONS (or VALUE to maximize purchase value)
    - OUTCOME_TRAFFIC → optimization_goal: LINK_CLICKS or LANDING_PAGE_VIEWS
    - OUTCOME_LEADS → optimization_goal: LEAD_GENERATION or QUALITY_LEAD
    - OUTCOME_AWARENESS → optimization_goal: REACH or IMPRESSIONS or AD_RECALL_LIFT
    - OUTCOME_ENGAGEMENT → optimization_goal: POST_ENGAGEMENT or PAGE_LIKES or CONVERSATIONS
    - OUTCOME_APP_PROMOTION → optimization_goal: APP_INSTALLS or APP_INSTALLS_AND_OFFSITE_CONVERSIONS
    NEVER use "CONVERSIONS" — the correct API value is "OFFSITE_CONVERSIONS".
20. META BID STRATEGY RULES:
    - Default for real campaigns with no cap: set bid_strategy = LOWEST_COST_WITHOUT_CAP and omit bid_amount_cents.
    - For dummy/test ad sets when no cap is supplied: auto-add a small cap using LOWEST_COST_WITH_BID_CAP and bid_amount_cents = 500.
    - If user requests a bid cap: set bid_strategy = LOWEST_COST_WITH_BID_CAP and bid_amount_cents = the amount.
    - If user requests target cost: set bid_strategy = COST_CAP and bid_amount_cents = the target.
    - NEVER set bid_strategy to a capped type without also providing bid_amount_cents.
    - NEVER set bid_amount_cents without a matching capped bid_strategy.`;

// ─── META TOOLS ───────────────────────────────────────────────────────────────
const META_TOOLS = [
  {
    name: "meta_list_campaigns",
    description: "List all Meta (Facebook/Instagram) campaigns with ID, name, status, objective, budget.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "meta_get_campaign_insights",
    description: "Meta campaign performance: spend, impressions, clicks, CTR, CPC, ROAS.",
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
    name: "meta_create_campaign",
    description:
      "Create a new Meta campaign (starts PAUSED). ALWAYS pass use_cbo: set true for CBO (campaign-level budget), false for ad-set level budgets. This field is required by the Meta API.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        objective: {
          type: "string",
          enum: [
            "OUTCOME_TRAFFIC",
            "OUTCOME_LEADS",
            "OUTCOME_SALES",
            "OUTCOME_ENGAGEMENT",
            "OUTCOME_AWARENESS",
            "OUTCOME_APP_PROMOTION",
          ],
        },
        special_ad_category: { type: "string", enum: ["NONE", "EMPLOYMENT", "HOUSING", "CREDIT"] },
        daily_budget_cents: {
          type: "number",
          description: "Campaign-level daily budget in cents. Only for CBO (use_cbo=true).",
        },
        use_cbo: {
          type: "boolean",
          description:
            "REQUIRED. true = Campaign Budget Optimization (Meta distributes budget across ad sets). false = each ad set controls its own budget.",
        },
      },
      required: ["name", "objective", "special_ad_category", "use_cbo"],
    },
  },
  {
    name: "meta_update_campaign_budget",
    description: "Update a Meta campaign's daily budget (in CENTS).",
    input_schema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        new_daily_budget_cents: { type: "number" },
        reason: { type: "string" },
      },
      required: ["campaign_id", "new_daily_budget_cents", "reason"],
    },
  },
  {
    name: "meta_update_campaign_status",
    description: "Change Meta campaign status: ACTIVE, PAUSED, or ARCHIVED.",
    input_schema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        status: { type: "string", enum: ["ACTIVE", "PAUSED", "ARCHIVED"] },
        reason: { type: "string" },
      },
      required: ["campaign_id", "status", "reason"],
    },
  },
  {
    name: "meta_bulk_update_campaign_status",
    description: "Pause or activate multiple Meta campaigns at once.",
    input_schema: {
      type: "object",
      properties: {
        campaign_ids: { type: "array", items: { type: "string" } },
        status: { type: "string", enum: ["ACTIVE", "PAUSED"] },
        reason: { type: "string" },
      },
      required: ["campaign_ids", "status", "reason"],
    },
  },
  {
    name: "meta_list_adsets",
    description: "List Meta ad sets in a campaign.",
    input_schema: {
      type: "object",
      properties: { campaign_id: { type: "string" } },
      required: ["campaign_id"],
    },
  },
  // ── FIX #2, #3, #4: Added destination_type (required), interests, and explicit bid cap guidance ──
  {
    name: "meta_create_adset",
    description:
      "Create a Meta ad set. For real campaigns, collect destination_type, interests, and bid cap preference. For dummy/test setups, the backend can auto-fill a default bid cap. For CBO campaigns, omit daily_budget_cents.",
    input_schema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        name: { type: "string" },
        daily_budget_cents: {
          type: "number",
          description: "Daily budget in cents. Omit for CBO campaigns.",
        },
        destination_type: {
          type: "string",
          enum: [
            "WEBSITE",
            "APP",
            "MESSENGER",
            "INSTAGRAM_DIRECT",
            "WHATSAPP",
            "ON_AD",
            "FACEBOOK",
            "SHOP_AUTOMATIC",
          ],
          description:
            "REQUIRED. Conversion location — where the ad sends people. Must be collected from the user before creating the ad set.",
        },
        targeting_countries: { type: "array", items: { type: "string" } },
        age_min: { type: "number" },
        age_max: { type: "number" },
        interests: {
          type: "array",
          description:
            "Interest targeting objects. Each requires id and name. Use meta_search_interests to find IDs from keywords, then confirm selections with the user before including here.",
          items: {
            type: "object",
            properties: {
              id:   { type: "string", description: "Meta interest ID" },
              name: { type: "string", description: "Human-readable interest name" },
            },
            required: ["id", "name"],
          },
        },
        optimization_goal: {
          type: "string",
          // These are the EXACT values Meta's API accepts as of v25.0.
          // Common mappings: "conversions" → OFFSITE_CONVERSIONS, "app installs" → APP_INSTALLS,
          // "reach" → REACH, "traffic/clicks" → LINK_CLICKS or LANDING_PAGE_VIEWS,
          // "leads" → LEAD_GENERATION, "video views" → THRUPLAY, "purchase value" → VALUE.
          // For OUTCOME_SALES campaigns use OFFSITE_CONVERSIONS or VALUE.
          enum: [
            "OFFSITE_CONVERSIONS",
            "LINK_CLICKS",
            "LANDING_PAGE_VIEWS",
            "IMPRESSIONS",
            "REACH",
            "LEAD_GENERATION",
            "QUALITY_LEAD",
            "APP_INSTALLS",
            "APP_INSTALLS_AND_OFFSITE_CONVERSIONS",
            "VALUE",
            "THRUPLAY",
            "POST_ENGAGEMENT",
            "PAGE_LIKES",
            "EVENT_RESPONSES",
            "CONVERSATIONS",
            "MESSAGING_PURCHASE_CONVERSION",
            "MESSAGING_APPOINTMENT_CONVERSION",
            "ENGAGED_USERS",
            "AD_RECALL_LIFT",
          ],
          description:
            "Meta API optimization goal. For OUTCOME_SALES → use OFFSITE_CONVERSIONS or VALUE. For OUTCOME_TRAFFIC → use LINK_CLICKS or LANDING_PAGE_VIEWS. For OUTCOME_LEADS → use LEAD_GENERATION. For OUTCOME_AWARENESS → use REACH or IMPRESSIONS. For OUTCOME_ENGAGEMENT → use POST_ENGAGEMENT or PAGE_LIKES.",
        },
        billing_event: { type: "string", enum: ["IMPRESSIONS", "LINK_CLICKS"] },
        bid_strategy: {
          type: "string",
          enum: ["LOWEST_COST_WITHOUT_CAP", "LOWEST_COST_WITH_BID_CAP", "COST_CAP"],
          description:
            "Bidding strategy. Real campaigns can use LOWEST_COST_WITHOUT_CAP. Dummy/test setups may omit bid_strategy and the backend will auto-apply LOWEST_COST_WITH_BID_CAP with a default bid cap. If the user explicitly requests a manual bid cap, use LOWEST_COST_WITH_BID_CAP or COST_CAP and provide bid_amount_cents.",
        },
        bid_amount_cents: {
          type: "number",
          description:
            "Manual bid cap in cents. If omitted for a dummy/test setup, the backend can auto-add a default bid cap. Required when bid_strategy is LOWEST_COST_WITH_BID_CAP or COST_CAP.",
        },
      },
      required: ["campaign_id", "name", "targeting_countries", "optimization_goal", "billing_event", "destination_type"],
    },
  },
  {
    name: "meta_search_interests",
    description:
      "Search Meta's interest targeting library by keyword. Call this when the user mentions interest targeting. Returns matching interests with IDs and audience sizes. Present results to the user and confirm which to add before calling meta_create_adset.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keyword to search interests for, e.g. 'fitness', 'coffee', 'travel'",
        },
        limit: {
          type: "number",
          description: "Max results to return (default 10, max 25)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "meta_update_adset_status",
    description: "Pause, activate, or archive a Meta ad set.",
    input_schema: {
      type: "object",
      properties: {
        adset_id: { type: "string" },
        status: { type: "string", enum: ["ACTIVE", "PAUSED", "ARCHIVED"] },
        reason: { type: "string" },
      },
      required: ["adset_id", "status", "reason"],
    },
  },
  {
    name: "meta_list_ads",
    description: "List Meta ads in an ad set with full creative details.",
    input_schema: {
      type: "object",
      properties: { adset_id: { type: "string" } },
      required: ["adset_id"],
    },
  },
  {
    name: "meta_get_ad_insights",
    description: "Per-ad Meta performance including ad name, impressions, clicks, spend, CTR, CPC, ROAS.",
    input_schema: {
      type: "object",
      properties: {
        adset_id: { type: "string" },
        campaign_id: { type: "string" },
        date_preset: { type: "string", enum: ["last_7d", "last_14d", "last_30d", "last_90d"] },
      },
      required: ["date_preset"],
    },
  },
  {
    name: "meta_update_ad_status",
    description: "Pause or activate a specific Meta ad.",
    input_schema: {
      type: "object",
      properties: {
        ad_id: { type: "string" },
        status: { type: "string", enum: ["ACTIVE", "PAUSED"] },
        reason: { type: "string" },
      },
      required: ["ad_id", "status", "reason"],
    },
  },
  {
    name: "meta_upload_ad_image",
    description:
      "Upload an image to the Meta ad account image library. Returns image_hash. Call BEFORE meta_create_ad when user provides an image.",
    input_schema: {
      type: "object",
      properties: {
        image_base64: { type: "string" },
        image_filename: { type: "string" },
      },
      required: ["image_base64", "image_filename"],
    },
  },
  {
    name: "meta_create_ad",
    description:
      "Create a Meta ad (image or text/link). WITH image: provide image_hash. WITHOUT image: omit image_hash.",
    input_schema: {
      type: "object",
      properties: {
        adset_id: { type: "string" },
        name: { type: "string" },
        page_id: { type: "string" },
        image_hash: { type: "string" },
        headline: { type: "string" },
        body: { type: "string" },
        link_url: { type: "string" },
        call_to_action: {
          type: "string",
          enum: [
            "LEARN_MORE", "SHOP_NOW", "SIGN_UP", "DOWNLOAD", "CONTACT_US",
            "APPLY_NOW", "GET_OFFER", "ORDER_NOW", "WATCH_MORE", "GET_QUOTE",
            "SUBSCRIBE", "NO_BUTTON",
          ],
        },
        description: { type: "string" },
      },
      required: ["adset_id", "name", "page_id", "headline", "body", "link_url", "call_to_action"],
    },
  },
  {
    name: "meta_list_custom_audiences",
    description: "List all Meta custom audiences.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

// ─── GOOGLE TOOLS ─────────────────────────────────────────────────────────────
const GOOGLE_TOOLS = [
  {
    name: "google_list_campaigns",
    description: "List all Google Ads campaigns with resource name, status, budget, bidding strategy.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "google_get_campaign_metrics",
    description: "Google Ads campaign performance: impressions, clicks, cost, CTR, CPC, conversions, ROAS.",
    input_schema: {
      type: "object",
      properties: {
        date_range: {
          type: "string",
          enum: ["LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_90_DAYS", "THIS_MONTH", "LAST_MONTH"],
        },
        campaign_ids: { type: "array", items: { type: "string" } },
      },
      required: ["date_range"],
    },
  },
  {
    name: "google_create_campaign",
    description: "Create a new Google Ads campaign (starts PAUSED). Budget in MICROS.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        advertising_channel_type: {
          type: "string",
          enum: ["SEARCH", "DISPLAY", "SHOPPING", "VIDEO", "PERFORMANCE_MAX"],
        },
        daily_budget_micros: { type: "number" },
        bidding_strategy: {
          type: "string",
          enum: [
            "MANUAL_CPC", "MAXIMIZE_CLICKS", "MAXIMIZE_CONVERSIONS",
            "TARGET_CPA", "TARGET_ROAS", "MAXIMIZE_CONVERSION_VALUE",
          ],
        },
        target_cpa_micros: { type: "number" },
        target_roas: { type: "number" },
      },
      required: ["name", "advertising_channel_type", "daily_budget_micros", "bidding_strategy"],
    },
  },
  {
    name: "google_update_campaign_budget",
    description: "Update a Google Ads campaign's daily budget (in MICROS: $1 = 1000000).",
    input_schema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        new_daily_budget_micros: { type: "number" },
        reason: { type: "string" },
      },
      required: ["campaign_id", "new_daily_budget_micros", "reason"],
    },
  },
  {
    name: "google_update_campaign_status",
    description: "Change Google Ads campaign status: ENABLED, PAUSED, or REMOVED.",
    input_schema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        status: { type: "string", enum: ["ENABLED", "PAUSED", "REMOVED"] },
        reason: { type: "string" },
      },
      required: ["campaign_id", "status", "reason"],
    },
  },
  {
    name: "google_bulk_update_campaign_status",
    description: "Enable or pause multiple Google Ads campaigns at once.",
    input_schema: {
      type: "object",
      properties: {
        campaign_ids: { type: "array", items: { type: "string" } },
        status: { type: "string", enum: ["ENABLED", "PAUSED"] },
        reason: { type: "string" },
      },
      required: ["campaign_ids", "status", "reason"],
    },
  },
  {
    name: "google_list_ad_groups",
    description: "List Google Ads ad groups in a campaign.",
    input_schema: {
      type: "object",
      properties: { campaign_id: { type: "string" } },
      required: ["campaign_id"],
    },
  },
  {
    name: "google_create_ad_group",
    description: "Create a Google Ads ad group.",
    input_schema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        name: { type: "string" },
        cpc_bid_micros: { type: "number" },
        ad_group_type: {
          type: "string",
          enum: ["SEARCH_STANDARD", "DISPLAY_STANDARD", "SHOPPING_PRODUCT_ADS"],
        },
      },
      required: ["campaign_id", "name", "cpc_bid_micros", "ad_group_type"],
    },
  },
  {
    name: "google_list_keywords",
    description: "List keywords in a Google Ads ad group with match type, bid, Quality Score.",
    input_schema: {
      type: "object",
      properties: { ad_group_id: { type: "string" } },
      required: ["ad_group_id"],
    },
  },
  {
    name: "google_add_keywords",
    description: "Add keywords to a Google Ads ad group.",
    input_schema: {
      type: "object",
      properties: {
        ad_group_id: { type: "string" },
        keywords: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              match_type: { type: "string", enum: ["EXACT", "PHRASE", "BROAD"] },
              cpc_bid_micros: { type: "number" },
            },
            required: ["text", "match_type"],
          },
        },
      },
      required: ["ad_group_id", "keywords"],
    },
  },
  {
    name: "google_list_ads",
    description: "List Google Ads ads in an ad group with headlines, descriptions, URLs.",
    input_schema: {
      type: "object",
      properties: { ad_group_id: { type: "string" } },
      required: ["ad_group_id"],
    },
  },
  {
    name: "google_get_ad_metrics",
    description: "Per-ad Google Ads performance metrics.",
    input_schema: {
      type: "object",
      properties: {
        ad_group_id: { type: "string" },
        campaign_id: { type: "string" },
        date_range: { type: "string", enum: ["LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_90_DAYS"] },
      },
      required: ["date_range"],
    },
  },
  {
    name: "google_create_responsive_search_ad",
    description: "Create a Google Responsive Search Ad (RSA) with 3–15 headlines and 2–4 descriptions.",
    input_schema: {
      type: "object",
      properties: {
        ad_group_id: { type: "string" },
        final_url: { type: "string" },
        headlines: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 15 },
        descriptions: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
        path1: { type: "string" },
        path2: { type: "string" },
      },
      required: ["ad_group_id", "final_url", "headlines", "descriptions"],
    },
  },
  {
    name: "google_get_search_terms_report",
    description: "Google Ads search terms that triggered your ads — find negative keyword opportunities.",
    input_schema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        date_range: { type: "string", enum: ["LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_90_DAYS"] },
      },
      required: ["date_range"],
    },
  },
  {
    name: "google_get_geographic_report",
    description: "Google Ads geographic performance by country/region.",
    input_schema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        date_range: { type: "string", enum: ["LAST_7_DAYS", "LAST_14_DAYS", "LAST_30_DAYS", "LAST_90_DAYS"] },
      },
      required: ["date_range"],
    },
  },
];

// ─── Tool executor ────────────────────────────────────────────────────────────
type ToolInput = Record<string, unknown>;
type Credentials = {
  meta?: { accessToken: string; adAccountId: string };
  google?: { accessToken: string; customerId: string };
};

async function metaPost(url: string, params: URLSearchParams): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  return safeParseJSON(await res.text());
}

async function metaPostForm(url: string, fields: Record<string, string>): Promise<unknown> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(url, { method: "POST", body: form });
  return safeParseJSON(await res.text());
}

async function googleQuery(customerId: string, query: string, accessToken: string): Promise<unknown> {
  const res = await fetch(`${GOOGLE_ADS_BASE}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
    },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

async function googleMutate(customerId: string, operations: unknown[], accessToken: string): Promise<unknown> {
  const res = await fetch(`${GOOGLE_ADS_BASE}/customers/${customerId}/googleAds:mutate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
    },
    body: JSON.stringify({ mutateOperations: operations }),
  });
  return res.json();
}

async function googleBudgetMutate(
  customerId: string,
  operations: unknown[],
  accessToken: string
): Promise<unknown> {
  const res = await fetch(`${GOOGLE_ADS_BASE}/customers/${customerId}/campaignBudgets:mutate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
    },
    body: JSON.stringify({ operations }),
  });
  return res.json();
}

async function executeTool(name: string, input: ToolInput, creds: Credentials): Promise<unknown> {
  // ── META TOOLS ────────────────────────────────────────────────────────────
  if (name.startsWith("meta_")) {
    if (!creds.meta)
      return { error: "Meta Ads is not connected. Ask the user to connect their Meta account first." };
    const { accessToken: tok, adAccountId } = creds.meta;
    const acct = `act_${adAccountId}`;

    if (name === "meta_list_campaigns") {
      const res = await fetch(
        `${META_BASE}/${acct}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget&access_token=${tok}`
      );
      return safeParseJSON(await res.text());
    }

    if (name === "meta_get_campaign_insights") {
      const { date_preset, campaign_ids } = input as { date_preset: string; campaign_ids?: string[] };
      const fields =
        "campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,actions,action_values,purchase_roas";
      let url = `${META_BASE}/${acct}/insights?fields=${fields}&level=campaign&date_preset=${date_preset}&access_token=${tok}`;
      if (campaign_ids?.length)
        url += `&filtering=${encodeURIComponent(
          JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaign_ids }])
        )}`;
      return safeParseJSON(await (await fetch(url)).text());
    }

    // ── FIX #1: Inverted is_adset_budget_sharing_enabled logic ──────────────
    // CBO (use_cbo=true)  → campaign owns budget → adsets do NOT share independently → "false"
    // ABO (use_cbo=false) → each adset owns its own budget → adset budget sharing enabled → "true"
    if (name === "meta_create_campaign") {
      const { name: n, objective, special_ad_category, daily_budget_cents, use_cbo } = input as {
        name: string;
        objective: string;
        special_ad_category: string;
        daily_budget_cents?: number;
        use_cbo?: boolean;
      };

      const isAdsetBudgetSharing = use_cbo === true ? "false" : "true";

      const p = new URLSearchParams({
        name: n,
        objective,
        status: "PAUSED",
        special_ad_categories: JSON.stringify([special_ad_category]),
        is_adset_budget_sharing_enabled: isAdsetBudgetSharing,
        access_token: tok,
      });

      if (daily_budget_cents) p.set("daily_budget", String(Math.round(daily_budget_cents)));

      return metaPost(`${META_BASE}/${acct}/campaigns`, p);
    }

    if (name === "meta_update_campaign_budget") {
      const { campaign_id, new_daily_budget_cents } = input as {
        campaign_id: string;
        new_daily_budget_cents: number;
      };
      return metaPost(
        `${META_BASE}/${String(campaign_id)}`,
        new URLSearchParams({
          daily_budget: String(Math.round(new_daily_budget_cents)),
          access_token: tok,
        })
      );
    }

    if (name === "meta_update_campaign_status") {
      const { campaign_id, status } = input as { campaign_id: string; status: string };
      return metaPost(
        `${META_BASE}/${String(campaign_id)}`,
        new URLSearchParams({ status, access_token: tok })
      );
    }

    if (name === "meta_bulk_update_campaign_status") {
      const { campaign_ids, status } = input as { campaign_ids: string[]; status: string };
      const results = await Promise.all(
        campaign_ids.map(async (id) => {
          const data = await metaPost(
            `${META_BASE}/${String(id)}`,
            new URLSearchParams({ status, access_token: tok })
          );
          return { campaign_id: id, ...(data as object) };
        })
      );
      return {
        results,
        succeeded: results.filter((r) => (r as Record<string, unknown>).success).length,
        total: campaign_ids.length,
      };
    }

    if (name === "meta_list_adsets") {
      const { campaign_id } = input as { campaign_id: string };
      const res = await fetch(
        `${META_BASE}/${String(
          campaign_id
        )}/adsets?fields=id,name,status,daily_budget,targeting,optimization_goal&access_token=${tok}`
      );
      return safeParseJSON(await res.text());
    }

    // ── destination_type, interests, bid_strategy, correct optimization_goal ──
    if (name === "meta_create_adset") {
      const {
        campaign_id,
        name: n,
        daily_budget_cents,
        destination_type,
        targeting_countries,
        age_min,
        age_max,
        interests,
        optimization_goal,
        billing_event,
        bid_strategy,
        bid_amount_cents,
      } = input as {
        campaign_id: string;
        name: string;
        daily_budget_cents?: number;
        destination_type?: string;
        targeting_countries: string[];
        age_min?: number;
        age_max?: number;
        interests?: Array<{ id: string; name: string }>;
        optimization_goal: string;
        billing_event: string;
        bid_strategy?: string;
        bid_amount_cents?: number;
      };

      // Server-side remap: correct any hallucinated optimization_goal values
      const GOAL_REMAP: Record<string, string> = {
        CONVERSIONS: "OFFSITE_CONVERSIONS",
        APP_INSTALLS: "APP_INSTALLS",
      };
      const effectiveGoal = GOAL_REMAP[optimization_goal] ?? optimization_goal;

      const targeting: Record<string, unknown> = {
        geo_locations: { countries: targeting_countries },
        targeting_automation: { advantage_audience: 0 },
      };
      if (age_min) targeting.age_min = age_min;
      if (age_max) targeting.age_max = age_max;

      // Add interests via flexible_spec if provided
      if (interests && interests.length > 0) {
        targeting.flexible_spec = [
          { interests: interests.map((i) => ({ id: i.id, name: i.name })) },
        ];
      }

      const effectiveBilling =
        effectiveGoal === "LINK_CLICKS" && billing_event === "LINK_CLICKS"
          ? "IMPRESSIONS"
          : billing_event;

      const p = new URLSearchParams({
        campaign_id: String(campaign_id),
        name: n,
        targeting: JSON.stringify(targeting),
        optimization_goal: effectiveGoal,
        billing_event: effectiveBilling,
        status: "PAUSED",
        access_token: tok,
      });

      if (destination_type) p.set("destination_type", destination_type);
      if (daily_budget_cents) p.set("daily_budget", String(Math.round(daily_budget_cents)));

      // Bid strategy handling:
      // - Real campaigns can use automatic lowest-cost without cap
      // - Dummy/test setups auto-add a small cap when the caller does not provide one
      // - Explicit capped strategies always keep the provided amount
      const cappedStrategies = ["LOWEST_COST_WITH_BID_CAP", "COST_CAP"];
      const normalizedBidAmount =
        typeof bid_amount_cents === "number" && Number.isFinite(bid_amount_cents)
          ? Math.max(1, Math.round(bid_amount_cents))
          : undefined;

      if (bid_strategy === "LOWEST_COST_WITHOUT_CAP") {
        p.set("bid_strategy", "LOWEST_COST_WITHOUT_CAP");
      } else if (bid_strategy && cappedStrategies.includes(bid_strategy) && normalizedBidAmount) {
        p.set("bid_strategy", bid_strategy);
        p.set("bid_amount", String(normalizedBidAmount));
      } else if (normalizedBidAmount) {
        p.set("bid_strategy", "LOWEST_COST_WITH_BID_CAP");
        p.set("bid_amount", String(normalizedBidAmount));
      } else {
        p.set("bid_strategy", "LOWEST_COST_WITH_BID_CAP");
        p.set("bid_amount", String(AUTO_BID_CAP_CENTS));
      }

      const result = (await metaPost(
        `${META_BASE}/${acct}/adsets`,
        p
      )) as Record<string, unknown>;

      // CBO auto-retry: if Meta complains about budget conflict, strip budget and retry
      if (!result?.id) {
        const err = result?.error as Record<string, unknown> | undefined;
        const isBudgetConflict =
          String(err?.error_subcode) === "1885621" ||
          String(err?.error_user_msg ?? "").toLowerCase().includes("budget");
        if (isBudgetConflict) {
          const p2 = new URLSearchParams({
            campaign_id: String(campaign_id),
            name: n,
            targeting: JSON.stringify(targeting),
            optimization_goal: effectiveGoal,
            billing_event: effectiveBilling,
            status: "PAUSED",
            access_token: tok,
          });
          if (destination_type) p2.set("destination_type", destination_type);
          if (bid_strategy === "LOWEST_COST_WITHOUT_CAP") {
            p2.set("bid_strategy", "LOWEST_COST_WITHOUT_CAP");
          } else if (bid_strategy && cappedStrategies.includes(bid_strategy) && normalizedBidAmount) {
            p2.set("bid_strategy", bid_strategy);
            p2.set("bid_amount", String(normalizedBidAmount));
          } else {
            p2.set("bid_strategy", "LOWEST_COST_WITH_BID_CAP");
            p2.set("bid_amount", String(AUTO_BID_CAP_CENTS));
          }
          const r2 = (await metaPost(`${META_BASE}/${acct}/adsets`, p2)) as Record<string, unknown>;
          if (r2?.id)
            return { ...r2, auto_fixed: true, note: "CBO campaign — budget managed at campaign level. Default bid cap auto-applied." };
        }
      }
      return result;
    }

    // ── FIX #4: meta_search_interests executor ────────────────────────────────
    if (name === "meta_search_interests") {
      const { query, limit = 10 } = input as { query: string; limit?: number };
      const res = await fetch(
        `${META_BASE}/search?type=adinterest&q=${encodeURIComponent(query)}&limit=${Math.min(Number(limit), 25)}&access_token=${tok}`
      );
      const data = safeParseJSON(await res.text()) as Record<string, unknown>;
      const items = (data?.data as Array<Record<string, unknown>> ?? []).map((i) => ({
        id:                          String(i.id),
        name:                        String(i.name),
        audience_size_lower_bound:   i.audience_size_lower_bound,
        audience_size_upper_bound:   i.audience_size_upper_bound,
        topic:                       i.topic,
        path:                        i.path,
      }));
      return { interests: items, count: items.length };
    }

    if (name === "meta_update_adset_status") {
      const { adset_id, status } = input as { adset_id: string; status: string };
      return metaPost(
        `${META_BASE}/${String(adset_id)}`,
        new URLSearchParams({ status, access_token: tok })
      );
    }

    if (name === "meta_list_ads") {
      const { adset_id } = input as { adset_id: string };
      const fields = "id,name,status,creative{id,name,title,body,image_url,thumbnail_url}";
      return safeParseJSON(
        await (
          await fetch(`${META_BASE}/${String(adset_id)}/ads?fields=${fields}&access_token=${tok}`)
        ).text()
      );
    }

    if (name === "meta_get_ad_insights") {
      const { adset_id, campaign_id, date_preset } = input as {
        adset_id?: string;
        campaign_id?: string;
        date_preset: string;
      };
      const fields =
        "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,actions,action_values,purchase_roas";
      let url: string;
      if (adset_id) {
        url = `${META_BASE}/${acct}/insights?fields=${fields}&level=ad&date_preset=${date_preset}&filtering=${encodeURIComponent(
          JSON.stringify([{ field: "adset.id", operator: "EQUAL", value: String(adset_id) }])
        )}&access_token=${tok}`;
      } else if (campaign_id) {
        url = `${META_BASE}/${acct}/insights?fields=${fields}&level=ad&date_preset=${date_preset}&filtering=${encodeURIComponent(
          JSON.stringify([{ field: "campaign.id", operator: "EQUAL", value: String(campaign_id) }])
        )}&access_token=${tok}`;
      } else {
        url = `${META_BASE}/${acct}/insights?fields=${fields}&level=ad&date_preset=${date_preset}&access_token=${tok}`;
      }
      return safeParseJSON(await (await fetch(url)).text());
    }

    if (name === "meta_update_ad_status") {
      const { ad_id, status } = input as { ad_id: string; status: string };
      return metaPost(
        `${META_BASE}/${String(ad_id)}`,
        new URLSearchParams({ status, access_token: tok })
      );
    }

    if (name === "meta_upload_ad_image") {
      const { image_base64, image_filename } = input as {
        image_base64: string;
        image_filename: string;
      };
      if (!image_base64 || image_base64.length < 100)
        return { error: "image_base64 is empty or too short." };
      const binary = atob(image_base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const ext = image_filename.toLowerCase().split(".").pop() ?? "jpg";
      const mimes: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
      };
      const form = new FormData();
      form.append("access_token", tok);
      form.append(
        "filename",
        new Blob([bytes], { type: mimes[ext] ?? "image/jpeg" }),
        image_filename
      );
      const res = await fetch(`${META_BASE}/${acct}/adimages`, { method: "POST", body: form });
      const result = safeParseJSON(await res.text()) as Record<string, unknown>;
      if (result.images) {
        const images = result.images as Record<string, { hash: string; url: string }>;
        const first = Object.values(images)[0];
        if (first) return { success: true, image_hash: first.hash, image_url: first.url };
      }
      return result;
    }

    if (name === "meta_create_ad") {
      const {
        adset_id,
        name: adName,
        page_id,
        image_hash,
        headline,
        body,
        link_url,
        call_to_action,
        description,
      } = input as {
        adset_id: string;
        name: string;
        page_id: string;
        image_hash?: string;
        headline: string;
        body: string;
        link_url: string;
        call_to_action: string;
        description?: string;
      };
      const hasImage = image_hash && image_hash.trim().length > 0;
      const linkData: Record<string, unknown> = {
        link: link_url,
        message: body,
        name: headline,
        call_to_action: { type: call_to_action },
      };
      if (description) linkData.description = description;
      if (hasImage) linkData.image_hash = image_hash!.trim();
      const creativeRes = (await metaPostForm(`${META_BASE}/${acct}/adcreatives`, {
        name: `${adName} Creative`,
        object_story_spec: JSON.stringify({ page_id: String(page_id), link_data: linkData }),
        access_token: tok,
      })) as Record<string, unknown>;
      if (creativeRes.error)
        return { error: `Failed to create creative: ${JSON.stringify(creativeRes.error)}` };
      const adRes = (await metaPostForm(`${META_BASE}/${acct}/ads`, {
        name: adName,
        adset_id: String(adset_id),
        creative: JSON.stringify({ creative_id: String(creativeRes.id) }),
        status: "PAUSED",
        access_token: tok,
      })) as Record<string, unknown>;
      if (adRes.id) {
        const verified = safeParseJSON(
          await (
            await fetch(
              `${META_BASE}/${String(
                adRes.id
              )}?fields=id,name,status,adset_id,campaign_id&access_token=${tok}`
            )
          ).text()
        ) as Record<string, unknown>;
        return {
          success: true,
          ad_id: adRes.id,
          status: "PAUSED",
          ad_type: hasImage ? "image" : "text_link",
          verified_adset_id: verified?.adset_id,
          verified_campaign_id: verified?.campaign_id,
        };
      }
      return adRes;
    }

    if (name === "meta_list_custom_audiences") {
      const res = await fetch(
        `${META_BASE}/${acct}/customaudiences?fields=id,name,subtype,approximate_count&access_token=${tok}`
      );
      return safeParseJSON(await res.text());
    }
  }

  // ── GOOGLE TOOLS ──────────────────────────────────────────────────────────
  if (name.startsWith("google_")) {
    if (!creds.google)
      return { error: "Google Ads is not connected. Ask the user to connect their Google account first." };
    const { accessToken: tok, customerId } = creds.google;

    if (name === "google_list_campaigns") {
      return googleQuery(
        customerId,
        `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.name`,
        tok
      );
    }

    if (name === "google_get_campaign_metrics") {
      const { date_range, campaign_ids } = input as {
        date_range: string;
        campaign_ids?: string[];
      };
      let where = `segments.date DURING ${date_range}`;
      if (campaign_ids?.length)
        where += ` AND campaign.id IN (${campaign_ids.map((id) => `'${id}'`).join(",")})`;
      return googleQuery(
        customerId,
        `SELECT campaign.id, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.average_cpc, metrics.conversions, metrics.conversions_value, metrics.cost_per_conversion FROM campaign WHERE ${where} ORDER BY metrics.cost_micros DESC`,
        tok
      );
    }

    if (name === "google_create_campaign") {
      const {
        name: n,
        advertising_channel_type,
        daily_budget_micros,
        bidding_strategy,
        target_cpa_micros,
        target_roas,
      } = input as {
        name: string;
        advertising_channel_type: string;
        daily_budget_micros: number;
        bidding_strategy: string;
        target_cpa_micros?: number;
        target_roas?: number;
      };
      const budgetRes = (await googleBudgetMutate(
        customerId,
        [
          {
            create: {
              name: `Budget for ${n}`,
              amount_micros: Math.round(daily_budget_micros),
              delivery_method: "STANDARD",
            },
          },
        ],
        tok
      )) as Record<string, unknown>;
      const budgetRn = (
        (budgetRes?.results as Array<Record<string, unknown>>)?.[0]?.resourceName
      ) as string | undefined;
      if (!budgetRn) return { error: "Failed to create budget", details: budgetRes };
      const biddingConfig: Record<string, unknown> = {};
      if (bidding_strategy === "MANUAL_CPC") biddingConfig.manualCpc = {};
      else if (bidding_strategy === "MAXIMIZE_CLICKS") biddingConfig.maximizeClicks = {};
      else if (bidding_strategy === "MAXIMIZE_CONVERSIONS")
        biddingConfig.maximizeConversions = target_cpa_micros
          ? { targetCpaMicros: Math.round(target_cpa_micros) }
          : {};
      else if (bidding_strategy === "TARGET_CPA")
        biddingConfig.targetCpa = { targetCpaMicros: Math.round(target_cpa_micros ?? 0) };
      else if (bidding_strategy === "TARGET_ROAS")
        biddingConfig.targetRoas = { targetRoas: target_roas ?? 1 };
      else if (bidding_strategy === "MAXIMIZE_CONVERSION_VALUE")
        biddingConfig.maximizeConversionValue = target_roas ? { targetRoas: target_roas } : {};
      const campaignRes = (await googleMutate(
        customerId,
        [
          {
            campaignOperation: {
              create: {
                name: n,
                advertisingChannelType: advertising_channel_type,
                status: "PAUSED",
                campaignBudget: budgetRn,
                networkSettings: {
                  targetGoogleSearch: advertising_channel_type === "SEARCH",
                  targetContentNetwork: advertising_channel_type === "DISPLAY",
                },
                ...biddingConfig,
              },
            },
          },
        ],
        tok
      )) as Record<string, unknown>;
      const rn = (
        (
          (campaignRes?.mutateOperationResponses as Array<Record<string, unknown>>)?.[0]
            ?.campaignResult as Record<string, unknown>
        )?.resourceName
      ) as string | undefined;
      return rn
        ? { success: true, resource_name: rn, status: "PAUSED" }
        : { error: "Campaign creation failed", details: campaignRes };
    }

    if (name === "google_update_campaign_budget") {
      const { campaign_id, new_daily_budget_micros } = input as {
        campaign_id: string;
        new_daily_budget_micros: number;
      };
      const current = (await googleQuery(
        customerId,
        `SELECT campaign.id, campaign_budget.resource_name FROM campaign WHERE campaign.id = '${String(
          campaign_id
        )}'`,
        tok
      )) as Record<string, unknown>;
      const budgetRn = (
        (current?.results as Array<Record<string, unknown>>)?.[0]?.campaignBudget as Record<
          string,
          unknown
        >
      )?.resourceName as string | undefined;
      if (!budgetRn) return { error: "Could not find budget", details: current };
      return googleBudgetMutate(
        customerId,
        [
          {
            update: { resource_name: budgetRn, amount_micros: Math.round(new_daily_budget_micros) },
            update_mask: "amount_micros",
          },
        ],
        tok
      );
    }

    if (name === "google_update_campaign_status") {
      const { campaign_id, status } = input as { campaign_id: string; status: string };
      return googleMutate(
        customerId,
        [
          {
            campaignOperation: {
              update: {
                resource_name: `customers/${customerId}/campaigns/${String(campaign_id)}`,
                status,
              },
              update_mask: "status",
            },
          },
        ],
        tok
      );
    }

    if (name === "google_bulk_update_campaign_status") {
      const { campaign_ids, status } = input as { campaign_ids: string[]; status: string };
      const ops = campaign_ids.map((id) => ({
        campaignOperation: {
          update: { resource_name: `customers/${customerId}/campaigns/${String(id)}`, status },
          update_mask: "status",
        },
      }));
      const res = (await googleMutate(customerId, ops, tok)) as Record<string, unknown>;
      return {
        success: true,
        updated: (res?.mutateOperationResponses as Array<unknown>)?.length ?? 0,
        total: campaign_ids.length,
      };
    }

    if (name === "google_list_ad_groups") {
      const { campaign_id } = input as { campaign_id: string };
      return googleQuery(
        customerId,
        `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type, ad_group.cpc_bid_micros FROM ad_group WHERE campaign.id = '${String(
          campaign_id
        )}' AND ad_group.status != 'REMOVED'`,
        tok
      );
    }

    if (name === "google_create_ad_group") {
      const { campaign_id, name: n, cpc_bid_micros, ad_group_type } = input as {
        campaign_id: string;
        name: string;
        cpc_bid_micros: number;
        ad_group_type: string;
      };
      const res = (await googleMutate(
        customerId,
        [
          {
            adGroupOperation: {
              create: {
                name: n,
                campaign: `customers/${customerId}/campaigns/${String(campaign_id)}`,
                status: "ENABLED",
                type: ad_group_type,
                cpc_bid_micros: Math.round(cpc_bid_micros),
              },
            },
          },
        ],
        tok
      )) as Record<string, unknown>;
      const rn = (
        (
          (res?.mutateOperationResponses as Array<Record<string, unknown>>)?.[0]
            ?.adGroupResult as Record<string, unknown>
        )?.resourceName
      ) as string | undefined;
      return rn
        ? { success: true, resource_name: rn }
        : { error: "Ad group creation failed", details: res };
    }

    if (name === "google_list_keywords") {
      const { ad_group_id } = input as { ad_group_id: string };
      return googleQuery(
        customerId,
        `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.cpc_bid_micros, ad_group_criterion.quality_info.quality_score FROM ad_group_criterion WHERE ad_group.id = '${String(
          ad_group_id
        )}' AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED'`,
        tok
      );
    }

    if (name === "google_add_keywords") {
      const { ad_group_id, keywords } = input as {
        ad_group_id: string;
        keywords: Array<{ text: string; match_type: string; cpc_bid_micros?: number }>;
      };
      const ops = keywords.map((kw) => ({
        adGroupCriterionOperation: {
          create: {
            ad_group: `customers/${customerId}/adGroups/${String(ad_group_id)}`,
            status: "ENABLED",
            keyword: { text: kw.text, match_type: kw.match_type },
            ...(kw.cpc_bid_micros ? { cpc_bid_micros: Math.round(kw.cpc_bid_micros) } : {}),
          },
        },
      }));
      const res = (await googleMutate(customerId, ops, tok)) as Record<string, unknown>;
      return {
        success: true,
        added: (res?.mutateOperationResponses as Array<unknown>)?.length ?? 0,
        total: keywords.length,
      };
    }

    if (name === "google_list_ads") {
      const { ad_group_id } = input as { ad_group_id: string };
      return googleQuery(
        customerId,
        `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group_ad.ad.type, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.final_urls FROM ad_group_ad WHERE ad_group.id = '${String(
          ad_group_id
        )}' AND ad_group_ad.status != 'REMOVED'`,
        tok
      );
    }

    if (name === "google_get_ad_metrics") {
      const { ad_group_id, campaign_id, date_range } = input as {
        ad_group_id?: string;
        campaign_id?: string;
        date_range: string;
      };
      let where = `segments.date DURING ${date_range}`;
      if (ad_group_id) where += ` AND ad_group.id = '${String(ad_group_id)}'`;
      else if (campaign_id) where += ` AND campaign.id = '${String(campaign_id)}'`;
      return googleQuery(
        customerId,
        `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group.name, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.conversions FROM ad_group_ad WHERE ${where} ORDER BY metrics.clicks DESC`,
        tok
      );
    }

    if (name === "google_create_responsive_search_ad") {
      const { ad_group_id, final_url, headlines, descriptions, path1, path2 } = input as {
        ad_group_id: string;
        final_url: string;
        headlines: string[];
        descriptions: string[];
        path1?: string;
        path2?: string;
      };
      const res = (await googleMutate(
        customerId,
        [
          {
            adGroupAdOperation: {
              create: {
                ad_group: `customers/${customerId}/adGroups/${String(ad_group_id)}`,
                status: "PAUSED",
                ad: {
                  final_urls: [final_url],
                  type: "RESPONSIVE_SEARCH_AD",
                  responsive_search_ad: {
                    headlines: headlines.map((t) => ({ text: t })),
                    descriptions: descriptions.map((t) => ({ text: t })),
                    ...(path1 ? { path1 } : {}),
                    ...(path2 ? { path2 } : {}),
                  },
                },
              },
            },
          },
        ],
        tok
      )) as Record<string, unknown>;
      const rn = (
        (
          (res?.mutateOperationResponses as Array<Record<string, unknown>>)?.[0]
            ?.adGroupAdResult as Record<string, unknown>
        )?.resourceName
      ) as string | undefined;
      return rn
        ? {
            success: true,
            resource_name: rn,
            headline_count: headlines.length,
            description_count: descriptions.length,
            status: "PAUSED",
          }
        : { error: "RSA creation failed", details: res };
    }

    if (name === "google_get_search_terms_report") {
      const { campaign_id, date_range } = input as { campaign_id?: string; date_range: string };
      let where = `segments.date DURING ${date_range}`;
      if (campaign_id) where += ` AND campaign.id = '${String(campaign_id)}'`;
      return googleQuery(
        customerId,
        `SELECT search_term_view.search_term, search_term_view.status, ad_group.name, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.conversions FROM search_term_view WHERE ${where} ORDER BY metrics.clicks DESC LIMIT 100`,
        tok
      );
    }

    if (name === "google_get_geographic_report") {
      const { campaign_id, date_range } = input as { campaign_id?: string; date_range: string };
      let where = `segments.date DURING ${date_range}`;
      if (campaign_id) where += ` AND campaign.id = '${String(campaign_id)}'`;
      return googleQuery(
        customerId,
        `SELECT geographic_view.country_criterion_id, geographic_view.location_type, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.conversions FROM geographic_view WHERE ${where} ORDER BY metrics.clicks DESC LIMIT 50`,
        tok
      );
    }
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
  const { messages, meta, google } = (await request.json()) as {
    messages: Array<{ role: string; content: string }>;
    meta?: { accessToken: string; adAccountId: string };
    google?: { accessToken: string; customerId: string };
  };

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }
  if (!meta && !google) {
    return NextResponse.json({ error: "No platforms connected" }, { status: 400 });
  }

  const creds: Credentials = { meta, google };

  const availableTools = [...(meta ? META_TOOLS : []), ...(google ? GOOGLE_TOOLS : [])];

  const connectedPlatforms = [
    meta ? "Meta Ads (Facebook/Instagram)" : null,
    google ? "Google Ads" : null,
  ]
    .filter(Boolean)
    .join(" and ");

  const systemWithContext =
    `${SYSTEM_PROMPT}\n\nCONNECTED PLATFORMS: ${connectedPlatforms}.\n` +
    `${meta ? `Meta Ad Account ID: act_${meta.adAccountId}` : "Meta Ads: NOT CONNECTED"}\n` +
    `${google ? `Google Ads Customer ID: ${google.customerId}` : "Google Ads: NOT CONNECTED"}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
        } catch {
          /* closed */
        }
      };

      try {
        const claudeMessages: ClaudeMessage[] = messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        let iteration = 0;
        while (iteration++ < 15) {
          const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: CLAUDE_MODEL,
              max_tokens: 4096,
              system: systemWithContext,
              tools: availableTools,
              messages: claudeMessages,
            }),
          });

          if (!claudeRes.ok) {
            const err = await claudeRes.json().catch(() => ({ message: claudeRes.statusText }));
            send({ type: "error", text: `Claude API error ${claudeRes.status}: ${JSON.stringify(err)}` });
            break;
          }

          const { content, stop_reason } = (await claudeRes.json()) as {
            content: ClaudeContentBlock[];
            stop_reason: string;
          };

          for (const block of content) {
            if (block.type === "text" && block.text.trim())
              send({ type: "text", text: block.text });
          }

          if (stop_reason === "end_turn") break;

          if (stop_reason === "tool_use") {
            claudeMessages.push({ role: "assistant", content });
            const toolResults: ClaudeContentBlock[] = [];

            for (const block of content) {
              if (block.type !== "tool_use") continue;
              const platform = block.name.startsWith("meta_") ? "meta" : "google";
              send({
                type: "tool_call",
                tool: block.name,
                platform,
                input: block.input,
                text: fmtCall(block.name, block.input),
              });
              send({ type: "ping" });

              let resultText: string;
              const timeout = block.name === "meta_upload_ad_image" ? 120_000 : 30_000;
              try {
                const result = await Promise.race([
                  executeTool(block.name, block.input, creds),
                  new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error(`Tool ${block.name} timed out`)), timeout)
                  ),
                ]);
                resultText = JSON.stringify(result);
                send({
                  type: "tool_result",
                  tool: block.name,
                  platform,
                  text: fmtResult(block.name, result),
                  data: result,
                });
              } catch (err) {
                resultText = JSON.stringify({ error: String(err) });
                send({ type: "error", text: "Tool error: " + String(err) });
              }
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: resultText,
              });
            }

            claudeMessages.push({ role: "user", content: toolResults });
            continue;
          }
          break;
        }
      } catch (err) {
        send({ type: "error", text: `Server error: ${String(err)}` });
      } finally {
        send({ type: "done" });
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ─── Label helpers ────────────────────────────────────────────────────────────
function fmtCall(name: string, i: ToolInput): string {
  const metaCents = (c: unknown) => `$${((c as number) / 100).toFixed(2)}`;
  const googleMicros = (m: unknown) => `$${((m as number) / 1_000_000).toFixed(2)}`;
  const map: Record<string, string> = {
    meta_list_campaigns: "Fetching Meta campaigns…",
    meta_get_campaign_insights: `Fetching Meta insights (${i.date_preset})…`,
    meta_create_campaign: `Creating Meta campaign "${i.name}"…`,
    meta_update_campaign_budget: `Updating Meta campaign budget → ${metaCents(i.new_daily_budget_cents)}/day`,
    meta_update_campaign_status: `Setting Meta campaign ${i.campaign_id} → ${i.status}`,
    meta_bulk_update_campaign_status: `Bulk setting ${(i.campaign_ids as string[])?.length} Meta campaigns → ${i.status}…`,
    meta_list_adsets: `Fetching Meta ad sets for campaign ${i.campaign_id}…`,
    meta_create_adset: `Creating Meta ad set "${i.name}"…`,
    meta_search_interests: `Searching Meta interests for "${i.query}"…`,
    meta_update_adset_status: `Setting Meta ad set ${i.adset_id} → ${i.status}`,
    meta_list_ads: `Fetching Meta ads in ad set ${i.adset_id}…`,
    meta_get_ad_insights: `Fetching Meta ad performance (${i.date_preset})…`,
    meta_update_ad_status: `Setting Meta ad ${i.ad_id} → ${i.status}`,
    meta_upload_ad_image: `Uploading image "${i.image_filename}" to Meta…`,
    meta_create_ad: `Creating Meta ${i.image_hash ? "image" : "text/link"} ad "${i.name}"…`,
    meta_list_custom_audiences: "Fetching Meta custom audiences…",
    google_list_campaigns: "Fetching Google Ads campaigns…",
    google_get_campaign_metrics: `Fetching Google Ads metrics (${i.date_range})…`,
    google_create_campaign: `Creating Google Ads campaign "${i.name}"…`,
    google_update_campaign_budget: `Updating Google campaign budget → ${googleMicros(i.new_daily_budget_micros)}/day`,
    google_update_campaign_status: `Setting Google campaign ${i.campaign_id} → ${i.status}`,
    google_bulk_update_campaign_status: `Bulk setting ${(i.campaign_ids as string[])?.length} Google campaigns → ${i.status}…`,
    google_list_ad_groups: `Fetching Google ad groups for campaign ${i.campaign_id}…`,
    google_create_ad_group: `Creating Google ad group "${i.name}"…`,
    google_list_keywords: `Fetching keywords in ad group ${i.ad_group_id}…`,
    google_add_keywords: `Adding ${(i.keywords as unknown[])?.length} keywords…`,
    google_list_ads: `Fetching Google ads in ad group ${i.ad_group_id}…`,
    google_get_ad_metrics: `Fetching Google ad performance (${i.date_range})…`,
    google_create_responsive_search_ad: `Creating Google RSA in ad group ${i.ad_group_id}…`,
    google_get_search_terms_report: `Fetching search terms report (${i.date_range})…`,
    google_get_geographic_report: `Fetching geographic report (${i.date_range})…`,
  };
  return map[name] ?? `Calling ${name}…`;
}

function fmtResult(name: string, result: unknown): string {
  const r = result as Record<string, unknown>;
  if (r?.error) return `Error: ${JSON.stringify(r.error)}`;
  const count = (r?.data as unknown[] || (r?.results as unknown[]) || (r?.interests as unknown[]))?.length;
  if (name === "meta_search_interests") return `Found ${count ?? "?"} interest${count !== 1 ? "s" : ""}`;
  if (
    name.includes("list_") ||
    (name.includes("get_") && !name.includes("metrics") && !name.includes("insights"))
  ) {
    return `Found ${count ?? "?"} item${count !== 1 ? "s" : ""}`;
  }
  if (name.includes("create_"))
    return r?.id || r?.resource_name || r?.ad_id || r?.success
      ? `Created ✓`
      : `Failed: ${JSON.stringify(r)}`;
  if (name.includes("update_") || name.includes("bulk_"))
    return r?.success !== false ? `Updated ✓` : `Failed: ${JSON.stringify(r)}`;
  if (name.includes("insights") || name.includes("metrics"))
    return `Metrics loaded (${count ?? "?"} rows)`;
  return "Done";
}