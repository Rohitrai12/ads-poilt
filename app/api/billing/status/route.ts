import { NextRequest, NextResponse } from "next/server"

import { getBillingSnapshotByUserId, toBillingView } from "@/lib/billing"
import { getAuthUserFromRequest } from "@/lib/session"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const user = getAuthUserFromRequest(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const snapshot = await getBillingSnapshotByUserId(user.id)
  return NextResponse.json({ billing: toBillingView(snapshot) }, { status: 200 })
}

