import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const GOOGLE_ADS_DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Handle user denial
  if (error) {
    return NextResponse.redirect(`${origin}/?g_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/?g_error=no_code`);
  }

  try {
    // 1. Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${origin}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      console.error("Google token exchange error:", tokenData);
      return NextResponse.redirect(`${origin}/?g_error=${encodeURIComponent(tokenData.error_description ?? tokenData.error)}`);
    }

    const accessToken: string = tokenData.access_token;
    const refreshToken: string | undefined = tokenData.refresh_token;

    // 2. Fetch accessible Google Ads customer accounts
    const accountsRes = await fetch(
      "https://googleads.googleapis.com/v18/customers:listAccessibleCustomers",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": GOOGLE_ADS_DEVELOPER_TOKEN,
        },
      }
    );

    const accountsData = await accountsRes.json();

    if (accountsData.error) {
      console.error("Google Ads accounts error:", accountsData);
      // Still redirect with token even if accounts fetch fails
      return NextResponse.redirect(
        `${origin}/?g_token=${encodeURIComponent(accessToken)}&g_accounts=${encodeURIComponent("[]")}`
      );
    }

    // resourceNames look like: "customers/1234567890"
    const resourceNames: string[] = accountsData.resourceNames ?? [];

    // 3. Fetch details for each account (name, currency, manager flag)
    const accountDetails = await Promise.allSettled(
      resourceNames.slice(0, 10).map(async (rn) => {
        const customerId = rn.replace("customers/", "");
        const res = await fetch(
          `https://googleads.googleapis.com/v18/customers/${customerId}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "developer-token": GOOGLE_ADS_DEVELOPER_TOKEN,
            },
          }
        );
        const data = await res.json();
        return {
          id: customerId,
          name: data.descriptiveName ?? `Account ${customerId}`,
          currency_code: data.currencyCode ?? "USD",
          is_manager: data.manager ?? false,
        };
      })
    );

    const accounts = accountDetails
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<{
        id: string;
        name: string;
        currency_code: string;
        is_manager: boolean;
      }>).value);

    // 4. Redirect back to app with token + accounts
    const redirectUrl = new URL("/", origin);
    redirectUrl.searchParams.set("g_token", accessToken);
    redirectUrl.searchParams.set("g_accounts", JSON.stringify(accounts));
    if (refreshToken) {
      redirectUrl.searchParams.set("g_refresh_token", refreshToken);
    }

    return NextResponse.redirect(redirectUrl.toString());
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    return NextResponse.redirect(
      `${origin}/?g_error=${encodeURIComponent("server_error: " + String(err))}`
    );
  }
}