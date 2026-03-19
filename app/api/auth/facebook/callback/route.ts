// app/api/auth/facebook/callback/route.ts
// (or pages/api/auth/facebook/callback.ts for Pages Router)
//
// This route receives the OAuth `code` from Facebook, exchanges it for an
// access token, then redirects back to the app with the token in the URL.
//
// Required env vars (.env.local):
//   NEXT_PUBLIC_FACEBOOK_APP_ID=<your app id>
//   FACEBOOK_APP_SECRET=<your app secret>   ← server-only, never exposed to client

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const FB_API_VERSION = "v25.0";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  // User denied the permission dialog
  if (error || !code) {
    const reason = errorDescription ?? error ?? "access_denied";
    return NextResponse.redirect(`${origin}/?fb_error=${encodeURIComponent(reason)}`);
  }

  const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  if (!appId || !appSecret) {
    return NextResponse.redirect(
      `${origin}/?fb_error=${encodeURIComponent("Server misconfiguration: FACEBOOK_APP_SECRET not set.")}`
    );
  }

  const redirectUri = `${origin}/api/auth/facebook/callback`;

  try {
    // Exchange the code for a short-lived user access token
    const tokenRes = await fetch(
      `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token` +
        `?client_id=${appId}` +
        `&client_secret=${appSecret}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&code=${encodeURIComponent(code)}`
    );

    const tokenData = await tokenRes.json();

    if (tokenData.error || !tokenData.access_token) {
      const msg = tokenData.error?.message ?? "Token exchange failed";
      return NextResponse.redirect(`${origin}/?fb_error=${encodeURIComponent(msg)}`);
    }

    const shortLivedToken: string = tokenData.access_token;

    // Exchange for a long-lived token (valid ~60 days)
    const longLivedRes = await fetch(
      `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token` +
        `?grant_type=fb_exchange_token` +
        `&client_id=${appId}` +
        `&client_secret=${appSecret}` +
        `&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`
    );

    const longLivedData = await longLivedRes.json();

    // If long-lived exchange fails, fall back to short-lived token
    const finalToken: string = longLivedData.access_token ?? shortLivedToken;

    // Redirect back to the app — the client-side code will pick up fb_token from the URL
    return NextResponse.redirect(`${origin}/?fb_token=${encodeURIComponent(finalToken)}`);
  } catch (err) {
    return NextResponse.redirect(
      `${origin}/?fb_error=${encodeURIComponent(String(err))}`
    );
  }
}