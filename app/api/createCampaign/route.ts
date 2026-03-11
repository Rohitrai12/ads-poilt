import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

type SpecialAdCategory = "NONE" | "EMPLOYMENT" | "HOUSING" | "CREDIT";
type Objective =
  | "OUTCOME_TRAFFIC"
  | "OUTCOME_LEADS"
  | "OUTCOME_SALES"
  | "OUTCOME_ENGAGEMENT";

type CreateCampaignBody = {
  accessToken: string;
  adAccountId: string;
  campaignName: string;
  objective: Objective;
  category: SpecialAdCategory;
};

export async function POST(request: NextRequest) {
  let body: CreateCampaignBody;
  try {
    body = (await request.json()) as CreateCampaignBody;
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const { accessToken, adAccountId, campaignName, objective, category } = body;

  if (!accessToken || !adAccountId || !campaignName || !objective || !category) {
    return NextResponse.json(
      { message: "Missing required fields" },
      { status: 400 },
    );
  }

  const metaUrl = `https://graph.facebook.com/v25.0/act_${adAccountId}/campaigns`;
  const params = new URLSearchParams({
    name: campaignName,
    objective,
    status: "PAUSED",
    special_ad_categories: JSON.stringify([category]),
    is_adset_budget_sharing_enabled: "false",
    access_token: accessToken,
  });

  const metaRes = await fetch(metaUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  const data = await metaRes.json().catch(() => null);

  if (!metaRes.ok) {
    return NextResponse.json(
      { error: data ?? { message: "Meta API request failed" } },
      { status: metaRes.status || 500 },
    );
  }

  return NextResponse.json(data);
}

