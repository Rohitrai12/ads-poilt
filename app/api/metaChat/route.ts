import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const META_VERSION = "v25.0";
const CLAUDE_MODEL = "claude-sonnet-4-5";

const SYSTEM_PROMPT = `You are an expert Meta Ads manager AI. You help users manage their Facebook/Instagram ad campaigns through natural language.

You have access to tools to:
- List all campaigns and their budgets/status
- Fetch performance insights (ROAS, CTR, CPC, spend, impressions, conversions)
- Update campaign budgets
- Pause, activate, or archive campaigns
- Update campaign objective
- Delete campaigns permanently
- Create new campaigns

Behavioral rules:
1. Always fetch real data before making decisions — never guess at campaign names or performance.
2. When the user asks about "best performing", analyze ROAS first, then CTR, then lowest CPC.
3. When changing budgets, calculate the exact new value and confirm: "Increasing from $X to $Y (+Z%)".
4. Be concise and action-oriented. No filler. State what you found, what you're doing, what happened.
5. Budgets in Meta API are in CENTS (e.g. $50/day = 5000). Always convert correctly.
6. ARCHIVE vs DELETE: Archive is reversible (use for "stop without losing data"). Delete is permanent — always confirm before deleting.
7. If an action is destructive (deleting, pausing high-performers), warn the user and state what will be lost.`;

const TOOLS = [
  {
    name: "list_campaigns",
    description:
      "List all campaigns in the ad account with their ID, name, status, objective, and daily/lifetime budget.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_campaign_insights",
    description:
      "Get performance metrics for campaigns: spend, impressions, clicks, CTR, CPC, conversions, and ROAS (purchase_roas). Use to find best/worst performers.",
    input_schema: {
      type: "object",
      properties: {
        date_preset: {
          type: "string",
          enum: ["last_7d", "last_14d", "last_30d", "last_90d"],
          description: "Time period for the data",
        },
        campaign_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional: filter to specific campaign IDs",
        },
      },
      required: ["date_preset"],
    },
  },
  {
    name: "update_campaign_budget",
    description:
      "Update the daily budget for a campaign. Budget must be in CENTS (e.g. $50/day = 5000).",
    input_schema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        new_daily_budget_cents: {
          type: "number",
          description: "New daily budget in cents",
        },
        reason: { type: "string" },
      },
      required: ["campaign_id", "new_daily_budget_cents", "reason"],
    },
  },
  {
    name: "update_campaign_status",
    description: "Change a campaign's status. Use ACTIVE to run, PAUSED to pause, ARCHIVED to archive (reversible stop). Archived campaigns can be restored to ACTIVE.",
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
    name: "update_campaign_objective",
    description: "Change the objective of a campaign (e.g. from LINK_CLICKS to CONVERSIONS). Use when user wants to change what the campaign optimizes for.",
    input_schema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        objective: {
          type: "string",
          enum: ["OUTCOME_TRAFFIC", "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_ENGAGEMENT", "OUTCOME_AWARENESS", "OUTCOME_APP_PROMOTION"],
          description: "New campaign objective",
        },
        reason: { type: "string" },
      },
      required: ["campaign_id", "objective", "reason"],
    },
  },
  {
    name: "delete_campaign",
    description: "PERMANENTLY delete a campaign. This cannot be undone. Only use when user explicitly confirms they want to delete, not just pause or archive.",
    input_schema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        campaign_name: { type: "string", description: "Name of the campaign, for confirmation logging" },
        confirmed: { type: "boolean", description: "Must be true — only delete if user explicitly confirmed" },
      },
      required: ["campaign_id", "campaign_name", "confirmed"],
    },
  },
  {
    name: "create_campaign",
    description: "Create a new ad campaign in the ad account. Campaign starts as PAUSED so the user can review before activating.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Campaign name" },
        objective: {
          type: "string",
          enum: ["OUTCOME_TRAFFIC", "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_ENGAGEMENT", "OUTCOME_AWARENESS", "OUTCOME_APP_PROMOTION"],
          description: "Campaign objective",
        },
        special_ad_category: {
          type: "string",
          enum: ["NONE", "EMPLOYMENT", "HOUSING", "CREDIT"],
          description: "Special ad category if applicable, otherwise NONE",
        },
        daily_budget_cents: {
          type: "number",
          description: "Optional daily budget in cents (e.g. 5000 = $50/day). If not provided, campaign is created without a budget.",
        },
      },
      required: ["name", "objective", "special_ad_category"],
    },
  },
];

type ToolInput = Record<string, unknown>;

async function executeTool(
  name: string,
  input: ToolInput,
  accessToken: string,
  adAccountId: string
): Promise<unknown> {
  const base = `https://graph.facebook.com/${META_VERSION}`;

  if (name === "list_campaigns") {
    const fields = "id,name,status,objective,daily_budget,lifetime_budget,budget_remaining";
    const url = `${base}/act_${adAccountId}/campaigns?fields=${fields}&access_token=${accessToken}`;
    const res = await fetch(url);
    return res.json();
  }

  if (name === "get_campaign_insights") {
    const { date_preset, campaign_ids } = input as {
      date_preset: string;
      campaign_ids?: string[];
    };
    const fields =
      "campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,actions,action_values,purchase_roas";
    let url = `${base}/act_${adAccountId}/insights?fields=${fields}&level=campaign&date_preset=${date_preset}&access_token=${accessToken}`;
    if (campaign_ids?.length) {
      url += `&filtering=${encodeURIComponent(
        JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaign_ids }])
      )}`;
    }
    const res = await fetch(url);
    return res.json();
  }

  if (name === "update_campaign_budget") {
    const { campaign_id, new_daily_budget_cents } = input as {
      campaign_id: string;
      new_daily_budget_cents: number;
    };
    const params = new URLSearchParams({
      daily_budget: String(Math.round(new_daily_budget_cents)),
      access_token: accessToken,
    });
    const res = await fetch(`${base}/${campaign_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    return res.json();
  }

  if (name === "update_campaign_status") {
    const { campaign_id, status } = input as {
      campaign_id: string;
      status: string;
    };
    const params = new URLSearchParams({
      status,
      access_token: accessToken,
    });
    const res = await fetch(`${base}/${campaign_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    return res.json();
  }

  if (name === "update_campaign_objective") {
    const { campaign_id, objective } = input as {
      campaign_id: string;
      objective: string;
    };
    const params = new URLSearchParams({
      objective,
      access_token: accessToken,
    });
    const res = await fetch(`${base}/${campaign_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    return res.json();
  }

  if (name === "delete_campaign") {
    const { campaign_id, confirmed } = input as {
      campaign_id: string;
      confirmed: boolean;
    };
    if (!confirmed) {
      return { error: "Deletion not confirmed. Ask the user to explicitly confirm before deleting." };
    }
    const url = `${base}/${campaign_id}?access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url, { method: "DELETE" });
    return res.json();
  }

  if (name === "create_campaign") {
    const { name: campaignName, objective, special_ad_category, daily_budget_cents } = input as {
      name: string;
      objective: string;
      special_ad_category: string;
      daily_budget_cents?: number;
    };
    const params = new URLSearchParams({
      name: campaignName,
      objective,
      status: "PAUSED",
      special_ad_categories: JSON.stringify([special_ad_category]),
      access_token: accessToken,
    });
    if (daily_budget_cents) {
      params.set("daily_budget", String(Math.round(daily_budget_cents)));
    }
    const res = await fetch(`${base}/act_${adAccountId}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    return res.json();
  }

  return { error: "Unknown tool" };
}

type ClaudeMessage = {
  role: "user" | "assistant";
  content: string | ClaudeContentBlock[];
};

type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: ToolInput }
  | { type: "tool_result"; tool_use_id: string; content: string };

export async function POST(request: NextRequest) {
  const { messages, accessToken, adAccountId } = await request.json();

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to .env.local" },
      { status: 500 }
    );
  }

  if (!accessToken || !adAccountId) {
    return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
      };

      // Build Claude message history
      const claudeMessages: ClaudeMessage[] = messages.map(
        (m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })
      );

      let iteration = 0;
      const MAX_ITERATIONS = 8;

      while (iteration < MAX_ITERATIONS) {
        iteration++;

        const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: CLAUDE_MODEL,
            max_tokens: 2048,
            system: SYSTEM_PROMPT,
            tools: TOOLS,
            messages: claudeMessages,
          }),
        });

        if (!claudeRes.ok) {
          const errBody = await claudeRes.json().catch(() => ({ message: claudeRes.statusText }));
          send({ type: "error", text: `Claude API error ${claudeRes.status}: ${JSON.stringify(errBody)}` });
          break;
        }

        const claudeData = await claudeRes.json();
        const { content, stop_reason } = claudeData;

        // Emit text blocks immediately
        for (const block of content) {
          if (block.type === "text" && block.text.trim()) {
            send({ type: "text", text: block.text });
          }
        }

        if (stop_reason === "end_turn") {
          break;
        }

        if (stop_reason === "tool_use") {
          // Add assistant message to history
          claudeMessages.push({ role: "assistant", content });

          const toolResults: ClaudeContentBlock[] = [];

          for (const block of content) {
            if (block.type !== "tool_use") continue;

            send({
              type: "tool_call",
              tool: block.name,
              input: block.input,
              text: formatToolCallLabel(block.name, block.input),
            });

            let result: unknown;
            let resultText: string;

            try {
              result = await executeTool(
                block.name,
                block.input,
                accessToken,
                adAccountId
              );
              resultText = JSON.stringify(result);
              send({
                type: "tool_result",
                tool: block.name,
                text: formatToolResultLabel(block.name, result),
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

      send({ type: "done" });
      controller.close();
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

function formatToolCallLabel(name: string, input: ToolInput): string {
  switch (name) {
    case "list_campaigns":
      return "Fetching all campaigns...";
    case "get_campaign_insights":
      return `Fetching performance data (${input.date_preset})...`;
    case "update_campaign_budget": {
      const cents = input.new_daily_budget_cents as number;
      return `Updating budget to $${(cents / 100).toFixed(2)}/day for campaign ${input.campaign_id}`;
    }
    case "update_campaign_status":
      return `Setting campaign ${input.campaign_id} to ${input.status}`;
    case "update_campaign_objective":
      return `Updating objective to ${input.objective} for campaign ${input.campaign_id}`;
    case "delete_campaign":
      return `⚠️ Deleting campaign "${input.campaign_name}" (${input.campaign_id}) permanently...`;
    case "create_campaign":
      return `Creating campaign "${input.name}" (${input.objective})...`;
    default:
      return `Calling ${name}...`;
  }
}

function formatToolResultLabel(name: string, result: unknown): string {
  const r = result as Record<string, unknown>;
  if (r?.error) return `Error: ${JSON.stringify(r.error)}`;
  switch (name) {
    case "list_campaigns": {
      const data = r?.data as unknown[];
      return data ? `Found ${data.length} campaign${data.length !== 1 ? "s" : ""}` : "Campaigns loaded";
    }
    case "get_campaign_insights": {
      const data = r?.data as unknown[];
      return data ? `Retrieved insights for ${data.length} campaign${data.length !== 1 ? "s" : ""}` : "Insights loaded";
    }
    case "update_campaign_budget":
      return r?.success ? "Budget updated ✓" : `Response: ${JSON.stringify(r)}`;
    case "update_campaign_status":
      return r?.success ? "Status updated ✓" : `Response: ${JSON.stringify(r)}`;
    case "update_campaign_objective":
      return r?.success ? "Objective updated ✓" : `Response: ${JSON.stringify(r)}`;
    case "delete_campaign":
      return r?.success ? "Campaign deleted ✓" : `Response: ${JSON.stringify(r)}`;
    case "create_campaign":
      return r?.id ? `Campaign created ✓ (ID: ${r.id})` : `Response: ${JSON.stringify(r)}`;
    default:
      return "Done";
  }
}