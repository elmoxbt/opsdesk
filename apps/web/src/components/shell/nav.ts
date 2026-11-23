import type { Feature } from "@opsdesk/config";
import type { Role } from "@opsdesk/shared";
import {
  BarChart3,
  Briefcase,
  CalendarRange,
  Code2,
  FileText,
  LayoutDashboard,
  Package,
  Receipt,
  type LucideIcon,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: readonly Role[];
  /** Optional module this page belongs to; hidden when the client has it switched off. */
  feature?: Feature;
}

const ALL: readonly Role[] = ["OWNER", "DISPATCHER", "TECHNICIAN"];
const MANAGERS: readonly Role[] = ["OWNER", "DISPATCHER"];

export const NAV: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ALL },
  { href: "/dispatch", label: "Dispatch", icon: CalendarRange, roles: MANAGERS },
  { href: "/jobs", label: "Jobs", icon: Briefcase, roles: ALL },
  { href: "/quotes", label: "Quotes", icon: FileText, roles: MANAGERS },
  { href: "/invoices", label: "Invoices", icon: Receipt, roles: MANAGERS },
  { href: "/customers", label: "Customers", icon: UserRound, roles: MANAGERS },
  { href: "/services", label: "Services", icon: Wrench, roles: MANAGERS },
  { href: "/inventory", label: "Inventory", icon: Package, roles: MANAGERS, feature: "inventory" },
  { href: "/team", label: "Team", icon: Users, roles: MANAGERS },
  { href: "/analytics", label: "Analytics", icon: BarChart3, roles: ["OWNER"], feature: "analytics" },
  { href: "/settings/developers", label: "Developers", icon: Code2, roles: ["OWNER"], feature: "publicApi" },
];
