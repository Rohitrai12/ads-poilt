import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { consumeMessageQuota, getPlanContext, isEditingTool, isReportPrompt } from "@/lib/billing";
import { getAuthUserFromRequest } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const META_VERSION = "v25.0";
const META_BASE = `https://graph.facebook.com/${META_VERSION}`;
const GOOGLE_ADS_VERSION = "v18";
const GOOGLE_ADS_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}`;

const AUTO_BID_CAP_CENTS = 500;

// ─── BigInt-safe JSON ─────────────────────────────────────────────────────────
function safeParseJSON(text: string): unknown {
  const safe = text.replace(/:(\s*)(-?\d{16,})([,\}\]])/g, (_m, sp, n, tail) => `:"${n}"${tail}`);
  return JSON.parse(safe);
}

// ─── Magic-byte MIME detection ────────────────────────────────────────────────
function detectMime(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57 && buf[9] === 0x45) return "image/webp";
  return "image/jpeg";
}

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Ad AI (Meta+Google)

Meta: C→AS→Ad | Google: C→AG→Ad→KW
Use meta_*/google_* (only if connected)

Rules:
- Fetch real data, no guess IDs (string)
- Perf: ROAS>CTR>CPC
- Show budget Δ ($X→$Y, %)
- Meta=cents, Google=micros
- Both? query+unify
- Confirm before delete
- Return ID after create

Meta:
- use_cbo req (T=camp, F=AS)
- CBO→no AS budget
- Map goals (no CONVERSIONS)
- Bid: default lowest; cap→need bid_amount
- Img: upload→create (atomic)
- Interests: search→confirm→use
- page_id auto

Google:
- RSA: 3–15 H, 2–4 D
- UNAUTH→refresh token`;
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
      "Create a new Meta campaign (starts PAUSED). ALWAYS pass use_cbo: set true for CBO (campaign-level budget), false for ad-set level budgets.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        objective: {
          type: "string",
          enum: [
            "OUTCOME_TRAFFIC", "OUTCOME_LEADS", "OUTCOME_SALES",
            "OUTCOME_ENGAGEMENT", "OUTCOME_AWARENESS", "OUTCOME_APP_PROMOTION",
          ],
        },
        special_ad_category: { type: "string", enum: ["NONE", "EMPLOYMENT", "HOUSING", "CREDIT"] },
        daily_budget_cents: { type: "number", description: "Campaign-level daily budget in cents. Only for CBO." },
        use_cbo: {
          type: "boolean",
          description: "REQUIRED. true = CBO. false = ad-set level budgets.",
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
    description: "Pause, activate, or archive multiple Meta campaigns at once.",
    input_schema: {
      type: "object",
      properties: {
        campaign_ids: { type: "array", items: { type: "string" } },
        status: { type: "string", enum: ["ACTIVE", "PAUSED", "ARCHIVED"] },
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
  {
    name: "meta_create_adset",
    description: "Create a Meta ad set.",
    input_schema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        name: { type: "string" },
        daily_budget_cents: { type: "number", description: "Omit for CBO campaigns." },
        destination_type: {
          type: "string",
          enum: ["WEBSITE", "APP", "MESSENGER", "INSTAGRAM_DIRECT", "WHATSAPP", "ON_AD", "FACEBOOK", "SHOP_AUTOMATIC"],
          description: "REQUIRED. Where the ad sends people.",
        },
        targeting_countries: { type: "array", items: { type: "string" } },
        age_min: { type: "number" },
        age_max: { type: "number" },
        interests: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
            },
            required: ["id", "name"],
          },
        },
        optimization_goal: {
          type: "string",
          enum: [
            "OFFSITE_CONVERSIONS", "LINK_CLICKS", "LANDING_PAGE_VIEWS", "IMPRESSIONS",
            "REACH", "LEAD_GENERATION", "QUALITY_LEAD", "APP_INSTALLS",
            "APP_INSTALLS_AND_OFFSITE_CONVERSIONS", "VALUE", "THRUPLAY",
            "POST_ENGAGEMENT", "PAGE_LIKES", "EVENT_RESPONSES", "CONVERSATIONS",
            "MESSAGING_PURCHASE_CONVERSION", "MESSAGING_APPOINTMENT_CONVERSION",
            "ENGAGED_USERS", "AD_RECALL_LIFT",
          ],
        },
        billing_event: { type: "string", enum: ["IMPRESSIONS", "LINK_CLICKS"] },
        bid_strategy: {
          type: "string",
          enum: ["LOWEST_COST_WITHOUT_CAP", "LOWEST_COST_WITH_BID_CAP", "COST_CAP"],
        },
        bid_amount_cents: { type: "number" },
      },
      required: ["campaign_id", "name", "targeting_countries", "optimization_goal", "billing_event", "destination_type"],
    },
  },
  {
    name: "meta_search_interests",
    description: "Search Meta's interest targeting library by keyword.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
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
    description: "Per-ad Meta performance including spend, CTR, CPC, ROAS.",
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
    description: "Upload an image to the Meta ad account image library. Returns image_hash. Call this FIRST before meta_create_ad when the user has attached an image.",
    input_schema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Base64-encoded image data (no data: prefix)." },
        image_filename: { type: "string", description: "Filename with extension, e.g. ad_image.jpg" },
      },
      required: ["image_base64", "image_filename"],
    },
  },
  {
    name: "meta_create_ad",
    description: "Create a Meta ad (image or text/link). For image ads, first call meta_upload_ad_image to get the image_hash, then pass it here.",
    input_schema: {
      type: "object",
      properties: {
        adset_id: { type: "string" },
        name: { type: "string" },
        page_id: { type: "string", description: "Facebook Page ID. Use the connected page from context." },
        image_hash: { type: "string", description: "Hash returned by meta_upload_ad_image. Required for image ads." },
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
  {
    name: "meta_get_user_profile",
    description: "Get the authenticated user's Meta profile including name, email, and business-related fields.",
    input_schema: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          items: { type: "string" },
          description: "Fields to fetch. Defaults to id, name, email.",
        },
      },
      required: [],
    },
  },
  {
    name: "meta_list_businesses",
    description: "List all Business Manager portfolios the user has access to (uses /me/businesses).",
    input_schema: {
      type: "object",
      properties: {
        fields: { type: "array", items: { type: "string" } },
      },
      required: [],
    },
  },
  {
    name: "meta_list_business_ad_accounts",
    description: "List all ad accounts owned by or accessible to a specific Business Manager.",
    input_schema: {
      type: "object",
      properties: {
        business_id: { type: "string" },
        include_client_accounts: { type: "boolean" },
      },
      required: ["business_id"],
    },
  },
  {
    name: "meta_list_business_pages",
    description: "List Facebook Pages owned by a Business Manager.",
    input_schema: {
      type: "object",
      properties: { business_id: { type: "string" } },
      required: ["business_id"],
    },
  },
  {
    name: "meta_list_business_pixels",
    description: "List Meta Pixels (datasets) owned by a Business Manager.",
    input_schema: {
      type: "object",
      properties: { business_id: { type: "string" } },
      required: ["business_id"],
    },
  },
  {
    name: "meta_get_business_user",
    description: "Get the business user profile for a specific person within a Business Manager.",
    input_schema: {
      type: "object",
      properties: { business_id: { type: "string" } },
      required: ["business_id"],
    },
  },
  {
    name: "meta_list_catalogs",
    description: "List all product catalogs owned by a Business Manager.",
    input_schema: {
      type: "object",
      properties: { business_id: { type: "string" } },
      required: ["business_id"],
    },
  },
  {
    name: "meta_create_catalog",
    description: "Create a new product catalog under a Business Manager.",
    input_schema: {
      type: "object",
      properties: {
        business_id: { type: "string" },
        name: { type: "string" },
        catalog_type: {
          type: "string",
          enum: ["SIMPLE", "AUTOMOTIVE", "HOTELS", "FLIGHTS", "DESTINATIONS", "HOME_LISTINGS", "JOBS"],
        },
        da_display_settings: { type: "object" },
      },
      required: ["business_id", "name", "catalog_type"],
    },
  },
  {
    name: "meta_get_catalog",
    description: "Get details of a specific product catalog.",
    input_schema: {
      type: "object",
      properties: { catalog_id: { type: "string" } },
      required: ["catalog_id"],
    },
  },
  {
    name: "meta_list_catalog_product_sets",
    description: "List product sets (subsets of a catalog) for use in dynamic ads.",
    input_schema: {
      type: "object",
      properties: {
        catalog_id: { type: "string" },
        limit: { type: "number" },
      },
      required: ["catalog_id"],
    },
  },
  {
    name: "meta_create_product_set",
    description: "Create a product set (filtered subset) within a catalog.",
    input_schema: {
      type: "object",
      properties: {
        catalog_id: { type: "string" },
        name: { type: "string" },
        filter: { type: "object" },
      },
      required: ["catalog_id", "name", "filter"],
    },
  },
  {
    name: "meta_list_catalog_products",
    description: "List products (items) within a catalog.",
    input_schema: {
      type: "object",
      properties: {
        catalog_id: { type: "string" },
        limit: { type: "number" },
        filter_equal: { type: "object" },
      },
      required: ["catalog_id"],
    },
  },
  {
    name: "meta_update_catalog_product",
    description: "Update a specific product in a catalog.",
    input_schema: {
      type: "object",
      properties: {
        catalog_id: { type: "string" },
        retailer_id: { type: "string" },
        updates: { type: "object" },
      },
      required: ["catalog_id", "retailer_id", "updates"],
    },
  },
  {
    name: "meta_get_catalog_diagnostics",
    description: "Get diagnostics and issues for a product catalog.",
    input_schema: {
      type: "object",
      properties: { catalog_id: { type: "string" } },
      required: ["catalog_id"],
    },
  },
];

// ─── GOOGLE TOOLS ─────────────────────────────────────────────────────────────
const GOOGLE_TOOLS = [
  {
    name: "google_list_campaigns",
    description: "List all Google Ads campaigns.",
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
          enum: ["MANUAL_CPC", "MAXIMIZE_CLICKS", "MAXIMIZE_CONVERSIONS", "TARGET_CPA", "TARGET_ROAS", "MAXIMIZE_CONVERSION_VALUE"],
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
    description: "Change Google Ads campaign status.",
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
    description: "List keywords in a Google Ads ad group.",
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
    description: "List Google Ads ads in an ad group.",
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
    description: "Create a Google RSA with 3–15 headlines and 2–4 descriptions.",
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
    description: "Google Ads search terms — find negative keyword opportunities.",
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

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
type ToolInput = Record<string, unknown>;
type Credentials = {
  meta?: { accessToken: string; adAccountId: string; pageId?: string | null; pixelId?: string | null };
  google?: { accessToken: string; customerId: string };
};

const META_READ_MIN_INTERVAL_MS = 500;
const META_READ_MAX_INTERVAL_MS = 1000;
const META_WRITE_MIN_INTERVAL_MS = 5000;
const META_WRITE_MAX_INTERVAL_MS = 10000;
const META_BULK_STEP_MIN_DELAY_MS = 3000;
const META_BULK_STEP_MAX_DELAY_MS = 8000;

let metaReadNextAt = 0;
let metaWriteNextAt = 0;

function randBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttleMeta(kind: "read" | "write") {
  const now = Date.now();
  const nextAt = kind === "write" ? metaWriteNextAt : metaReadNextAt;
  if (nextAt > now) await sleep(nextAt - now);
  const interval =
    kind === "write"
      ? randBetween(META_WRITE_MIN_INTERVAL_MS, META_WRITE_MAX_INTERVAL_MS)
      : randBetween(META_READ_MIN_INTERVAL_MS, META_READ_MAX_INTERVAL_MS);
  const scheduled = Date.now() + interval;
  if (kind === "write") metaWriteNextAt = scheduled;
  else metaReadNextAt = scheduled;
}

async function metaGet(url: string): Promise<unknown> {
  await throttleMeta("read");
  const res = await fetch(url);
  return safeParseJSON(await res.text());
}

async function metaPost(url: string, params: URLSearchParams): Promise<unknown> {
  await throttleMeta("write");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  return safeParseJSON(await res.text());
}

async function metaPostForm(url: string, fields: Record<string, string>): Promise<unknown> {
  await throttleMeta("write");
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(url, { method: "POST", body: form });
  return safeParseJSON(await res.text());
}

async function metaPostJSON(url: string, body: unknown, tok: string): Promise<unknown> {
  await throttleMeta("write");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
    body: JSON.stringify(body),
  });
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

function truncateHistory(msgs: ClaudeMessage[], maxTokenEstimate = 12000): ClaudeMessage[] {
  // Keep the first message (context) + last N messages
  // Rough estimate: 1 token ≈ 4 chars
  let totalChars = 0;
  const kept: ClaudeMessage[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const content = typeof msgs[i].content === "string"
      ? msgs[i].content as string
      : JSON.stringify(msgs[i].content);
    totalChars += content.length;
    if (totalChars > maxTokenEstimate * 4) break;
    kept.unshift(msgs[i]);
  }
  // Always keep at least the last 2 messages
  if (kept.length === 0 && msgs.length > 0) return msgs.slice(-2);
  return kept;
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

// ─── Trim tool results to prevent token overflow ──────────────────────────────
function trimToolResults(msgs: ClaudeMessage[], maxResultLen = 2000): ClaudeMessage[] {
  return msgs.map((m) => {
    if (m.role !== "user" || !Array.isArray(m.content)) return m;
    const content = (m.content as ClaudeContentBlock[]).map((block) => {
      if (block.type !== "tool_result") return block;
      const b = block as { type: "tool_result"; tool_use_id: string; content: string };
      if (b.content.length <= maxResultLen) return b;
      return { ...b, content: b.content.slice(0, maxResultLen) + '"}' };
    });
    return { ...m, content };
  });
}

async function googleBudgetMutate(customerId: string, operations: unknown[], accessToken: string): Promise<unknown> {
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

// ─── Strip verbose property descriptions from tool schemas ────────────────────
// Tool property descriptions are hints for humans — Claude doesn't need them.
// Removing them saves ~4,000–8,000 tokens per request.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function compressTools(tools: any[]): any[] {  return tools.map((tool) => {
    const props = (tool.input_schema as Record<string, unknown>).properties as Record<string, Record<string, unknown>> | undefined;
    if (!props) return tool;
    const stripped: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of Object.entries(props)) {
      // Keep type, enum, items, required — drop description
      const { description: _desc, ...rest } = v;
      stripped[k] = rest;
    }
    return {
      ...tool,
      input_schema: { ...tool.input_schema, properties: stripped },
    };
  });
}

// ─── Tool executor ────────────────────────────────────────────────────────────
async function executeTool(name: string, input: ToolInput, creds: Credentials): Promise<unknown> {

  if (name.startsWith("meta_")) {
    if (!creds.meta)
      return { error: "Meta Ads is not connected. Ask the user to connect their Meta account first." };
    const { accessToken: tok, adAccountId, pageId: credPageId } = creds.meta;
    const acct = `act_${adAccountId}`;

    if (name === "meta_list_campaigns") {
      return metaGet(`${META_BASE}/${acct}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget&access_token=${tok}`);
    }

    if (name === "meta_get_campaign_insights") {
      const { date_preset, campaign_ids } = input as { date_preset: string; campaign_ids?: string[] };
      const fields = "campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,actions,action_values,purchase_roas";
      let url = `${META_BASE}/${acct}/insights?fields=${fields}&level=campaign&date_preset=${date_preset}&access_token=${tok}`;
      if (campaign_ids?.length)
        url += `&filtering=${encodeURIComponent(JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaign_ids }]))}`;
      return metaGet(url);
    }

    if (name === "meta_create_campaign") {
      const { name: n, objective, special_ad_category, daily_budget_cents, use_cbo } = input as {
        name: string; objective: string; special_ad_category: string; daily_budget_cents?: number; use_cbo?: boolean;
      };
      const p = new URLSearchParams({
        name: n, objective, status: "PAUSED",
        special_ad_categories: JSON.stringify([special_ad_category]),
        access_token: tok,
      });
      // Keep budget-sharing disabled to avoid Meta conflicts across campaign configurations.
      p.set("is_adset_budget_sharing_enabled", "false");
      if (use_cbo === true && daily_budget_cents) {
        p.set("daily_budget", String(Math.round(daily_budget_cents)));
      }
      // For non-CBO flows, omit campaign-level budget and let ad sets own budgets.
      const firstTry = (await metaPost(`${META_BASE}/${acct}/campaigns`, p)) as Record<string, unknown>;
      if (firstTry?.id) return firstTry;
      const err = firstTry?.error as Record<string, unknown> | undefined;
      const subcode = String(err?.error_subcode ?? "");
      if (subcode === "4834002" || subcode === "4834005") {
        const retry = new URLSearchParams({
          name: n,
          objective,
          status: "PAUSED",
          special_ad_categories: JSON.stringify([special_ad_category]),
          access_token: tok,
        });
        if (use_cbo === true && daily_budget_cents) {
          retry.set("daily_budget", String(Math.round(daily_budget_cents)));
        }
        const secondTry = await metaPost(`${META_BASE}/${acct}/campaigns`, retry);
        return secondTry;
      }
      return firstTry;
    }

    if (name === "meta_update_campaign_budget") {
      const { campaign_id, new_daily_budget_cents } = input as { campaign_id: string; new_daily_budget_cents: number };
      return metaPost(`${META_BASE}/${String(campaign_id)}`, new URLSearchParams({ daily_budget: String(Math.round(new_daily_budget_cents)), access_token: tok }));
    }

    if (name === "meta_update_campaign_status") {
      const { campaign_id, status } = input as { campaign_id: string; status: string };
      return metaPost(`${META_BASE}/${String(campaign_id)}`, new URLSearchParams({ status, access_token: tok }));
    }

    if (name === "meta_bulk_update_campaign_status") {
      const { campaign_ids, status } = input as { campaign_ids: string[]; status: string };
      const results: Array<Record<string, unknown>> = [];
      for (const id of campaign_ids) {
        const data = await metaPost(`${META_BASE}/${String(id)}`, new URLSearchParams({ status, access_token: tok }));
        results.push({ campaign_id: id, ...(data as object) });
        await sleep(randBetween(META_BULK_STEP_MIN_DELAY_MS, META_BULK_STEP_MAX_DELAY_MS));
      }
      return { results, succeeded: results.filter((r) => (r as Record<string, unknown>).success).length, total: campaign_ids.length };
    }

    if (name === "meta_list_adsets") {
      const { campaign_id } = input as { campaign_id: string };
      return metaGet(`${META_BASE}/${String(campaign_id)}/adsets?fields=id,name,status,daily_budget,targeting,optimization_goal&access_token=${tok}`);
    }

    if (name === "meta_create_adset") {
      const {
        campaign_id, name: n, daily_budget_cents, destination_type, targeting_countries,
        age_min, age_max, interests, optimization_goal, billing_event, bid_strategy, bid_amount_cents,
      } = input as {
        campaign_id: string; name: string; daily_budget_cents?: number; destination_type?: string;
        targeting_countries: string[]; age_min?: number; age_max?: number;
        interests?: Array<{ id: string; name: string }>; optimization_goal: string;
        billing_event: string; bid_strategy?: string; bid_amount_cents?: number;
      };
      const GOAL_REMAP: Record<string, string> = { CONVERSIONS: "OFFSITE_CONVERSIONS" };
      const effectiveGoal = GOAL_REMAP[optimization_goal] ?? optimization_goal;
      const targeting: Record<string, unknown> = {
        geo_locations: { countries: targeting_countries },
        targeting_automation: { advantage_audience: 0 },
      };
      if (age_min) targeting.age_min = age_min;
      if (age_max) targeting.age_max = age_max;
      if (interests && interests.length > 0)
        targeting.flexible_spec = [{ interests: interests.map((i) => ({ id: i.id, name: i.name })) }];
      const effectiveBilling = effectiveGoal === "LINK_CLICKS" && billing_event === "LINK_CLICKS" ? "IMPRESSIONS" : billing_event;
      const p = new URLSearchParams({
        campaign_id: String(campaign_id), name: n,
        targeting: JSON.stringify(targeting), optimization_goal: effectiveGoal,
        billing_event: effectiveBilling, status: "PAUSED", access_token: tok,
      });
      if (destination_type) p.set("destination_type", destination_type);
      if (daily_budget_cents) p.set("daily_budget", String(Math.round(daily_budget_cents)));
      const cappedStrategies = ["LOWEST_COST_WITH_BID_CAP", "COST_CAP"];
      const normalizedBidAmount = typeof bid_amount_cents === "number" && Number.isFinite(bid_amount_cents)
        ? Math.max(1, Math.round(bid_amount_cents)) : undefined;
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
      const result = (await metaPost(`${META_BASE}/${acct}/adsets`, p)) as Record<string, unknown>;
      if (!result?.id) {
        const err = result?.error as Record<string, unknown> | undefined;
        const isBudgetConflict = String(err?.error_subcode) === "1885621" ||
          String(err?.error_user_msg ?? "").toLowerCase().includes("budget");
        if (isBudgetConflict) {
          const p2 = new URLSearchParams({
            campaign_id: String(campaign_id), name: n,
            targeting: JSON.stringify(targeting), optimization_goal: effectiveGoal,
            billing_event: effectiveBilling, status: "PAUSED", access_token: tok,
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
          if (r2?.id) return { ...r2, auto_fixed: true, note: "CBO campaign — budget managed at campaign level." };
        }
      }
      return result;
    }

    if (name === "meta_search_interests") {
      const { query, limit = 10 } = input as { query: string; limit?: number };
      const data = (await metaGet(`${META_BASE}/search?type=adinterest&q=${encodeURIComponent(query)}&limit=${Math.min(Number(limit), 25)}&access_token=${tok}`)) as Record<string, unknown>;
      const items = (data?.data as Array<Record<string, unknown>> ?? []).map((i) => ({
        id: String(i.id), name: String(i.name),
        audience_size_lower_bound: i.audience_size_lower_bound,
        audience_size_upper_bound: i.audience_size_upper_bound,
        topic: i.topic, path: i.path,
      }));
      return { interests: items, count: items.length };
    }

    if (name === "meta_update_adset_status") {
      const { adset_id, status } = input as { adset_id: string; status: string };
      return metaPost(`${META_BASE}/${String(adset_id)}`, new URLSearchParams({ status, access_token: tok }));
    }

    if (name === "meta_list_ads") {
      const { adset_id } = input as { adset_id: string };
      const fields = "id,name,status,creative{id,name,title,body,image_url,thumbnail_url}";
      return metaGet(`${META_BASE}/${String(adset_id)}/ads?fields=${fields}&access_token=${tok}`);
    }

    if (name === "meta_get_ad_insights") {
      const { adset_id, campaign_id, date_preset } = input as { adset_id?: string; campaign_id?: string; date_preset: string };
      const fields = "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,actions,action_values,purchase_roas";
      let url: string;
      if (adset_id) {
        url = `${META_BASE}/${acct}/insights?fields=${fields}&level=ad&date_preset=${date_preset}&filtering=${encodeURIComponent(JSON.stringify([{ field: "adset.id", operator: "EQUAL", value: String(adset_id) }]))}&access_token=${tok}`;
      } else if (campaign_id) {
        url = `${META_BASE}/${acct}/insights?fields=${fields}&level=ad&date_preset=${date_preset}&filtering=${encodeURIComponent(JSON.stringify([{ field: "campaign.id", operator: "EQUAL", value: String(campaign_id) }]))}&access_token=${tok}`;
      } else {
        url = `${META_BASE}/${acct}/insights?fields=${fields}&level=ad&date_preset=${date_preset}&access_token=${tok}`;
      }
      return metaGet(url);
    }

    if (name === "meta_update_ad_status") {
      const { ad_id, status } = input as { ad_id: string; status: string };
      return metaPost(`${META_BASE}/${String(ad_id)}`, new URLSearchParams({ status, access_token: tok }));
    }

    if (name === "meta_upload_ad_image") {
      const { image_base64, image_filename } = input as { image_base64: string; image_filename: string };
      const cleanBase64 = image_base64?.includes(",") ? image_base64.split(",")[1] : image_base64;
      if (!cleanBase64 || cleanBase64.length < 100)
        return { success: false, error: "Invalid base64: too short or missing" };
      let bytes: Buffer;
      try { bytes = Buffer.from(cleanBase64, "base64"); }
      catch { return { success: false, error: "Invalid base64 encoding" }; }
      if (bytes.length < 500)
        return { success: false, error: `Image too small (${bytes.length} bytes) — likely broken base64` };
      const mimeType = detectMime(bytes);
      const mimeToExt: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
      const ext = mimeToExt[mimeType] ?? "jpg";
      const baseName = (image_filename || "ad_image").replace(/\.[^.]+$/, "");
      const fname = `${baseName}.${ext}`;
      const form = new FormData();
      form.append("access_token", tok);
      form.append("filename", new Blob([new Uint8Array(bytes)], { type: mimeType }), fname);
      try {
        await throttleMeta("write");
        const res = await fetch(`${META_BASE}/${acct}/adimages`, { method: "POST", body: form });
        const result = safeParseJSON(await res.text()) as Record<string, unknown>;
        if (result.images) {
          const first = Object.values(result.images)[0] as Record<string, unknown>;
          return { success: true, image_hash: first.hash, image_url: first.url };
        }
        return { success: false, error: "Meta upload failed", raw: result };
      } catch (err) {
        return { success: false, error: "Network error during upload", details: String(err) };
      }
    }

    if (name === "meta_create_ad") {
      const { adset_id, name: adName, page_id: inputPageId, image_hash, headline, body, link_url, call_to_action, description } = input as {
        adset_id: string; name: string; page_id?: string; image_hash?: string;
        headline: string; body: string; link_url: string; call_to_action: string; description?: string;
      };
      const page_id = inputPageId || credPageId;
      if (!page_id)
        return { error: "page_id is required to create an ad. No Facebook Page is connected. Please select a Page in the connection panel." };
      const hasImage = !!(image_hash && image_hash.trim().length > 0);
      const linkData: Record<string, unknown> = {
        link: link_url, message: body, name: headline,
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
        const verified = (await metaGet(`${META_BASE}/${String(adRes.id)}?fields=id,name,status,adset_id,campaign_id&access_token=${tok}`)) as Record<string, unknown>;
        return {
          success: true, ad_id: adRes.id, status: "PAUSED",
          ad_type: hasImage ? "image" : "text_link", page_id_used: page_id,
          verified_adset_id: verified?.adset_id, verified_campaign_id: verified?.campaign_id,
        };
      }
      return adRes;
    }

    if (name === "meta_list_custom_audiences") {
      return metaGet(`${META_BASE}/${acct}/customaudiences?fields=id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound&access_token=${tok}`);
    }
    if (name === "meta_get_user_profile") {
      const { fields = ["id", "name", "email"] } = input as { fields?: string[] };
      return metaGet(`${META_BASE}/me?fields=${(fields as string[]).join(",")}&access_token=${tok}`);
    }

    if (name === "meta_list_businesses") {
      const { fields = ["id", "name", "profile_picture_uri", "link"] } = input as { fields?: string[] };
      const data = (await metaGet(`${META_BASE}/me/businesses?fields=${(fields as string[]).join(",")}&access_token=${tok}`)) as Record<string, unknown>;
      const businesses = (data?.data as Array<Record<string, unknown>>) ?? [];
      return { businesses, count: businesses.length };
    }

    if (name === "meta_list_business_ad_accounts") {
      const { business_id, include_client_accounts = true } = input as { business_id: string; include_client_accounts?: boolean };
      const fields = "id,name,currency,account_status,business";
      const ownedRes = (await metaGet(`${META_BASE}/${String(business_id)}/owned_ad_accounts?fields=${fields}&access_token=${tok}`)) as Record<string, unknown>;
      const owned = (ownedRes?.data as Array<Record<string, unknown>>) ?? [];
      let client: Array<Record<string, unknown>> = [];
      if (include_client_accounts) {
        const clientRes = (await metaGet(`${META_BASE}/${String(business_id)}/client_ad_accounts?fields=${fields}&access_token=${tok}`)) as Record<string, unknown>;
        client = (clientRes?.data as Array<Record<string, unknown>>) ?? [];
      }
      return { owned_ad_accounts: owned, client_ad_accounts: client, total: owned.length + client.length };
    }

    if (name === "meta_list_business_pages") {
      const { business_id } = input as { business_id: string };
      const data = (await metaGet(`${META_BASE}/${String(business_id)}/owned_pages?fields=id,name,category,fan_count,verification_status,link&access_token=${tok}`)) as Record<string, unknown>;
      const pages = (data?.data as Array<Record<string, unknown>>) ?? [];
      return { pages, count: pages.length };
    }

    if (name === "meta_list_business_pixels") {
      const { business_id } = input as { business_id: string };
      const data = (await metaGet(`${META_BASE}/${String(business_id)}/owned_pixels?fields=id,name,creation_time,last_fired_time,is_created_by_business&access_token=${tok}`)) as Record<string, unknown>;
      const pixels = (data?.data as Array<Record<string, unknown>>) ?? [];
      return { pixels, count: pixels.length };
    }

    if (name === "meta_get_business_user") {
      const { business_id } = input as { business_id: string };
      const data = (await metaGet(`${META_BASE}/${String(business_id)}/business_users?fields=id,name,email,role,title,business&access_token=${tok}`)) as Record<string, unknown>;
      const users = (data?.data as Array<Record<string, unknown>>) ?? [];
      return { business_users: users, count: users.length };
    }

    if (name === "meta_list_catalogs") {
      const { business_id } = input as { business_id: string };
      const data = (await metaGet(`${META_BASE}/${String(business_id)}/owned_product_catalogs?fields=id,name,business,product_count,da_display_settings,destination_catalog_settings,catalog_store&access_token=${tok}`)) as Record<string, unknown>;
      const catalogs = (data?.data as Array<Record<string, unknown>>) ?? [];
      return { catalogs, count: catalogs.length };
    }

    if (name === "meta_create_catalog") {
      const { business_id, name: catalogName, catalog_type, da_display_settings } = input as { business_id: string; name: string; catalog_type: string; da_display_settings?: object };
      const p = new URLSearchParams({ name: catalogName, vertical: catalog_type, access_token: tok });
      if (da_display_settings) p.set("da_display_settings", JSON.stringify(da_display_settings));
      return metaPost(`${META_BASE}/${String(business_id)}/owned_product_catalogs`, p);
    }

    if (name === "meta_get_catalog") {
      const { catalog_id } = input as { catalog_id: string };
      return metaGet(`${META_BASE}/${String(catalog_id)}?fields=id,name,business,product_count,da_display_settings,vertical&access_token=${tok}`);
    }

    if (name === "meta_list_catalog_product_sets") {
      const { catalog_id, limit = 25 } = input as { catalog_id: string; limit?: number };
      const data = (await metaGet(`${META_BASE}/${String(catalog_id)}/product_sets?fields=id,name,product_count,filter,retailer_id&limit=${Math.min(Number(limit), 100)}&access_token=${tok}`)) as Record<string, unknown>;
      const productSets = (data?.data as Array<Record<string, unknown>>) ?? [];
      return { product_sets: productSets, count: productSets.length };
    }

    if (name === "meta_create_product_set") {
      const { catalog_id, name: setName, filter } = input as { catalog_id: string; name: string; filter: object };
      return metaPost(`${META_BASE}/${String(catalog_id)}/product_sets`, new URLSearchParams({ name: setName, filter: JSON.stringify(filter), access_token: tok }));
    }

    if (name === "meta_list_catalog_products") {
      const { catalog_id, limit = 25, filter_equal } = input as { catalog_id: string; limit?: number; filter_equal?: Record<string, string> };
      let url = `${META_BASE}/${String(catalog_id)}/products?fields=id,name,retailer_id,availability,price,currency,image_url,url,brand,description,condition&limit=${Math.min(Number(limit), 100)}&access_token=${tok}`;
      if (filter_equal && Object.keys(filter_equal).length > 0) {
        const filterArr = Object.entries(filter_equal).map(([key, value]) => ({ field: key, operator: "EQUAL", value }));
        url += `&filter=${encodeURIComponent(JSON.stringify(filterArr))}`;
      }
      const data = (await metaGet(url)) as Record<string, unknown>;
      const products = (data?.data as Array<Record<string, unknown>>) ?? [];
      return { products, count: products.length };
    }

    if (name === "meta_update_catalog_product") {
      const { catalog_id, retailer_id, updates } = input as { catalog_id: string; retailer_id: string; updates: Record<string, unknown> };
      return metaPostJSON(`${META_BASE}/${String(catalog_id)}/items_batch?access_token=${tok}`, { requests: [{ method: "UPDATE", retailer_id, data: updates }] }, tok);
    }

    if (name === "meta_get_catalog_diagnostics") {
      const { catalog_id } = input as { catalog_id: string };
      const catalogData = (await metaGet(`${META_BASE}/${String(catalog_id)}?fields=id,name,product_count,da_display_settings,product_issues&access_token=${tok}`)) as Record<string, unknown>;
      const errorProducts = (await metaGet(`${META_BASE}/${String(catalog_id)}/products?filter=${encodeURIComponent(JSON.stringify([{ field: "availability", operator: "EQUAL", value: "out of stock" }]))}&fields=id,name,retailer_id,availability&limit=10&access_token=${tok}`)) as Record<string, unknown>;
      return { catalog: catalogData, sample_out_of_stock_products: (errorProducts as Record<string, unknown>)?.data ?? [] };
    }
  }

  if (name.startsWith("google_")) {
    if (!creds.google)
      return { error: "Google Ads is not connected. Ask the user to connect their Google account first." };
    const { accessToken: tok, customerId } = creds.google;

    if (name === "google_list_campaigns") {
      return googleQuery(customerId, `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.name`, tok);
    }

    if (name === "google_get_campaign_metrics") {
      const { date_range, campaign_ids } = input as { date_range: string; campaign_ids?: string[] };
      let where = `segments.date DURING ${date_range}`;
      if (campaign_ids?.length) where += ` AND campaign.id IN (${campaign_ids.map((id) => `'${id}'`).join(",")})`;
      return googleQuery(customerId, `SELECT campaign.id, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.average_cpc, metrics.conversions, metrics.conversions_value, metrics.cost_per_conversion FROM campaign WHERE ${where} ORDER BY metrics.cost_micros DESC`, tok);
    }

    if (name === "google_create_campaign") {
      const { name: n, advertising_channel_type, daily_budget_micros, bidding_strategy, target_cpa_micros, target_roas } = input as {
        name: string; advertising_channel_type: string; daily_budget_micros: number; bidding_strategy: string; target_cpa_micros?: number; target_roas?: number;
      };
      const budgetRes = (await googleBudgetMutate(customerId, [{ create: { name: `Budget for ${n}`, amount_micros: Math.round(daily_budget_micros), delivery_method: "STANDARD" } }], tok)) as Record<string, unknown>;
      const budgetRn = ((budgetRes?.results as Array<Record<string, unknown>>)?.[0]?.resourceName) as string | undefined;
      if (!budgetRn) return { error: "Failed to create budget", details: budgetRes };
      const biddingConfig: Record<string, unknown> = {};
      if (bidding_strategy === "MANUAL_CPC") biddingConfig.manualCpc = {};
      else if (bidding_strategy === "MAXIMIZE_CLICKS") biddingConfig.maximizeClicks = {};
      else if (bidding_strategy === "MAXIMIZE_CONVERSIONS") biddingConfig.maximizeConversions = target_cpa_micros ? { targetCpaMicros: Math.round(target_cpa_micros) } : {};
      else if (bidding_strategy === "TARGET_CPA") biddingConfig.targetCpa = { targetCpaMicros: Math.round(target_cpa_micros ?? 0) };
      else if (bidding_strategy === "TARGET_ROAS") biddingConfig.targetRoas = { targetRoas: target_roas ?? 1 };
      else if (bidding_strategy === "MAXIMIZE_CONVERSION_VALUE") biddingConfig.maximizeConversionValue = target_roas ? { targetRoas: target_roas } : {};
      const campaignRes = (await googleMutate(customerId, [{ campaignOperation: { create: { name: n, advertisingChannelType: advertising_channel_type, status: "PAUSED", campaignBudget: budgetRn, networkSettings: { targetGoogleSearch: advertising_channel_type === "SEARCH", targetContentNetwork: advertising_channel_type === "DISPLAY" }, ...biddingConfig } } }], tok)) as Record<string, unknown>;
      const rn = (((campaignRes?.mutateOperationResponses as Array<Record<string, unknown>>)?.[0]?.campaignResult as Record<string, unknown>)?.resourceName) as string | undefined;
      return rn ? { success: true, resource_name: rn, status: "PAUSED" } : { error: "Campaign creation failed", details: campaignRes };
    }

    if (name === "google_update_campaign_budget") {
      const { campaign_id, new_daily_budget_micros } = input as { campaign_id: string; new_daily_budget_micros: number };
      const current = (await googleQuery(customerId, `SELECT campaign.id, campaign_budget.resource_name FROM campaign WHERE campaign.id = '${String(campaign_id)}'`, tok)) as Record<string, unknown>;
      const budgetRn = ((current?.results as Array<Record<string, unknown>>)?.[0]?.campaignBudget as Record<string, unknown>)?.resourceName as string | undefined;
      if (!budgetRn) return { error: "Could not find budget", details: current };
      return googleBudgetMutate(customerId, [{ update: { resource_name: budgetRn, amount_micros: Math.round(new_daily_budget_micros) }, update_mask: "amount_micros" }], tok);
    }

    if (name === "google_update_campaign_status") {
      const { campaign_id, status } = input as { campaign_id: string; status: string };
      return googleMutate(customerId, [{ campaignOperation: { update: { resource_name: `customers/${customerId}/campaigns/${String(campaign_id)}`, status }, update_mask: "status" } }], tok);
    }

    if (name === "google_bulk_update_campaign_status") {
      const { campaign_ids, status } = input as { campaign_ids: string[]; status: string };
      const ops = campaign_ids.map((id) => ({ campaignOperation: { update: { resource_name: `customers/${customerId}/campaigns/${String(id)}`, status }, update_mask: "status" } }));
      const res = (await googleMutate(customerId, ops, tok)) as Record<string, unknown>;
      return { success: true, updated: (res?.mutateOperationResponses as Array<unknown>)?.length ?? 0, total: campaign_ids.length };
    }

    if (name === "google_list_ad_groups") {
      const { campaign_id } = input as { campaign_id: string };
      return googleQuery(customerId, `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type, ad_group.cpc_bid_micros FROM ad_group WHERE campaign.id = '${String(campaign_id)}' AND ad_group.status != 'REMOVED'`, tok);
    }

    if (name === "google_create_ad_group") {
      const { campaign_id, name: n, cpc_bid_micros, ad_group_type } = input as { campaign_id: string; name: string; cpc_bid_micros: number; ad_group_type: string };
      const res = (await googleMutate(customerId, [{ adGroupOperation: { create: { name: n, campaign: `customers/${customerId}/campaigns/${String(campaign_id)}`, status: "ENABLED", type: ad_group_type, cpc_bid_micros: Math.round(cpc_bid_micros) } } }], tok)) as Record<string, unknown>;
      const rn = (((res?.mutateOperationResponses as Array<Record<string, unknown>>)?.[0]?.adGroupResult as Record<string, unknown>)?.resourceName) as string | undefined;
      return rn ? { success: true, resource_name: rn } : { error: "Ad group creation failed", details: res };
    }

    if (name === "google_list_keywords") {
      const { ad_group_id } = input as { ad_group_id: string };
      return googleQuery(customerId, `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.cpc_bid_micros, ad_group_criterion.quality_info.quality_score FROM ad_group_criterion WHERE ad_group.id = '${String(ad_group_id)}' AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED'`, tok);
    }

    if (name === "google_add_keywords") {
      const { ad_group_id, keywords } = input as { ad_group_id: string; keywords: Array<{ text: string; match_type: string; cpc_bid_micros?: number }> };
      const ops = keywords.map((kw) => ({ adGroupCriterionOperation: { create: { ad_group: `customers/${customerId}/adGroups/${String(ad_group_id)}`, status: "ENABLED", keyword: { text: kw.text, match_type: kw.match_type }, ...(kw.cpc_bid_micros ? { cpc_bid_micros: Math.round(kw.cpc_bid_micros) } : {}) } } }));
      const res = (await googleMutate(customerId, ops, tok)) as Record<string, unknown>;
      return { success: true, added: (res?.mutateOperationResponses as Array<unknown>)?.length ?? 0, total: keywords.length };
    }

    if (name === "google_list_ads") {
      const { ad_group_id } = input as { ad_group_id: string };
      return googleQuery(customerId, `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group_ad.ad.type, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.final_urls FROM ad_group_ad WHERE ad_group.id = '${String(ad_group_id)}' AND ad_group_ad.status != 'REMOVED'`, tok);
    }

    if (name === "google_get_ad_metrics") {
      const { ad_group_id, campaign_id, date_range } = input as { ad_group_id?: string; campaign_id?: string; date_range: string };
      let where = `segments.date DURING ${date_range}`;
      if (ad_group_id) where += ` AND ad_group.id = '${String(ad_group_id)}'`;
      else if (campaign_id) where += ` AND campaign.id = '${String(campaign_id)}'`;
      return googleQuery(customerId, `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group.name, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.conversions FROM ad_group_ad WHERE ${where} ORDER BY metrics.clicks DESC`, tok);
    }

    if (name === "google_create_responsive_search_ad") {
      const { ad_group_id, final_url, headlines, descriptions, path1, path2 } = input as { ad_group_id: string; final_url: string; headlines: string[]; descriptions: string[]; path1?: string; path2?: string };
      const res = (await googleMutate(customerId, [{ adGroupAdOperation: { create: { ad_group: `customers/${customerId}/adGroups/${String(ad_group_id)}`, status: "PAUSED", ad: { final_urls: [final_url], type: "RESPONSIVE_SEARCH_AD", responsive_search_ad: { headlines: headlines.map((t) => ({ text: t })), descriptions: descriptions.map((t) => ({ text: t })), ...(path1 ? { path1 } : {}), ...(path2 ? { path2 } : {}) } } } } }], tok)) as Record<string, unknown>;
      const rn = (((res?.mutateOperationResponses as Array<Record<string, unknown>>)?.[0]?.adGroupAdResult as Record<string, unknown>)?.resourceName) as string | undefined;
      return rn ? { success: true, resource_name: rn, headline_count: headlines.length, description_count: descriptions.length, status: "PAUSED" } : { error: "RSA creation failed", details: res };
    }

    if (name === "google_get_search_terms_report") {
      const { campaign_id, date_range } = input as { campaign_id?: string; date_range: string };
      let where = `segments.date DURING ${date_range}`;
      if (campaign_id) where += ` AND campaign.id = '${String(campaign_id)}'`;
      return googleQuery(customerId, `SELECT search_term_view.search_term, search_term_view.status, ad_group.name, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.conversions FROM search_term_view WHERE ${where} ORDER BY metrics.clicks DESC LIMIT 100`, tok);
    }

    if (name === "google_get_geographic_report") {
      const { campaign_id, date_range } = input as { campaign_id?: string; date_range: string };
      let where = `segments.date DURING ${date_range}`;
      if (campaign_id) where += ` AND campaign.id = '${String(campaign_id)}'`;
      return googleQuery(customerId, `SELECT geographic_view.country_criterion_id, geographic_view.location_type, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.ctr, metrics.conversions FROM geographic_view WHERE ${where} ORDER BY metrics.clicks DESC LIMIT 50`, tok);
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
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: ToolInput }
  | { type: "tool_result"; tool_use_id: string; content: string };

// ─── Route handler ────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const user = getAuthUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const plan = await getPlanContext(user);
  const body = (await request.json()) as {
    messages: Array<{ role: string; content: string | Array<{ type: string; [key: string]: unknown }> }>;
    meta?: { accessToken: string; adAccountId: string; pageId?: string | null; pixelId?: string | null };
    google?: { accessToken: string; customerId: string };
    metaConnectionsCount?: number;
  };
  const lastUserMessage = body.messages.slice().reverse().find((m) => m.role === "user");
  const lastUserText =
    typeof lastUserMessage?.content === "string"
      ? lastUserMessage.content
      : Array.isArray(lastUserMessage?.content)
        ? String(
            (lastUserMessage.content.find((b) => b.type === "text") as { text?: string } | undefined)?.text ?? ""
          )
        : "";
  const reportPrompt = isReportPrompt(lastUserText);

  if (plan.limits.monthlyAiMessages !== "unlimited" && plan.view.usage.monthlyMessageCount >= plan.limits.monthlyAiMessages) {
    return NextResponse.json(
      {
        error: "Monthly AI message limit reached",
        code: "MESSAGE_LIMIT_REACHED",
        billing: plan.view,
      },
      { status: 429 }
    );
  }
  if (reportPrompt && plan.limits.monthlyAiReports !== "unlimited" && plan.view.usage.monthlyReportCount >= plan.limits.monthlyAiReports) {
    return NextResponse.json(
      {
        error: "Monthly AI report limit reached",
        code: "REPORT_LIMIT_REACHED",
        billing: plan.view,
      },
      { status: 429 }
    );
  }

  const { messages, meta, google } = body;

  if (!process.env.ANTHROPIC_API_KEY)
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  if (!meta && !google)
    return NextResponse.json({ error: "No platforms connected" }, { status: 400 });

  const creds: Credentials = { meta, google };
  const allTools = [...(meta ? META_TOOLS : []), ...(google ? GOOGLE_TOOLS : [])];
  const availableTools = compressTools(
    plan.limits.allowCampaignEdits
      ? allTools
      : allTools.filter((t) => !isEditingTool(t.name))
  ) as typeof allTools;
  const connectedPlatforms = [meta ? "Meta Ads (Facebook/Instagram)" : null, google ? "Google Ads" : null].filter(Boolean).join(" and ");

  const connectedCount = [meta ? 1 : 0, google ? 1 : 0].reduce((a, b) => a + b, 0);
  if (google && !plan.limits.allowGoogleAds) {
    return NextResponse.json(
      {
        error: "Your current plan supports Meta Ads only. Upgrade to Growth or Agency to use Google Ads.",
        code: "GOOGLE_NOT_ALLOWED_FOR_PLAN",
        billing: plan.view,
      },
      { status: 402 }
    );
  }
  if (connectedCount > plan.limits.allowedPlatforms) {
    return NextResponse.json(
      {
        error: "Your plan allows only one connected platform at a time.",
        code: "PLATFORM_LIMIT_REACHED",
        billing: plan.view,
      },
      { status: 402 }
    );
  }
  if (
    plan.limits.adAccountsLimit !== "unlimited" &&
    typeof body.metaConnectionsCount === "number" &&
    body.metaConnectionsCount > plan.limits.adAccountsLimit
  ) {
    return NextResponse.json(
      {
        error: "Your plan ad account limit has been reached.",
        code: "AD_ACCOUNT_LIMIT_REACHED",
        billing: plan.view,
      },
      { status: 402 }
    );
  }

  await consumeMessageQuota(user.id, reportPrompt);

  const systemWithContext =
    `${SYSTEM_PROMPT}\n\nCONNECTED PLATFORMS: ${connectedPlatforms}.\n` +
    `${meta
      ? `Meta Ad Account ID: act_${meta.adAccountId}${meta.pageId ? `\nConnected Facebook Page ID: ${meta.pageId}` : "\nNo Facebook Page connected — user must select one in the sidebar to create ads."}${meta.pixelId ? `\nConnected Meta Pixel ID: ${meta.pixelId}` : ""}`
      : "Meta Ads: NOT CONNECTED"
    }\n` +
    `${google ? `Google Ads Customer ID: ${google.customerId}` : "Google Ads: NOT CONNECTED"}`;

  const encoder = new TextEncoder();
  let controllerClosed = false;

  // ── Extract image blocks from the ENTIRE conversation (not just last message) ──
  // We look at the last user message for re-injection nudges
  const lastUserMsg = messages[messages.length - 1];
  const imageBlocks: ClaudeContentBlock[] = Array.isArray(lastUserMsg?.content)
    ? (lastUserMsg.content as Array<{ type: string; [key: string]: unknown }>)
        .filter((b) => b.type === "image")
        .map((b) => b as unknown as ClaudeContentBlock)
    : [];

  // Detect if ANY message in the conversation contains images (for context)
  const conversationHasImages = imageBlocks.length > 0;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        if (controllerClosed) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(data) + "\n")); }
        catch { controllerClosed = true; }
      };

      const pingInterval = setInterval(() => { send({ type: "ping" }); }, 20_000);

      try {
        const claudeMessages: ClaudeMessage[] = truncateHistory(
          messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: Array.isArray(m.content) ? (m.content as ClaudeContentBlock[]) : (m.content as string),
          }))
        );
        
        let iteration = 0;
        const MAX_ITERATIONS = 20;

        // ── FIX: Track whether meta_upload_ad_image has succeeded in this session ──
        let hasUploadedImageSuccessfully = false;

        while (iteration < MAX_ITERATIONS) {
          iteration++;

          let claudeRes: Response;

          try {
            const messagesForClaude = trimToolResults(claudeMessages);

            claudeRes = await fetch("https://api.anthropic.com/v1/messages", {              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model: CLAUDE_MODEL,
                max_tokens: 4046,
                system: systemWithContext,
                tools: availableTools,
                messages: messagesForClaude,  // ✅ correctly uses trimmed messages
              }),
            });

          } catch (fetchErr) {
            send({ type: "error", text: `Failed to reach Claude API: ${String(fetchErr)}` });
            break;
          }

          if (!claudeRes.ok) {
            let errBody: unknown;
            try { errBody = await claudeRes.json(); } catch { errBody = { message: claudeRes.statusText }; }
            send({ type: "error", text: `Claude API error ${claudeRes.status}: ${JSON.stringify(errBody)}` });
            break;
          }

          let responseJson: { content: ClaudeContentBlock[]; stop_reason: string };
          try { responseJson = await claudeRes.json() as { content: ClaudeContentBlock[]; stop_reason: string }; }
          catch (parseErr) { send({ type: "error", text: `Failed to parse Claude response: ${String(parseErr)}` }); break; }

          const { content, stop_reason } = responseJson;

          // Stream text blocks
          for (const block of content) {
            if (block.type === "text") {
              const textBlock = block as { type: "text"; text: string };
              if (textBlock.text.trim()) send({ type: "text", text: textBlock.text });
            }
          }

          // ── Natural end ───────────────────────────────────────────────────
          if (stop_reason === "end_turn") {
            const lastTextBlock = content.filter((b) => b.type === "text").pop() as { type: "text"; text: string } | undefined;
            const lastText = lastTextBlock?.text?.trim() ?? "";

            // ── FIX: If there are image blocks in the request but the image hasn't
            // been uploaded yet, Claude is pausing mid-flow. Force it to continue. ──
            const pendingImageUpload = conversationHasImages && !hasUploadedImageSuccessfully;

            const looksLikeUnfinishedPlan =
              pendingImageUpload ||
              lastText.endsWith(":") ||
              /\b(now i'?ll|let me now|i will now|next[,.]? i'?ll|proceeding to|uploading now|creating now|let me first|then (i'?ll |)upload|then (i'?ll |)create|i'?ll (now |)upload|i'?ll (now |)create the ad)\b/i.test(lastText);

            if (looksLikeUnfinishedPlan && iteration < MAX_ITERATIONS) {
              claudeMessages.push({ role: "assistant", content });

              // Tailor the nudge message based on what's missing
              const nudgeText = pendingImageUpload
                ? "You have gathered the campaign and ad set data. You MUST now call meta_upload_ad_image immediately using the image attached to the user's original message. Do not write any text — call the tool directly now."
                : "Continue — execute the next tool call now. Do not describe what you are about to do, just call the tool.";

              claudeMessages.push({
                role: "user",
                content: [
                  ...imageBlocks, // re-inject the image so Claude can access base64 data
                  { type: "text", text: nudgeText },
                ] as ClaudeContentBlock[],
              });
              continue;
            }
            break;
          }

          // ── Tool use ──────────────────────────────────────────────────────
          if (stop_reason === "tool_use") {
            // Append assistant turn ONCE before executing tools
            claudeMessages.push({ role: "assistant", content });

            // Collect all tool results first, THEN push them as a single user turn
            const toolResults: ClaudeContentBlock[] = [];
            let justUploadedImage = false;

            for (const block of content) {
              if (block.type !== "tool_use") continue;

              const toolBlock = block as { type: "tool_use"; id: string; name: string; input: ToolInput };
              const platform: "meta" | "google" = toolBlock.name.startsWith("meta_") ? "meta" : "google";

              send({
                type: "tool_call",
                tool: toolBlock.name,
                platform,
                input: toolBlock.input,
                text: fmtCall(toolBlock.name, toolBlock.input),
              });

              const timeoutMs = toolBlock.name === "meta_upload_ad_image" ? 120_000 : 45_000;
              let resultText: string;

              try {
                const result = await Promise.race([
                  executeTool(toolBlock.name, toolBlock.input, creds),
                  new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error(`Tool "${toolBlock.name}" timed out after ${timeoutMs / 1000}s`)), timeoutMs)
                  ),
                ]);

                resultText = JSON.stringify(result);
                if (resultText.length > 8000) {
                  // Truncate oversized tool results — keep first 8000 chars
                  resultText = resultText.slice(0, 8000) + '…(truncated)"}';
                }
                
                send({ type: "tool_result", tool: toolBlock.name, platform, text: fmtResult(toolBlock.name, result), data: result });

                
                // ── FIX: Track successful image uploads across ALL iterations ──
                if (toolBlock.name === "meta_upload_ad_image") {
                  try {
                    const parsed = JSON.parse(resultText) as Record<string, unknown>;
                    if (parsed?.image_hash && parsed?.success === true) {
                      justUploadedImage = true;
                      hasUploadedImageSuccessfully = true; // persist across iterations
                    }
                  } catch { /* ignore */ }
                }
              } catch (toolErr) {
                const errMsg = String(toolErr);
                resultText = JSON.stringify({ error: errMsg });
                send({ type: "tool_result", tool: toolBlock.name, platform, text: `Error: ${errMsg}`, data: { error: errMsg } });
              }

              // Add this tool's result to the batch
              toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: resultText });
            }

            // Push ALL tool results as a single user turn
            claudeMessages.push({ role: "user", content: toolResults });

            if (iteration > 1) {
              await new Promise(r => setTimeout(r, 1500)); // 1.5s between iterations
            }
            // If we just uploaded an image successfully, inject a hard forcing nudge
            if (justUploadedImage) {
              claudeMessages.push({
                role: "user",
                content: [
                  { type: "text", text: "Image uploaded successfully. Now call meta_create_ad immediately using the image_hash from the result above. Do not write any text first — call the tool directly." },
                ] as ClaudeContentBlock[],
              });
            }

            continue;
          }

          // Any other stop reason
          break;
        }

        if (iteration >= MAX_ITERATIONS) {
          send({ type: "error", text: "Reached maximum tool call iterations (20). Please try a more specific request." });
        }

      } catch (err) {
        send({ type: "error", text: `Server error: ${String(err)}` });
      } finally {
        clearInterval(pingInterval);
        send({ type: "done" });
        controllerClosed = true;
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
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
    meta_get_user_profile: "Fetching authenticated user profile…",
    meta_list_businesses: "Fetching Business Manager portfolios…",
    meta_list_business_ad_accounts: `Fetching ad accounts for business ${i.business_id}…`,
    meta_list_business_pages: `Fetching Pages for business ${i.business_id}…`,
    meta_list_business_pixels: `Fetching Pixels for business ${i.business_id}…`,
    meta_get_business_user: `Fetching business users for ${i.business_id}…`,
    meta_list_catalogs: `Fetching catalogs for business ${i.business_id}…`,
    meta_create_catalog: `Creating catalog "${i.name}"…`,
    meta_get_catalog: `Fetching catalog ${i.catalog_id} details…`,
    meta_list_catalog_product_sets: `Fetching product sets for catalog ${i.catalog_id}…`,
    meta_create_product_set: `Creating product set "${i.name}"…`,
    meta_list_catalog_products: `Fetching products from catalog ${i.catalog_id}…`,
    meta_update_catalog_product: `Updating product ${i.retailer_id} in catalog ${i.catalog_id}…`,
    meta_get_catalog_diagnostics: `Running diagnostics on catalog ${i.catalog_id}…`,
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
  const data =
    r?.data as unknown[] || r?.results as unknown[] || r?.interests as unknown[] ||
    r?.businesses as unknown[] || r?.catalogs as unknown[] || r?.products as unknown[] ||
    r?.product_sets as unknown[] || r?.pages as unknown[] || r?.pixels as unknown[] ||
    r?.business_users as unknown[] || r?.owned_ad_accounts as unknown[];
  const count = Array.isArray(data) ? data.length : undefined;
  if (name === "meta_upload_ad_image") return r?.image_hash ? `Uploaded ✓ hash: ${r.image_hash}` : `Upload failed: ${JSON.stringify(r.raw ?? r)}`;
  if (name === "meta_search_interests") return `Found ${count ?? "?"} interest${count !== 1 ? "s" : ""}`;
  if (name === "meta_list_businesses") return `Found ${r?.count ?? "?"} Business Manager(s)`;
  if (name === "meta_list_business_ad_accounts") return `Found ${(r?.total as number) ?? "?"} ad account(s)`;
  if (name === "meta_list_business_pages") return `Found ${r?.count ?? "?"} Page(s)`;
  if (name === "meta_list_business_pixels") return `Found ${r?.count ?? "?"} Pixel(s)`;
  if (name === "meta_get_business_user") return `Found ${r?.count ?? "?"} business user(s)`;
  if (name === "meta_list_catalogs") return `Found ${r?.count ?? "?"} catalog(s)`;
  if (name === "meta_list_catalog_product_sets") return `Found ${r?.count ?? "?"} product set(s)`;
  if (name === "meta_list_catalog_products") return `Found ${r?.count ?? "?"} product(s)`;
  if (name === "meta_get_catalog_diagnostics") return "Diagnostics loaded";
  if (name.includes("list_") || (name.includes("get_") && !name.includes("metrics") && !name.includes("insights")))
    return `Found ${count ?? "?"} item${count !== 1 ? "s" : ""}`;
  if (name.includes("create_")) return r?.id || r?.resource_name || r?.ad_id || r?.success ? "Created ✓" : `Failed: ${JSON.stringify(r)}`;
  if (name.includes("update_") || name.includes("bulk_")) return r?.success !== false ? "Updated ✓" : `Failed: ${JSON.stringify(r)}`;
  if (name.includes("insights") || name.includes("metrics")) return `Metrics loaded (${count ?? "?"} rows)`;
  return "Done";
}