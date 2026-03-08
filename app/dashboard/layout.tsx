import React from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { verifyAuthToken } from "@/lib/auth"

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const cookieStore = await cookies()
  const token = cookieStore.get("auth_token")?.value
  const user = token ? verifyAuthToken(token) : null

  if (!user) {
    redirect("/login")
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <div className="flex flex-1 flex-col">
          <header className="bg-background/60 supports-[backdrop-filter]:bg-background/40 border-b sticky top-0 z-10 flex h-12 items-center gap-2 px-4 backdrop-blur md:px-6">
            <SidebarTrigger />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">AdPilot AI</div>
            </div>
          </header>
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

