import { NextRequest, NextResponse } from "next/server"

import { verifyAuthToken } from "@/lib/auth"
import { ensureTeamSchema } from "@/lib/teams"
import pool from "@/lib/mysql"

export const runtime = "nodejs"

function getUser(request: NextRequest) {
  const token = request.cookies.get("auth_token")?.value
  if (!token) return null
  return verifyAuthToken(token)
}

async function getRole(teamId: string, userId: number) {
  const [rows] = await pool.execute(
    "SELECT role FROM memberships WHERE team_id = ? AND user_id = ? LIMIT 1",
    [teamId, userId]
  )
  const row = (rows as Array<{ role: string }>)[0]
  return row?.role ?? null
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; inviteId: string }> }
) {
  const user = getUser(request)
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  }

  const { teamId, inviteId } = await params

  await ensureTeamSchema()

  const role = await getRole(teamId, user.id)
  if (!role || (role !== "OWNER" && role !== "ADMIN")) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 })
  }

  const [result] = await pool.execute(
    "DELETE FROM invites WHERE id = ? AND team_id = ?",
    [inviteId, teamId]
  )

  const affected = (result as { affectedRows?: number }).affectedRows ?? 0
  if (!affected) {
    return NextResponse.json({ message: "Invite not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
