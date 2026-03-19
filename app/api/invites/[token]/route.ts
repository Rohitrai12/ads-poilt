import { NextRequest, NextResponse } from "next/server"

import { ensureTeamSchema } from "@/lib/teams"
import pool from "@/lib/mysql"

export const runtime = "nodejs"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  await ensureTeamSchema()

  const [rows] = await pool.execute(
    `
      SELECT i.id, i.email, i.role, i.expires_at AS expiresAt, t.name AS teamName
      FROM invites i
      INNER JOIN teams t ON t.id = i.team_id
      WHERE i.token = ? AND i.accepted_at IS NULL AND i.expires_at > NOW()
      LIMIT 1
    `,
    [token]
  )

  const invite = (rows as Array<{ id: string; email: string; role: string; expiresAt: string; teamName: string }>)[0]
  if (!invite) {
    return NextResponse.json({ message: "Invite not found or expired" }, { status: 404 })
  }

  return NextResponse.json({ invite }, { status: 200 })
}
