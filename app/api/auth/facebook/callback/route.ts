import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const META_VERSION = "v25.0";

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

  // ── 3. Fetch ALL resources in parallel ───────────────────────────────────
  const [acctRes, pagesRes] = await Promise.all([
    fetch(
      `https://graph.facebook.com/${META_VERSION}/me/adaccounts` +
        `?fields=id,name,account_status,currency,timezone_name,business` +
        `&limit=50&access_token=${accessToken}`
    ),
    fetch(
      `https://graph.facebook.com/${META_VERSION}/me/accounts` +
        `?fields=id,name,category,picture` +
        `&limit=50&access_token=${accessToken}`
    ),
  ]);

  const [acctData, pagesData] = await Promise.all([
    acctRes.json(),
    pagesRes.json(),
  ]);

  const adAccounts = acctData.data ?? [];
  const pages = pagesData.data ?? [];

  // ── 4. Fetch pixels for active ad accounts ────────────────────────────────
  const pixelPromises = adAccounts
    .filter((a: { account_status: number }) => a.account_status === 1)
    .slice(0, 10)
    .map(async (account: { id: string }) => {
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

  // ── 5. Redirect — data stored in cookie only (fixes Safari URL-length bug) ─
  // Safari fails to redirect when the URL exceeds ~8KB.
  // We dropped fb_data from the URL entirely and rely solely on the cookie.
  const payload = JSON.stringify({
    accessToken,
    adAccounts,
    pages,
    pixels,
  });

  const params = new URLSearchParams({
    fb_pending_selection: "1",
    // ❌ fb_data removed — was causing Safari "Cannot open page" on redirect
  });

  const response = NextResponse.redirect(`${origin}/dashboard/chat?${params}`);
  response.cookies.set("meta_ads_pending", payload, {
    httpOnly: false, // must be false so the picker can read it via JS
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10, // 10 minutes
  });

  return response;
}