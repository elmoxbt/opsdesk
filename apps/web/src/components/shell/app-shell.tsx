"use client";

import type { AuthUser } from "@opsdesk/shared";
import { LogOut, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { useClientConfig } from "@opsdesk/ui/client-config";
import { Logo } from "@opsdesk/ui/logo";
import { RealtimeProvider } from "@/components/realtime-provider";
import { ThemeToggle } from "@opsdesk/ui/theme-toggle";
import { Avatar } from "@opsdesk/ui/avatar";
import { Button } from "@opsdesk/ui/button";
import { Sheet } from "@opsdesk/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@opsdesk/ui/dropdown-menu";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { useLogout, useMe } from "@/lib/api/hooks";
import { cn } from "@opsdesk/ui/utils";
import { SessionContext } from "@/hooks/use-session";
import { NAV } from "./nav";

/**
 * Client-side auth gate: the refresh cookie is scoped to /api/auth, so the
 * Next server can't see it on page requests. The shell asks /auth/me (which
 * transparently refreshes) and redirects to /login only if that truly fails.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [unauthenticated, router, pathname]);

  if (!me.data) return <ShellSkeleton />;
  return (
    <SessionContext.Provider value={me.data}>
      <RealtimeProvider user={me.data}>
        <Shell user={me.data}>{children}</Shell>
      </RealtimeProvider>
    </SessionContext.Provider>
  );
}

function Shell({ user, children }: { user: AuthUser; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-card/50 lg:flex">
        <div className="flex h-16 items-center px-5">
          <Logo />
        </div>
        <SideNav user={user} />
        <div className="mt-auto border-t p-4">
          <p className="truncate text-xs font-medium text-muted-foreground">{user.organization.name}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu aria-hidden />
          </Button>
          <span className="lg:hidden">
            <Logo withText={false} />
          </span>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            <UserMenu user={user} />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>

      <Sheet
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        title={user.organization.name}
        side="left"
        className="max-w-72"
      >
        <div className="-mx-3">
          <SideNav user={user} />
        </div>
        <div className="mt-6">
          <ThemeToggle />
        </div>
      </Sheet>
    </div>
  );
}

function SideNav({ user }: { user: AuthUser }) {
  const pathname = usePathname();
  const { features } = useClientConfig();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
      {NAV.filter((i) => i.roles.includes(user.role) && (!i.feature || features[i.feature])).map(
        ({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground",
                active && "bg-accent text-foreground",
              )}
            >
              <Icon className={cn("size-4", active && "text-primary")} aria-hidden />
              {label}
            </Link>
          );
        },
      )}
    </nav>
  );
}

function UserMenu({ user }: { user: AuthUser }) {
  const logout = useLogout();
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-accent"
          aria-label="Account menu"
        >
          <Avatar name={user.name} size="sm" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          <span className="block text-sm font-medium text-foreground">{user.name}</span>
          <span className="block truncate font-normal">{user.email}</span>
          <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] capitalize">
            {user.role.toLowerCase()}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            logout.mutate(undefined, {
              onSettled: () => {
                toast.success("Signed out");
                router.replace("/login");
              },
            })
          }
        >
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ShellSkeleton() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]" aria-busy="true" aria-label="Loading">
      <div className="hidden space-y-3 border-r p-5 lg:block">
        <Skeleton className="h-7 w-28" />
        <div className="space-y-2 pt-6">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
