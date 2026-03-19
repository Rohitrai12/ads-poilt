import { NextRequest, NextResponse } from "next/server"

import { verifyAuthToken } from "@/lib/auth"
import { ensureTeamSchema } from "@/lib/teams"
import pool from "@/lib/mysql"

export const runtime = "nodejs"

const validRoles = new Set(["OWNER", "ADMIN", "MEMBER"])

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

async function ownerCount(teamId: string) {
  const [rows] = await pool.execute(
    "SELECT COUNT(*) AS count FROM memberships WHERE team_id = ? AND role = 'OWNER'",
    [teamId]
  )
  const row = (rows as Array<{ count: number }>)[0]
  return row?.count ?? 0
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; memberId: string }> }
) {
  const user = getUser(request)
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  }

  const { teamId, memberId } = await params
  const memberUserId = Number(memberId)

  if (!Number.isFinite(memberUserId)) {
    return NextResponse.json({ message: "Invalid member id" }, { status: 400 })
  }

  let body: { role?: string }
  try {
    body = (await request.json()) as { role?: string }
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 })
  }

  const roleValue = body.role?.toUpperCase()
  if (!roleValue || !validRoles.has(roleValue)) {
    return NextResponse.json({ message: "Invalid role" }, { status: 400 })
  }

  await ensureTeamSchema()

  const requesterRole = await getRole(teamId, user.id)
  if (!requesterRole || (requesterRole !== "OWNER" && requesterRole !== "ADMIN")) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 })
  }

  if (roleValue === "OWNER" && requesterRole !== "OWNER") {
    return NextResponse.json({ message: "Only owners can promote to owner" }, { status: 403 })
  }

  const [memberRows] = await pool.execute(
    "SELECT role FROM memberships WHERE team_id = ? AND user_id = ? LIMIT 1",
    [teamId, memberUserId]
  )
  const member = (memberRows as Array<{ role: string }>)[0]
  if (!member) {
    return NextResponse.json({ message: "Member not found" }, { status: 404 })
  }

  if (member.role === "OWNER" && roleValue !== "OWNER") {
    const owners = await ownerCount(teamId)
    if (owners <= 1) {
      return NextResponse.json({ message: "Team must have at least one owner" }, { status: 400 })
    }
  }

  await pool.execute(
    "UPDATE memberships SET role = ? WHERE team_id = ? AND user_id = ?",
    [roleValue, teamId, memberUserId]
  )

  return NextResponse.json({ ok: true }, { status: 200 })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; memberId: string }> }
) {
  const user = getUser(request)
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  }

  const { teamId, memberId } = await params
  const memberUserId = Number(memberId)

  if (!Number.isFinite(memberUserId)) {
    return NextResponse.json({ message: "Invalid member id" }, { status: 400 })
  }

  await ensureTeamSchema()

  const requesterRole = await getRole(teamId, user.id)
  const isSelf = user.id === memberUserId

  if (!isSelf && (!requesterRole || (requesterRole !== "OWNER" && requesterRole !== "ADMIN"))) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 })
  }

  const [memberRows] = await pool.execute(
    "SELECT role FROM memberships WHERE team_id = ? AND user_id = ? LIMIT 1",
    [teamId, memberUserId]
  )
  const member = (memberRows as Array<{ role: string }>)[0]
  if (!member) {
    return NextResponse.json({ message: "Member not found" }, { status: 404 })
  }

  if (member.role === "OWNER") {
    const owners = await ownerCount(teamId)
    if (owners <= 1) {
      return NextResponse.json({ message: "Team must have at least one owner" }, { status: 400 })
    }
  }

  await pool.execute(
    "DELETE FROM memberships WHERE team_id = ? AND user_id = ?",
    [teamId, memberUserId]
  )

  return NextResponse.json({ ok: true }, { status: 200 })
}
