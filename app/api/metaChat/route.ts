import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ─── Next.js runtime config ───────────────────────────────────────────────────
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const META_VERSION = "v25.0";
const CLAUDE_MODEL = "claude-sonnet-4-5";
const BASE = `https://graph.facebook.com/${META_VERSION}`;

// ─── BigInt-safe JSON parser ──────────────────────────────────────────────────
function safeParseJSON(text: string): unknown {
  const safe = text.replace(/:(\s*)(-?\d{16,})([,\}\]])/g, (_m, sp, n, tail) => `:"${n}"${tail}`);
  return JSON.parse(safe);
}

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert Meta Ads manager AI. You help users manage Facebook/Instagram campaigns through natural language.

You manage the full hierarchy: Campaigns → Ad Sets → Ads, plus Custom Audiences.

CAMPAIGNS: list, get, create, update budget/status/objective, delete, insights
AD SETS: list, create with targeting, update budget/status/targeting, insights
ADS: list (with full creative name/body/image), get per-ad insights with ad names, update status, CREATE new ads with or without images
AUDIENCES: list, create custom (WEBSITE/CUSTOM/ENGAGEMENT subtypes), create lookalike
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
12. For bulk ops, list campaigns first to confirm scope before executing.
13. For create_ad: image_hash is OPTIONAL.
    - WITH image: call upload_ad_image first to get the hash, then pass image_hash to create_ad.
    - WITHOUT image (text/link ad): call create_ad directly with headline + body + link_url — no image_hash needed.
    - The ad creative requires a page_id — ask the user for their Facebook Page ID if not provided.
    - To reuse an already-existing creative, use create_ad_from_creative with its creative_id.
    - After create_ad succeeds, always tell the user the verified_campaign_id and verified_adset_id so they know exactly where to find the ad in Meta Ads Manager.
    - If verify_error is present in the response, warn the user that the ad may not have saved correctly.
14. CAMPAIGN BUDGET vs AD SET BUDGET: Meta CBO (Campaign Budget Optimization) campaigns own the budget — ad sets under them must NOT have a daily_budget. The create_adset tool handles this automatically: if a budget conflict occurs it retries without daily_budget. If auto_fixed=true is returned, tell the user the ad set was created and CBO manages the budget. NEVER call remove_campaign_budget before create_adset — it doesn't work and wastes a round-trip. Just call create_adset directly.
15. IMAGE UPLOADS: When the user provides image data (base64), use the exact IMAGE_N_BASE64 value provided in the message for upload_ad_image. Never truncate or modify image base64 data.`;

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
    name: "remove_campaign_budget",
    description: "Remove the campaign-level daily budget so that ad sets can have their own budgets. Call this when create_adset fails with a campaign/adset budget conflict error, then retry create_adset.",
    input_schema: {
      type: "object",
      properties: {
        campaign_id: { type: "string", description: "The campaign whose budget should be removed" },
        reason: { type: "string" },
      },
      required: ["campaign_id", "reason"],
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
    description: "Create a new ad set. Check campaign bid_strategy with get_campaign first. If the campaign has a campaign-level budget, omit daily_budget_cents OR call remove_campaign_budget first if the user wants ad-set-level budgets.",
    input_schema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        name: { type: "string" },
        daily_budget_cents: { type: "number", description: "Omit this field if the campaign already has a campaign-level budget to avoid conflict." },
        targeting_countries: { type: "array", items: { type: "string" }, description: "ISO codes e.g. ['US','AE']" },
        age_min: { type: "number" },
        age_max: { type: "number" },
        optimization_goal: { type: "string", enum: ["LINK_CLICKS","IMPRESSIONS","REACH","LEAD_GENERATION","CONVERSIONS","APP_INSTALLS"] },
        billing_event: { type: "string", enum: ["IMPRESSIONS","LINK_CLICKS"] },
        bid_amount_cents: { type: "number", description: "Required when campaign uses LOWEST_COST_WITH_BID_CAP or COST_CAP." },
        custom_audience_id: { type: "string" },
        advantage_audience: { type: "number", enum: [0, 1], description: "0 = manual targeting (default), 1 = Meta Advantage+ audience (AI-expanded targeting)" },
      },
      required: ["campaign_id", "name", "targeting_countries", "optimization_goal", "billing_event"],
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
    description: "List ads in an ad set with ad name, status, and full creative details (title, body, image URL). Use this to see creative names.",
    input_schema: { type: "object", properties: { adset_id: { type: "string" } }, required: ["adset_id"] },
  },
  {
    name: "get_ad_insights",
    description: "Get per-ad performance metrics INCLUDING ad_name and creative name. Use this to identify best/worst performing individual ads by name. Returns ad_id, ad_name, impressions, clicks, spend, CTR, CPC, ROAS.",
    input_schema: {
      type: "object",
      properties: {
        adset_id: { type: "string", description: "Get insights for all ads within this ad set" },
        campaign_id: { type: "string", description: "Alternatively, get insights for all ads across a whole campaign" },
        date_preset: { type: "string", enum: ["last_7d", "last_14d", "last_30d", "last_90d"] },
      },
      required: ["date_preset"],
    },
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
  {
    name: "upload_ad_image",
    description: "Upload an image to the ad account's image library. Returns an image_hash to use in create_ad. The image should be provided as a base64-encoded string. Call this BEFORE create_ad when the user has provided an image. Extract the full IMAGE_N_BASE64 value from the user message exactly as provided.",
    input_schema: {
      type: "object",
      properties: {
        image_base64: { type: "string", description: "Full base64-encoded image data (without data URI prefix). Use the complete IMAGE_N_BASE64 value from the user message." },
        image_filename: { type: "string", description: "Filename for the image e.g. 'ad-image.jpg'" },
      },
      required: ["image_base64", "image_filename"],
    },
  },
  {
    name: "create_ad",
    description: `Create a new ad within an ad set. Requires a Facebook Page ID. The ad starts PAUSED.
Two modes:
- WITH IMAGE: provide image_hash (from upload_ad_image) along with the other fields.
- WITHOUT IMAGE (text/link ad): omit image_hash entirely — headline, body, and link_url are sufficient to create a link-preview ad.`,
    input_schema: {
      type: "object",
      properties: {
        adset_id: { type: "string", description: "The ad set to place this ad in" },
        name: { type: "string", description: "Internal name for this ad" },
        page_id: { type: "string", description: "Facebook Page ID that will sponsor the ad" },
        image_hash: {
          type: "string",
          description: "Optional. Image hash from upload_ad_image. Omit entirely for text-only / link-preview ads.",
        },
        headline: { type: "string", description: "Primary headline text (max 40 chars recommended)" },
        body: { type: "string", description: "Main ad body copy / primary text" },
        link_url: { type: "string", description: "Destination URL when user clicks the ad" },
        call_to_action: {
          type: "string",
          enum: ["LEARN_MORE","SHOP_NOW","SIGN_UP","DOWNLOAD","CONTACT_US","BOOK_TRAVEL","APPLY_NOW","GET_OFFER","ORDER_NOW","WATCH_MORE","GET_QUOTE","SUBSCRIBE","DONATE_NOW","NO_BUTTON"],
          description: "CTA button label",
        },
        description: { type: "string", description: "Optional link description shown below headline" },
      },
      required: ["adset_id", "name", "page_id", "headline", "body", "link_url", "call_to_action"],
    },
  },
  {
    name: "create_ad_from_creative",
    description: "Create an ad using an existing creative ID. Use when the user already has a creative_id they want to reuse across ad sets.",
    input_schema: {
      type: "object",
      properties: {
        adset_id: { type: "string", description: "The ad set to place this ad in" },
        name: { type: "string", description: "Internal name for this ad" },
        creative_id: { type: "string", description: "Existing ad creative ID" },
        status: {
          type: "string",
          enum: ["ACTIVE", "PAUSED"],
          description: "Initial status. Defaults to PAUSED.",
        },
      },
      required: ["adset_id", "name", "creative_id"],
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
    description: "Create a new custom audience.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        subtype: { type: "string", enum: ["WEBSITE", "ENGAGEMENT", "CUSTOM"] },
        customer_file_source: { type: "string", enum: ["USER_PROVIDED_ONLY", "PARTNER_PROVIDED_ONLY", "BOTH_USER_AND_PARTNER_PROVIDED"] },
        pixel_id: { type: "string" },
        retention_days: { type: "number" },
      },
      required: ["name", "subtype"],
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
        country: { type: "string" },
        ratio: { type: "number" },
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

// Meta's ad/creative endpoints are more reliable with multipart/form-data,
// especially when fields contain nested JSON strings.
async function postForm(url: string, fields: Record<string, string>): Promise<unknown> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(url, { method: "POST", body: form });
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

  if (name === "remove_campaign_budget") {
    // Meta's Marketing API does not support removing a campaign-level budget programmatically
    // after the campaign is created. Return honest instructions instead.
    return {
      success: false,
      cbo_active: true,
      message: "The Meta API does not support removing a campaign-level budget programmatically after the campaign is created.",
      recommendation: "Use create_adset WITHOUT a daily_budget — CBO campaigns distribute the campaign budget across all ad sets automatically. You do not need an ad-set budget.",
      manual_steps: "If you want per-ad-set budgets: Meta Ads Manager → open campaign → Edit → toggle OFF 'Advantage campaign budget' → Save Draft → Publish.",
    };
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
    const {
      campaign_id, name: n, daily_budget_cents,
      targeting_countries, age_min, age_max,
      optimization_goal, billing_event, bid_amount_cents, custom_audience_id,
      advantage_audience,
    } = input as {
      campaign_id: string; name: string; daily_budget_cents?: number;
      targeting_countries: string[]; age_min?: number; age_max?: number;
      optimization_goal: string; billing_event: string;
      bid_amount_cents?: number; custom_audience_id?: string;
      advantage_audience?: number;
    };

    const targeting: Record<string, unknown> = {
      geo_locations: { countries: targeting_countries },
      targeting_automation: { advantage_audience: advantage_audience ?? 0 },
    };
    if (age_min) targeting.age_min = age_min;
    if (age_max) targeting.age_max = age_max;
    if (custom_audience_id) targeting.custom_audiences = [{ id: String(custom_audience_id) }];

    const effectiveBilling =
      optimization_goal === "LINK_CLICKS" && billing_event === "LINK_CLICKS"
        ? "IMPRESSIONS"
        : billing_event;

    const attemptCreate = async (includeBudget: boolean) => {
      const p = new URLSearchParams({
        campaign_id: String(campaign_id),
        name: n,
        targeting: JSON.stringify(targeting),
        optimization_goal,
        billing_event: effectiveBilling,
        status: "PAUSED",
        access_token: tok,
      });
      if (includeBudget && daily_budget_cents != null && daily_budget_cents > 0) {
        p.set("daily_budget", String(Math.round(daily_budget_cents)));
      }
      if (bid_amount_cents) p.set("bid_amount", String(Math.round(bid_amount_cents)));
      return post(`${BASE}/${acct}/adsets`, p) as Promise<Record<string, unknown>>;
    };

    const result1 = await attemptCreate(true);
    if (result1?.id) return result1;

    const err1 = result1?.error as Record<string, unknown> | undefined;

    const isBudgetConflict =
      String(err1?.error_subcode) === "1885621" ||
      String(err1?.error_user_title ?? "").toLowerCase().includes("budget") ||
      String(err1?.error_user_msg ?? "").toLowerCase().includes("budget");

    if (isBudgetConflict) {
      const result2 = await attemptCreate(false);
      if (result2?.id) {
        const budgetNote = daily_budget_cents
          ? ` The requested $${(daily_budget_cents / 100).toFixed(2)}/day budget was ignored because this is a CBO campaign — the campaign's budget covers all ad sets.`
          : "";
        return {
          ...result2,
          auto_fixed: true,
          note: "Ad set created successfully. This campaign uses Campaign Budget Optimization (CBO) — the campaign-level budget is shared across all ad sets." + budgetNote,
        };
      }
      return {
        error: result2?.error ?? err1,
        budget_conflict: true,
        message: "Could not create ad set under this CBO campaign.",
        manual_fix: "In Meta Ads Manager: Campaign → Edit → toggle off 'Advantage campaign budget' → Save. Then individual ad-set budgets will work.",
      };
    }

    const needsBudget =
      String(err1?.message ?? "").includes("daily_budget must be a number") ||
      String(err1?.message ?? "").toLowerCase().includes("param daily_budget");

    if (needsBudget) {
      return {
        error: err1,
        needs_budget: true,
        message: "This campaign requires a daily budget at the ad-set level. Please provide daily_budget_cents (e.g. 5000 for $50/day) and retry.",
      };
    }

    return result1;
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
    const fields = [
      "id", "name", "status", "adset_id", "campaign_id",
      "creative{id,name,title,body,image_url,thumbnail_url,object_story_spec}",
    ].join(",");
    const res = await fetch(`${BASE}/${String(input.adset_id)}/ads?fields=${fields}&access_token=${tok}`);
    return safeParseJSON(await res.text());
  }

  if (name === "get_ad_insights") {
    const { adset_id, campaign_id, date_preset } = input as { adset_id?: string; campaign_id?: string; date_preset: string };
    const fields = "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,actions,action_values,purchase_roas";

    let url: string;
    if (adset_id) {
      const filtering = encodeURIComponent(JSON.stringify([{ field: "adset.id", operator: "EQUAL", value: String(adset_id) }]));
      url = `${BASE}/${acct}/insights?fields=${fields}&level=ad&date_preset=${date_preset}&filtering=${filtering}&access_token=${tok}`;
    } else if (campaign_id) {
      const filtering = encodeURIComponent(JSON.stringify([{ field: "campaign.id", operator: "EQUAL", value: String(campaign_id) }]));
      url = `${BASE}/${acct}/insights?fields=${fields}&level=ad&date_preset=${date_preset}&filtering=${filtering}&access_token=${tok}`;
    } else {
      url = `${BASE}/${acct}/insights?fields=${fields}&level=ad&date_preset=${date_preset}&access_token=${tok}`;
    }

    const res = await fetch(url);
    return safeParseJSON(await res.text());
  }

  if (name === "update_ad_status") {
    const { ad_id, status } = input as { ad_id: string; status: string };
    return post(`${BASE}/${String(ad_id)}`, new URLSearchParams({ status, access_token: tok }));
  }

  // ─── Image Upload ────────────────────────────────────────────────────────
  if (name === "upload_ad_image") {
    const { image_base64, image_filename } = input as { image_base64: string; image_filename: string };

    if (!image_base64 || image_base64.length < 100) {
      return { error: "image_base64 is empty or too short. Make sure to pass the full IMAGE_N_BASE64 value from the user message." };
    }

    const binaryString = atob(image_base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const ext = image_filename.toLowerCase().split(".").pop() ?? "jpg";
    const mimeMap: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
    const mimeType = mimeMap[ext] ?? "image/jpeg";

    const formData = new FormData();
    formData.append("access_token", tok);
    formData.append("filename", new Blob([bytes], { type: mimeType }), image_filename);

    const res = await fetch(`${BASE}/${acct}/adimages`, { method: "POST", body: formData });
    const result = safeParseJSON(await res.text()) as Record<string, unknown>;

    if (result.images) {
      const images = result.images as Record<string, { hash: string; url: string; width: number; height: number }>;
      const firstKey = Object.keys(images)[0];
      if (firstKey) {
        const img = images[firstKey];
        return { success: true, image_hash: img.hash, image_url: img.url, width: img.width, height: img.height };
      }
    }
    return result;
  }

  // ─── Create Ad (with OR without image) ──────────────────────────────────
  if (name === "create_ad") {
    const {
      adset_id,
      name: adName,
      page_id,
      image_hash,      // intentionally optional
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

    // Build link_data — only include image_hash when provided and non-empty
    const linkData: Record<string, unknown> = {
      link: link_url,
      message: body,
      name: headline,
      call_to_action: { type: call_to_action },
      ...(description ? { description } : {}),
    };
    if (hasImage) linkData.image_hash = image_hash!.trim();

    // Step 1: Create the ad creative (multipart avoids URL-encoding issues with nested JSON)
    const objectStorySpec = {
      page_id: String(page_id),
      link_data: linkData,
    };

    const creativeRes = await postForm(`${BASE}/${acct}/adcreatives`, {
      name: `${adName} Creative`,
      object_story_spec: JSON.stringify(objectStorySpec),
      access_token: tok,
    }) as Record<string, unknown>;

    if (creativeRes.error) {
      return {
        error: `Failed to create creative: ${JSON.stringify(creativeRes.error)}`,
        ad_type: hasImage ? "image" : "text_link",
        creative_payload: objectStorySpec,
        debug: { page_id: String(page_id), adset_id: String(adset_id), acct },
      };
    }

    const creativeId = String(creativeRes.id);

    // Step 2: Create the ad using the creative (multipart for same reason)
    const adRes = await postForm(`${BASE}/${acct}/ads`, {
      name: adName,
      adset_id: String(adset_id),
      creative: JSON.stringify({ creative_id: creativeId }),
      status: "PAUSED",
      access_token: tok,
    }) as Record<string, unknown>;

    if (adRes.id) {
      // Step 3: Verify the ad actually exists by reading it back
      const verifyRes = await fetch(
        `${BASE}/${String(adRes.id)}?fields=id,name,status,adset_id,campaign_id&access_token=${tok}`
      );
      const verified = safeParseJSON(await verifyRes.text()) as Record<string, unknown>;

      return {
        success: true,
        ad_id: adRes.id,
        creative_id: creativeId,
        status: "PAUSED",
        ad_type: hasImage ? "image" : "text_link",
        // Include verified data so Claude can confirm exact IDs to the user
        verified_ad_id: verified?.id,
        verified_adset_id: verified?.adset_id,
        verified_campaign_id: verified?.campaign_id,
        verified_status: verified?.status,
        verify_error: verified?.error ? JSON.stringify(verified.error) : undefined,
      };
    }

    // Ad creation failed — return full response for debugging
    return {
      ...adRes,
      creative_id: creativeId,
      debug: { adset_id: String(adset_id), acct, creative_id: creativeId },
    };
  }

  // ─── Create Ad from existing Creative ───────────────────────────────────
  if (name === "create_ad_from_creative") {
    const {
      adset_id,
      name: adName,
      creative_id,
      status = "PAUSED",
    } = input as {
      adset_id: string;
      name: string;
      creative_id: string;
      status?: string;
    };

    const adRes = await postForm(`${BASE}/${acct}/ads`, {
      name: adName,
      adset_id: String(adset_id),
      creative: JSON.stringify({ creative_id: String(creative_id) }),
      status: String(status),
      access_token: tok,
    }) as Record<string, unknown>;

    if (adRes.id) {
      // Verify the ad exists
      const verifyRes = await fetch(
        `${BASE}/${String(adRes.id)}?fields=id,name,status,adset_id,campaign_id&access_token=${tok}`
      );
      const verified = safeParseJSON(await verifyRes.text()) as Record<string, unknown>;
      return {
        success: true,
        ad_id: adRes.id,
        creative_id,
        status,
        verified_ad_id: verified?.id,
        verified_adset_id: verified?.adset_id,
        verified_campaign_id: verified?.campaign_id,
      };
    }
    return { ...adRes, debug: { adset_id: String(adset_id), creative_id, acct } };
  }

  // Audiences ──────────────────────────────────────────────────────────────
  if (name === "list_custom_audiences") {
    const fields = "id,name,subtype,approximate_count,description,delivery_status";
    const res = await fetch(`${BASE}/${acct}/customaudiences?fields=${fields}&access_token=${tok}`);
    return safeParseJSON(await res.text());
  }

  if (name === "create_custom_audience") {
    const { name: n, description, subtype, customer_file_source, pixel_id, retention_days } = input as {
      name: string; description?: string; subtype: string;
      customer_file_source?: string; pixel_id?: string; retention_days?: number;
    };

    const p = new URLSearchParams({ name: n, subtype, access_token: tok });
    if (description) p.set("description", description);

    if (subtype === "CUSTOM") {
      p.set("customer_file_source", customer_file_source ?? "USER_PROVIDED_ONLY");
    }

    if (subtype === "WEBSITE") {
      if (!pixel_id) return { error: "pixel_id is required for WEBSITE audiences. Ask the user for their Meta Pixel ID." };
      const days = retention_days ?? 30;
      p.set("pixel_id", String(pixel_id));
      p.set("rule", JSON.stringify({
        inclusions: {
          operator: "or",
          rules: [{ event_sources: [{ id: String(pixel_id), type: "pixel" }], retention_seconds: days * 86400, filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: "PageView" }] } }],
        },
      }));
    }

    if (subtype === "ENGAGEMENT") {
      p.set("rule", JSON.stringify({
        inclusions: { operator: "or", rules: [{ retention_seconds: 30 * 86400, event_sources: [] }] },
      }));
    }

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
      const send = (data: object) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(data) + "\n")); } catch { /* stream closed */ }
      };

      try {
        const claudeMessages: ClaudeMessage[] = messages.map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        let iteration = 0;
        while (iteration++ < 10) {
          const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 4096, system: SYSTEM_PROMPT, tools: TOOLS, messages: claudeMessages }),
          });

          if (!claudeRes.ok) {
            const err = await claudeRes.json().catch(() => ({ message: claudeRes.statusText }));
            send({ type: "error", text: `Claude API error ${claudeRes.status}: ${JSON.stringify(err)}` });
            break;
          }

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

              // Send a keepalive ping so proxies/CDN don't close the connection during long ops
              send({ type: "ping" });

              let resultText: string;
              const toolTimeout = block.name === "upload_ad_image" ? 120_000 : 30_000;
              try {
                const result = await Promise.race([
                  executeTool(block.name, block.input, accessToken, adAccountId),
                  new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error(`Tool ${block.name} timed out after ${toolTimeout / 1000}s`)), toolTimeout)
                  ),
                ]);
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
      } catch (fatalErr) {
        send({ type: "error", text: `Server error: ${String(fatalErr)}` });
      } finally {
        send({ type: "done" });
        try { controller.close(); } catch { /* already closed */ }
      }
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
    case "list_campaigns":              return "Fetching all campaigns...";
    case "get_campaign":                return `Fetching campaign ${i.campaign_id} details...`;
    case "get_campaign_insights":       return `Fetching campaign performance (${i.date_preset})...`;
    case "create_campaign":             return `Creating campaign "${i.name}" (${i.objective})...`;
    case "update_campaign_budget":      return `Updating campaign ${i.campaign_id} budget → ${$(i.new_daily_budget_cents)}/day`;
    case "remove_campaign_budget":      return `Removing campaign-level budget from campaign ${i.campaign_id}...`;
    case "update_campaign_status":      return `Setting campaign ${i.campaign_id} → ${i.status}`;
    case "update_campaign_objective":   return `Updating campaign ${i.campaign_id} objective → ${i.objective}`;
    case "delete_campaign":             return `⚠️ Deleting campaign "${i.campaign_name}" permanently...`;
    case "bulk_update_campaign_status": {
      const ids = i.campaign_ids as string[];
      return `Bulk setting ${ids.length} campaign${ids.length !== 1 ? "s" : ""} → ${i.status}...`;
    }
    case "list_adsets":                 return `Fetching ad sets for campaign ${i.campaign_id}...`;
    case "create_adset":                return `Creating ad set "${i.name}" in campaign ${i.campaign_id}...`;
    case "update_adset_targeting":      return `Updating targeting for ad set ${i.adset_id}...`;
    case "update_adset_budget":         return `Updating ad set ${i.adset_id} budget → ${$(i.new_daily_budget_cents)}/day`;
    case "update_adset_status":         return `Setting ad set ${i.adset_id} → ${i.status}`;
    case "get_adset_insights":          return `Fetching ad set performance (${i.date_preset})...`;
    case "list_ads":                    return `Fetching ads in ad set ${i.adset_id}...`;
    case "get_ad_insights":             return i.adset_id
      ? `Fetching ad performance in ad set ${i.adset_id} (${i.date_preset})...`
      : `Fetching ad performance in campaign ${i.campaign_id} (${i.date_preset})...`;
    case "update_ad_status":            return `Setting ad ${i.ad_id} → ${i.status}`;
    case "upload_ad_image":             return `Uploading image "${i.image_filename}" to ad library...`;
    case "create_ad":                   return `Creating ${i.image_hash ? "image" : "text/link"} ad "${i.name}" in ad set ${i.adset_id}...`;
    case "create_ad_from_creative":     return `Creating ad "${i.name}" from existing creative ${i.creative_id}...`;
    case "list_custom_audiences":       return "Fetching custom audiences...";
    case "create_custom_audience":      return `Creating audience "${i.name}"...`;
    case "create_lookalike_audience":   return `Creating lookalike "${i.name}" (${i.country}, ${((i.ratio as number) * 100).toFixed(0)}%)...`;
    default: return `Calling ${name}...`;
  }
}

function fmtResult(name: string, result: unknown): string {
  const r = result as Record<string, unknown>;
  if (r?.error) return `Error: ${JSON.stringify(r.error)}`;
  const count = (key = "data") => { const d = r?.[key] as unknown[]; return d?.length; };
  const ok = (msg: string) => r?.success ? `${msg} ✓` : `Response: ${JSON.stringify(r)}`;
  switch (name) {
    case "list_campaigns":              return `Found ${count() ?? "?"} campaign${count() !== 1 ? "s" : ""}`;
    case "get_campaign":                return r?.id ? `Campaign: ${r.name} (${r.status}, ${r.bid_strategy ?? "auto bid"})` : `Response: ${JSON.stringify(r)}`;
    case "get_campaign_insights":       return `Insights for ${count() ?? "?"} campaign${count() !== 1 ? "s" : ""}`;
    case "create_campaign":             return r?.id ? `Campaign created ✓ (ID: ${r.id})` : `Response: ${JSON.stringify(r)}`;
    case "update_campaign_budget":      return ok("Budget updated");
    case "remove_campaign_budget":      return r?.cbo_active ? "CBO active — ad sets don't need their own budget" : (r?.success ? "Campaign budget removed ✓" : `API note: ${r?.recommendation ?? r?.message ?? JSON.stringify(r)}`);
    case "update_campaign_status":      return ok("Status updated");
    case "update_campaign_objective":   return ok("Objective updated");
    case "delete_campaign":             return ok("Campaign deleted");
    case "bulk_update_campaign_status": return `Bulk update: ${r?.succeeded}/${r?.total} succeeded ✓`;
    case "list_adsets":                 return `Found ${count() ?? "?"} ad set${count() !== 1 ? "s" : ""}`;
    case "create_adset": {
      if (r?.id) {
        const note = r?.auto_fixed ? " (CBO — campaign budget applies)" : "";
        return `Ad set created ✓ (ID: ${r.id})${note}`;
      }
      if (r?.budget_conflict) return `Budget conflict — ${r?.manual_fix ?? "disable CBO in Ads Manager"}`;
      if (r?.needs_budget) return "Needs daily_budget_cents — ask user for amount";
      return `Response: ${JSON.stringify(r)}`;
    }
    case "update_adset_targeting":      return ok("Targeting updated");
    case "update_adset_budget":         return ok("Ad set budget updated");
    case "update_adset_status":         return ok("Ad set status updated");
    case "get_adset_insights":          return `Insights for ${count() ?? "?"} ad set${count() !== 1 ? "s" : ""}`;
    case "list_ads":                    return `Found ${count() ?? "?"} ad${count() !== 1 ? "s" : ""}`;
    case "get_ad_insights": {
      const d = r?.data as unknown[];
      return d ? `Ad insights for ${d.length} ad${d.length !== 1 ? "s" : ""} (with names)` : "Ad insights loaded";
    }
    case "update_ad_status":            return ok("Ad status updated");
    case "upload_ad_image":             return r?.image_hash ? `Image uploaded ✓ (hash: ${String(r.image_hash).slice(0, 12)}...)` : `Response: ${JSON.stringify(r)}`;
    case "create_ad": {
      if (r?.ad_id) {
        const adType = r?.ad_type === "image" ? "Image ad" : "Text/link ad";
        const verified = r?.verified_ad_id ? ` — verified in account ✓` : (r?.verify_error ? ` — WARNING: verify failed: ${r.verify_error}` : "");
        return `${adType} created (ID: ${r.ad_id}, adset: ${r.verified_adset_id ?? "?"}, campaign: ${r.verified_campaign_id ?? "?"}, status: ${r.verified_status ?? "PAUSED"})${verified}`;
      }
      return `Failed: ${JSON.stringify(r)}`;
    }
    case "create_ad_from_creative": {
      if (r?.ad_id) {
        return `Ad created ✓ (ID: ${r.ad_id}, adset: ${r.verified_adset_id ?? "?"}, campaign: ${r.verified_campaign_id ?? "?"})`;
      }
      return `Failed: ${JSON.stringify(r)}`;
    }
    case "list_custom_audiences":       return `Found ${count() ?? "?"} audience${count() !== 1 ? "s" : ""}`;
    case "create_custom_audience":      return r?.id ? `Audience created ✓ (ID: ${r.id})` : `Response: ${JSON.stringify(r)}`;
    case "create_lookalike_audience":   return r?.id ? `Lookalike created ✓ (ID: ${r.id})` : `Response: ${JSON.stringify(r)}`;
    default: return "Done";
  }
}