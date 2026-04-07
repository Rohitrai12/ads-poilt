// app/api/auth/me/route.ts
import { NextRequest, NextResponse } from "next/server"

import { verifyAuthToken } from "@/lib/auth"
import { getBillingSnapshotByUserId, toBillingView } from "@/lib/billing"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const token = request.cookies.get("auth_token")?.value

  if (!token) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  const user = verifyAuthToken(token)

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  const snapshot = await getBillingSnapshotByUserId(user.id)
  return NextResponse.json({ user, billing: toBillingView(snapshot) }, { status: 200 })
}