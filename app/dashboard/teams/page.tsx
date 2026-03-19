"use client"

import React from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type Team = {
  id: string
  name: string
  ownerId: number
  createdAt: string
  role: "OWNER" | "ADMIN" | "MEMBER"
}

type Member = {
  id: number
  email: string
  name?: string
  role: "OWNER" | "ADMIN" | "MEMBER"
  joinedAt: string
}

type Invite = {
  id: string
  email: string
  role: "OWNER" | "ADMIN" | "MEMBER"
  token: string
  expiresAt: string
  createdAt?: string
}

const roleOptions = ["OWNER", "ADMIN", "MEMBER"] as const

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const message = (data as { message?: string }).message ?? "Request failed"
    throw new Error(message)
  }
  return (await res.json()) as T
}

export default function TeamsPage() {
  const [teams, setTeams] = React.useState<Team[]>([])
  const [selectedTeamId, setSelectedTeamId] = React.useState<string | null>(null)
  const [members, setMembers] = React.useState<Member[]>([])
  const [invites, setInvites] = React.useState<Invite[]>([])
  const [loadingTeams, setLoadingTeams] = React.useState(false)
  const [loadingDetails, setLoadingDetails] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [newTeamName, setNewTeamName] = React.useState("")
  const [renameTeamName, setRenameTeamName] = React.useState("")
  const [inviteEmail, setInviteEmail] = React.useState("")
  const [inviteRole, setInviteRole] = React.useState<"OWNER" | "ADMIN" | "MEMBER">("MEMBER")

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null
  const canManageMembers = selectedTeam?.role === "OWNER" || selectedTeam?.role === "ADMIN"
  const canDeleteTeam = selectedTeam?.role === "OWNER"

  const loadTeams = React.useCallback(async () => {
    setLoadingTeams(true)
    setError(null)
    try {
      const data = await fetchJson<{ teams: Team[] }>("/api/teams")
      setTeams(data.teams)
      if (data.teams.length && !selectedTeamId) {
        setSelectedTeamId(data.teams[0].id)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoadingTeams(false)
    }
  }, [selectedTeamId])

  const loadDetails = React.useCallback(async (teamId: string) => {
    setLoadingDetails(true)
    setError(null)
    try {
      const [membersData, invitesData] = await Promise.all([
        fetchJson<{ members: Member[] }>(`/api/teams/${teamId}/members`),
        fetchJson<{ invites: Invite[] }>(`/api/teams/${teamId}/invites`),
      ])
      setMembers(membersData.members)
      setInvites(invitesData.invites)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoadingDetails(false)
    }
  }, [])

  React.useEffect(() => {
    loadTeams()
  }, [loadTeams])

  React.useEffect(() => {
    if (selectedTeamId) {
      loadDetails(selectedTeamId)
    } else {
      setMembers([])
      setInvites([])
    }
  }, [selectedTeamId, loadDetails])

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return
    setError(null)
    try {
      await fetchJson("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTeamName }),
      })
      setNewTeamName("")
      await loadTeams()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleRenameTeam = async () => {
    if (!selectedTeam || !renameTeamName.trim()) return
    setError(null)
    try {
      await fetchJson(`/api/teams/${selectedTeam.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameTeamName }),
      })
      setRenameTeamName("")
      await loadTeams()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleDeleteTeam = async () => {
    if (!selectedTeam) return
    const confirmDelete = window.confirm(`Delete team \"${selectedTeam.name}\"? This cannot be undone.`)
    if (!confirmDelete) return
    setError(null)
    try {
      await fetchJson(`/api/teams/${selectedTeam.id}`, { method: "DELETE" })
      setSelectedTeamId(null)
      await loadTeams()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleInvite = async () => {
    if (!selectedTeam || !inviteEmail.trim()) return
    setError(null)
    try {
      await fetchJson(`/api/teams/${selectedTeam.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })
      setInviteEmail("")
      await loadDetails(selectedTeam.id)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleRoleChange = async (memberId: number, role: Member["role"]) => {
    if (!selectedTeam) return
    setError(null)
    try {
      await fetchJson(`/api/teams/${selectedTeam.id}/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      })
      await loadDetails(selectedTeam.id)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleRemoveMember = async (memberId: number) => {
    if (!selectedTeam) return
    setError(null)
    try {
      await fetchJson(`/api/teams/${selectedTeam.id}/members/${memberId}`, {
        method: "DELETE",
      })
      await loadDetails(selectedTeam.id)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleRevokeInvite = async (inviteId: string) => {
    if (!selectedTeam) return
    setError(null)
    try {
      await fetchJson(`/api/teams/${selectedTeam.id}/invites/${inviteId}`, {
        method: "DELETE",
      })
      await loadDetails(selectedTeam.id)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="@container/main flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
        <p className="text-sm text-muted-foreground">
          Create teams, manage members, and invite new collaborators.
        </p>
      </div>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Your Teams</div>
              <div className="text-xs text-muted-foreground">Pick a team to manage</div>
            </div>
            {loadingTeams ? <span className="text-xs text-muted-foreground">Loading</span> : null}
          </div>

          <div className="flex flex-col gap-2">
            {teams.length === 0 ? (
              <div className="text-sm text-muted-foreground">No teams yet.</div>
            ) : null}
            {teams.map((team) => (
              <button
                key={team.id}
                onClick={() => setSelectedTeamId(team.id)}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                  selectedTeamId === team.id
                    ? "border-primary/50 bg-primary/10"
                    : "border-transparent hover:border-muted-foreground/30 hover:bg-muted/40"
                }`}
              >
                <span className="truncate">{team.name}</span>
                <Badge variant={team.role === "OWNER" ? "default" : "secondary"}>{team.role}</Badge>
              </button>
            ))}
          </div>

          <div className="border-t pt-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Create Team
            </div>
            <div className="mt-2 flex flex-col gap-2">
              <Input
                placeholder="Team name"
                value={newTeamName}
                onChange={(event) => setNewTeamName(event.target.value)}
              />
              <Button onClick={handleCreateTeam} disabled={!newTeamName.trim()}>
                Create team
              </Button>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-4">
          {!selectedTeam ? (
            <div className="text-sm text-muted-foreground">Select a team to view details.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <div className="text-lg font-semibold">{selectedTeam.name}</div>
                  <div className="text-xs text-muted-foreground">Team ID: {selectedTeam.id}</div>
                </div>
                <div className="ml-auto flex gap-2">
                  <Button variant="secondary" onClick={() => loadDetails(selectedTeam.id)} disabled={loadingDetails}>
                    Refresh
                  </Button>
                  <Button variant="destructive" onClick={handleDeleteTeam} disabled={!canDeleteTeam}>
                    Delete team
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <Input
                  placeholder="Rename team"
                  value={renameTeamName}
                  onChange={(event) => setRenameTeamName(event.target.value)}
                />
                <Button onClick={handleRenameTeam} disabled={!renameTeamName.trim() || !canManageMembers}>
                  Rename
                </Button>
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Members</div>
                    <div className="text-xs text-muted-foreground">Manage access and roles</div>
                  </div>
                  {loadingDetails ? <span className="text-xs text-muted-foreground">Loading</span> : null}
                </div>

                <div className="mt-3 flex flex-col gap-2">
                  {members.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No members yet.</div>
                  ) : null}
                  {members.map((member) => (
                    <div key={member.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
                      <div className="min-w-[180px] flex-1">
                        <div className="text-sm font-medium">{member.name ?? "Unnamed user"}</div>
                        <div className="text-xs text-muted-foreground">{member.email}</div>
                      </div>
                      <select
                        className="h-8 rounded-md border bg-transparent px-2 text-sm"
                        value={member.role}
                        disabled={!canManageMembers}
                        onChange={(event) => handleRoleChange(member.id, event.target.value as Member["role"])}
                      >
                        {roleOptions.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveMember(member.id)}
                        disabled={!canManageMembers}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="text-sm font-medium">Invite members</div>
                <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_140px_auto]">
                  <Input
                    placeholder="Email address"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    disabled={!canManageMembers}
                  />
                  <select
                    className="h-8 rounded-md border bg-transparent px-2 text-sm"
                    value={inviteRole}
                    disabled={!canManageMembers}
                    onChange={(event) => setInviteRole(event.target.value as Member["role"])}
                  >
                    {roleOptions.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <Button onClick={handleInvite} disabled={!inviteEmail.trim() || !canManageMembers}>
                    Invite
                  </Button>
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="text-sm font-medium">Pending invites</div>
                <div className="mt-2 flex flex-col gap-2">
                  {invites.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No pending invites.</div>
                  ) : null}
                  {invites.map((invite) => (
                    <div key={invite.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
                      <div className="min-w-[180px] flex-1">
                        <div className="text-sm font-medium">{invite.email}</div>
                        <div className="text-xs text-muted-foreground">Role: {invite.role}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">Token: {invite.token}</div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevokeInvite(invite.id)}
                        disabled={!canManageMembers}
                      >
                        Revoke
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
