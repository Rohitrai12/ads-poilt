// app/api/auth/facebook/callback/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const META_VERSION = "v25.0";

type MetaAccount = {
  id: string;
  name?: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
  business?: { id: string; name?: string };
};

function normalizeAccountId(id: string) {
  return id.replace(/^act_/i, "");
}

function mergeAccounts(primary: MetaAccount[], fromBusinesses: MetaAccount[]) {
  const byId = new Map<string, MetaAccount>();
  for (const acct of [...primary, ...fromBusinesses]) {
    if (!acct?.id) continue;
    const key = normalizeAccountId(acct.id);
    const prev = byId.get(key);
    byId.set(key, {
      ...prev,
      ...acct,
      id: acct.id.startsWith("act_") ? acct.id : `act_${key}`,
      business: acct.business ?? prev?.business,
    });
  }
  return Array.from(byId.values());
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(
      `${origin}/dashboard/chat?fb_error=${error ?? "cancelled"}`
    );
  }

  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  const redirectUri = `${origin}/api/auth/facebook/callback`;

  if (!appId || !appSecret) {
    return NextResponse.redirect(`${origin}/dashboard/chat?fb_error=missing_env`);
  }

  // ── 1. Exchange code → short-lived token ─────────────────────────────────
  const tokenRes = await fetch(
    `https://graph.facebook.com/${META_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code,
      })
  );
  const tokenData = await tokenRes.json();

  if (tokenData.error || !tokenData.access_token) {
    const msg = tokenData.error?.message ?? "token_exchange_failed";
    return NextResponse.redirect(
      `${origin}/dashboard/chat?fb_error=${encodeURIComponent(msg)}`
    );
  }

  const shortToken = tokenData.access_token;

  // ── 2. Exchange → long-lived token (60 days) ──────────────────────────────
  const longRes = await fetch(
    `https://graph.facebook.com/${META_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortToken,
      })
  );
  const longData = await longRes.json();
  const accessToken = longData.access_token ?? shortToken;

  // ── 3. Fetch resources in parallel ───────────────────────────────────────
  const [acctRes, pagesRes, businessesRes] = await Promise.all([
    // Ad accounts — include owner info to help user identify them
    fetch(
      `https://graph.facebook.com/${META_VERSION}/me/adaccounts` +
        `?fields=id,name,account_status,currency,timezone_name,business` +
        `&limit=50&access_token=${accessToken}`
    ),
    // Facebook Pages the user manages
    fetch(
      `https://graph.facebook.com/${META_VERSION}/me/accounts` +
        `?fields=id,name,category,picture` +
        `&limit=50&access_token=${accessToken}`
    ),
    // Businesses user has access to
    fetch(
      `https://graph.facebook.com/${META_VERSION}/me/businesses` +
        `?fields=id,name&limit=25&access_token=${accessToken}`
    ),
  ]);

  const [acctData, pagesData, businessesData] = await Promise.all([
    acctRes.json(),
    pagesRes.json(),
    businessesRes.json(),
  ]);
  const primaryAdAccounts = (acctData.data ?? []) as MetaAccount[];
  const pages = pagesData.data ?? [];
  const businesses = (businessesData.data ?? []) as Array<{ id: string; name?: string }>;

  // Fetch business-owned and client ad accounts for each business.
  const businessAccountArrays = await Promise.allSettled(
    businesses.slice(0, 15).map(async (b) => {
      const [ownedRes, clientRes] = await Promise.all([
        fetch(
          `https://graph.facebook.com/${META_VERSION}/${b.id}/owned_ad_accounts` +
            `?fields=id,name,account_status,currency,timezone_name,business&limit=50&access_token=${accessToken}`
        ),
        fetch(
          `https://graph.facebook.com/${META_VERSION}/${b.id}/client_ad_accounts` +
            `?fields=id,name,account_status,currency,timezone_name,business&limit=50&access_token=${accessToken}`
        ),
      ]);
      const [ownedData, clientData] = await Promise.all([ownedRes.json(), clientRes.json()]);
      const owned = (ownedData.data ?? []) as MetaAccount[];
      const client = (clientData.data ?? []) as MetaAccount[];
      return [...owned, ...client].map((acct) => ({
        ...acct,
        business: acct.business ?? { id: b.id, name: b.name ?? "Business" },
      }));
    })
  );
  const businessAccounts = businessAccountArrays
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const adAccounts = mergeAccounts(primaryAdAccounts, businessAccounts);

  // ── 4. For each page, fetch its associated Pixel(s) ──────────────────────
  // Pixels are tied to the ad account, not the page — fetch from ad accounts
  // We batch-fetch pixels for all active ad accounts
  const pixelPromises = adAccounts
    .filter((a) => a.account_status === 1)
    .slice(0, 10) // cap at 10 accounts to avoid rate limits
    .map(async (account) => {
      const pixelRes = await fetch(
        `https://graph.facebook.com/${META_VERSION}/${account.id}/adspixels` +
          `?fields=id,name,creation_time,last_fired_time` +
          `&access_token=${accessToken}`
      );
      const pixelData = await pixelRes.json();
      return (pixelData.data ?? []).map((p: object) => ({
        ...p,
        ad_account_id: account.id,
      }));
    });

  const pixelArrays = await Promise.allSettled(pixelPromises);
  const pixels = pixelArrays
    .filter(
      (r): r is PromiseFulfilledResult<object[]> => r.status === "fulfilled"
    )
    .flatMap((r) => r.value);

  // ── 5. Redirect with all data — user picks in the UI ─────────────────────
  // NOTE: We intentionally do NOT auto-select an account here.
  // The frontend will show a picker modal when fb_pending_selection=1.
  const payload = JSON.stringify({
    accessToken,
    adAccounts,
    pages,
    pixels,
  });

  const params = new URLSearchParams({
    fb_pending_selection: "1",
    fb_data: encodeURIComponent(payload),
  });

  // Store full payload in a short-lived cookie (picker reads it, then clears it)
  const response = NextResponse.redirect(`${origin}/dashboard/chat?${params}`);
  response.cookies.set("meta_ads_pending", payload, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10, // 10 minutes — just long enough to pick an account
  });

  return response;
}