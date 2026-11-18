"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import {
  Bot, Building2, CalendarDays, Check, ChevronsUpDown, FolderOpen, LogOut, PanelLeftClose, PanelLeftOpen,
  Send, Settings, UsersRound, type LucideIcon,
} from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import { BrandMark } from "@/components/brand-mark";
import { SIDEBAR_COOKIE, SIDEBAR_COOKIE_MAX_AGE } from "./sidebar-state";
import styles from "./dashboard.module.css";

export type DashboardUser = { name: string | null; email: string };
export type HeadquartersOption = { id: string; name: string; theme: string };

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "City", icon: Building2 },
  { href: "/dashboard/artifacts", label: "Artifacts", icon: FolderOpen },
  { href: "/dashboard/posted", label: "Post", icon: Send },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/dashboard/agents", label: "Agents", icon: Bot },
  { href: "/dashboard/accounts", label: "Accounts", icon: UsersRound },
];
const SETTINGS_HREF = "/dashboard/settings";

// Swatch colors for the headquarters switcher, matching the HQ building themes.
const THEME_SWATCH: Record<string, string> = {
  lavender: "#a78bfa", mint: "#5eead4", peach: "#fdba74", sky: "#7dd3fc",
  rose: "#fda4af", white: "#e2e8f0", gold: "#fcd34d",
};

const MOBILE_QUERY = "(max-width: 767px)";

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function displayName(user: DashboardUser) {
  return user.name?.trim() || user.email.split("@")[0];
}

function initials(user: DashboardUser) {
  const parts = displayName(user).split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function Avatar({ user, size = 32 }: { user: DashboardUser; size?: number }) {
  return (
    <span className={styles.avatar} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {initials(user)}
    </span>
  );
}

/** Closes a popover on outside pointer-down or Escape (returning focus to its trigger). */
function useDismiss(open: boolean, close: () => void, root: RefObject<HTMLElement | null>, trigger: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, root, trigger]);
}

function HeadquartersSwitcher({ options, activeId, collapsed }: { options: HeadquartersOption[]; activeId: string; collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, rootRef, triggerRef);

  const active = options.find((option) => option.id === activeId) ?? options[0];
  if (!active) return null;

  return (
    <div className={styles.switcher} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.switcherTrigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Headquarters: ${active.name}. Switch headquarters`}
        title={collapsed ? active.name : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.swatch} style={{ background: THEME_SWATCH[active.theme] ?? THEME_SWATCH.lavender }} aria-hidden="true">
          {active.name.charAt(0).toUpperCase()}
        </span>
        <span className={styles.switcherText}>
          <span className={styles.switcherLabel}>Headquarters</span>
          <span className={styles.switcherName}>{active.name}</span>
        </span>
        <ChevronsUpDown className={styles.switcherChevron} size={16} aria-hidden="true" />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label="Headquarters" className={styles.menu} data-placement={collapsed ? "side" : "below"}>
          <p className={styles.menuHeading}>Your headquarters</p>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === active.id}
              className={styles.menuItem}
              // Each user owns one headquarters today; selecting just closes the menu.
              onClick={close}
            >
              <span className={styles.swatchSmall} style={{ background: THEME_SWATCH[option.theme] ?? THEME_SWATCH.lavender }} aria-hidden="true" />
              <span className={styles.menuItemText}>{option.name}</span>
              {option.id === active.id && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileMenu({ user }: { user: DashboardUser }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, rootRef, triggerRef);

  return (
    <div className={styles.profile} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.profileTrigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${displayName(user)}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar user={user} size={34} />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label="Account" className={`${styles.menu} ${styles.profileMenu}`}>
          <div className={styles.profileSummary}>
            <span className={styles.userName}>{displayName(user)}</span>
            <span className={styles.userEmail}>{user.email}</span>
          </div>
          <Link href={SETTINGS_HREF} role="menuitem" className={styles.menuItem} onClick={close}>
            <Settings size={16} aria-hidden="true" />
            <span className={styles.menuItemText}>Settings</span>
          </Link>
          <form action={signOut} className={styles.menuForm}>
            <button type="submit" role="menuitem" className={`${styles.menuItem} ${styles.menuItemDanger}`}>
              <LogOut size={16} aria-hidden="true" />
              <span className={styles.menuItemText}>Sign out</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export function DashboardShell({
  user, headquarters, activeHeadquartersId, defaultCollapsed, children,
}: {
  user: DashboardUser;
  headquarters: HeadquartersOption[];
  activeHeadquartersId: string;
  defaultCollapsed: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // Escape closes the mobile drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  function toggleSidebar() {
    // Small screens use an overlay drawer; larger screens collapse to icons and remember it.
    if (window.matchMedia(MOBILE_QUERY).matches) {
      setMobileOpen((value) => !value);
      return;
    }
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`;
  }

  const settingsActive = isActive(pathname, SETTINGS_HREF);

  return (
    <div className={styles.shell} data-collapsed={collapsed} data-mobile-open={mobileOpen}>
      <aside id="dashboard-sidebar" className={styles.sidebar} aria-label="Sidebar">
        <div className={styles.brandRow}>
          <Link href="/dashboard" className={styles.brand} aria-label="Creator City home" onClick={closeMobile}>
            <BrandMark size={28} />
            <span className={styles.brandName}>Creator City</span>
          </Link>
        </div>

        <HeadquartersSwitcher options={headquarters} activeId={activeHeadquartersId} collapsed={collapsed} />

        <nav className={styles.nav} aria-label="Dashboard">
          <ul className={styles.navList}>
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className={styles.navLink}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? label : undefined}
                    onClick={closeMobile}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className={styles.navLabel}>{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className={styles.footer}>
          <Link
            href={SETTINGS_HREF}
            className={styles.navLink}
            aria-current={settingsActive ? "page" : undefined}
            title={collapsed ? "Settings" : undefined}
            onClick={closeMobile}
          >
            <Settings size={18} aria-hidden="true" />
            <span className={styles.navLabel}>Settings</span>
          </Link>
          <div className={styles.userCard} title={collapsed ? `${displayName(user)} · ${user.email}` : undefined}>
            <Avatar user={user} />
            <span className={styles.userText}>
              <span className={styles.userName}>{displayName(user)}</span>
              <span className={styles.userEmail}>{user.email}</span>
            </span>
          </div>
        </div>
      </aside>

      {mobileOpen && <div className={styles.backdrop} onClick={closeMobile} aria-hidden="true" />}

      <div className={styles.main}>
        <header className={styles.header}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={toggleSidebar}
            aria-controls="dashboard-sidebar"
            aria-label="Toggle sidebar"
            title="Toggle sidebar"
          >
            {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          </button>
          <ProfileMenu user={user} />
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
