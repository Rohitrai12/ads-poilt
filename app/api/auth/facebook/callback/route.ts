import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const META_VERSION = "v25.0";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(`${origin}/dashboard/chat?fb_error=${error ?? "cancelled"}`);
  }

  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  const redirectUri = `${origin}/api/auth/facebook/callback`;

  if (!appId || !appSecret) {
    return NextResponse.redirect(`${origin}/dashboard/chat?fb_error=missing_env`);
  }

  // Exchange code for short-lived token
  const tokenRes = await fetch(
    `https://graph.facebook.com/${META_VERSION}/oauth/access_token?` +
      new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code })
  );
  const tokenData = await tokenRes.json();

  if (tokenData.error || !tokenData.access_token) {
    const msg = tokenData.error?.message ?? "token_exchange_failed";
    return NextResponse.redirect(`${origin}/dashboard/chat?fb_error=${encodeURIComponent(msg)}`);
  }

  const shortToken = tokenData.access_token;

  // Exchange for long-lived token (60 days)
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

  // Fetch ad accounts the user has access to
  const acctRes = await fetch(
    `https://graph.facebook.com/${META_VERSION}/me/adaccounts?fields=id,name,account_status,currency,timezone_name&access_token=${accessToken}`
  );
  const acctData = await acctRes.json();
  const accounts = acctData.data ?? [];

  // Pass token + accounts back to the app via URL params
  // and also persist in a cookie so we don't ask again next time.
  const params = new URLSearchParams({
    fb_token: accessToken,
    fb_accounts: JSON.stringify(accounts),
  });

  const response = NextResponse.redirect(`${origin}/dashboard/chat?${params}`);
  response.cookies.set("meta_ads_auth", JSON.stringify({ accessToken, accounts }), {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return response;
}