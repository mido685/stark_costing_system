import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Settings2, Package, ShoppingCart,
  Factory, ClipboardList, DollarSign, TrendingUp,
  ShieldCheck, FileText, Menu, LogOut, ChevronRight,
  Sun, Moon, Languages, Users, ChevronDown,
} from "lucide-react";
import { useTheme }    from "@/contexts/ThemeContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth }     from "@/contexts/AuthContext";
import PeriodStatusControl from "@/components/PeriodStatusControl";
import { assetUrl } from "@/lib/api";

// ─── Constants ────────────────────────────────────────────────────────────────

// Compile-time constant — defined at module level so it is never re-evaluated
const NAV_ITEMS = [
  { href: "/",                   labelKey: "nav.dashboard",      icon: LayoutDashboard, color: "text-violet-500"  },
  { href: "/masters",            labelKey: "nav.masters",        icon: Settings2,       color: "text-slate-500"   },
  { href: "/inventory-controls", labelKey: "nav.inventory",      icon: Package,         color: "text-blue-500"    },
  { href: "/procurement",        labelKey: "nav.procurement",    icon: ShoppingCart,    color: "text-orange-500"  },
  { href: "/production",         labelKey: "nav.production",     icon: Factory,         color: "text-red-500"     },
  { href: "/recipes",            labelKey: "nav.recipes",        icon: ClipboardList,   color: "text-green-500"   },
  { href: "/sales",              labelKey: "nav.sales",          icon: DollarSign,      color: "text-emerald-500" },
  { href: "/finance",            labelKey: "nav.finance",        icon: TrendingUp,      color: "text-cyan-500"    },
  { href: "/governance",         labelKey: "nav.governance",     icon: ShieldCheck,     color: "text-yellow-500"  },
  { href: "/report",             labelKey: "nav.report",         icon: FileText,        color: "text-pink-500"    },
  { href: "/user-management",    labelKey: "nav.userManagement", icon: Users,           color: "text-indigo-500"  },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Resolve a company logo URL. If the value is already an absolute URL
 * (starts with http/https/data:) it is used as-is; otherwise the API
 * base is prepended to avoid double-prefixing.
 */
function resolveLogoUrl(logo: string): string {
  return assetUrl(logo);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  children: React.ReactNode;
  onLogout: () => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardLayout({ children, onLogout }: Props) {
  const [collapsed,    setCollapsed]    = useState(false);
  const [menuOpen,     setMenuOpen]     = useState(false);
  const [location]  = useLocation();

  const { toggleTheme, isDark }                = useTheme();
  const { language, toggleLanguage, t, isRTL } = useLanguage();
  const { user }                               = useAuth();

  const menuRef    = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const displayName = user?.display_name ?? null;
  const role        = user?.role         ?? null;
  const companyLogo = user?.company_logo ?? null;

  const currentPage      = NAV_ITEMS.find((i) => i.href === location);
  const currentPageLabel = currentPage ? t(currentPage.labelKey) : t("nav.dashboard");

  // Close menu on outside click or Escape
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current    && !menuRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        closeMenu();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown",   handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown",   handleKey);
    };
  }, [menuOpen, closeMenu]);

  return (
    <div className="flex h-screen w-full bg-background">

      {/* ── Sidebar ── */}
      <aside
        className={`
          flex flex-col shrink-0 border-r border-border bg-card
          transition-all duration-300
          ${collapsed ? "w-14" : "w-56"}
        `}
      >
        {/* Logo */}
        <div className="flex h-20 flex-col items-center justify-center gap-1 border-b border-border px-3.5">
          <div className="flex items-center gap-3">
            <img
              src="/logo.gif"
              alt="Stark AI Logo"
              className="h-8 w-8 shrink-0 rounded-full object-cover ring-2 ring-primary/20"
            />
            {!collapsed && (
              <div className="flex flex-col">
                <span
                  style={{ fontFamily: "StardosStencil, sans-serif" }}
                  className="truncate text-sm tracking-wider text-[#9c2177]"
                >
                  STARK AI
                </span>
                <span className="text-[9px] font-medium tracking-wide text-muted-foreground uppercase">
                  Enterprise Costing System
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5" aria-label="Main navigation">
          {NAV_ITEMS.map(({ href, labelKey, icon: Icon, color }) => {
            const active = location === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`
                  flex items-center gap-3 rounded-md px-2.5 py-2 text-sm
                  transition-colors
                  ${collapsed ? "justify-center" : ""}
                  ${active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }
                `}
              >
                <Icon size={18} className={`shrink-0 ${active ? "text-primary" : color}`} />
                {!collapsed && (
                  <span className="truncate font-medium">{t(labelKey)}</span>
                )}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* ── Main ── */}
      <div className="flex flex-1 flex-col min-w-0">

        {/* Topbar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4 overflow-visible">

          {/* Left: hamburger + breadcrumb */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
            >
              <Menu size={18} />
            </button>
            <nav aria-label="Breadcrumb">
              <ol className="flex items-center gap-1.5 text-xs text-muted-foreground list-none">
                <li><span>{t("topbar.home")}</span></li>
                <li aria-hidden="true">
                  <ChevronRight size={12} className={isRTL ? "rotate-180" : ""} />
                </li>
                <li>
                  <span className="text-foreground font-medium" aria-current="page">
                    {currentPageLabel}
                  </span>
                </li>
              </ol>
            </nav>
          </div>

          {/* Right: period status + avatar menu */}
          <div className="flex items-center gap-2 overflow-visible">

            <div className="relative z-[60]">
              <PeriodStatusControl />
            </div>

            <div className="h-5 w-px bg-border mx-1" aria-hidden="true" />

            {/* ── Avatar menu (keyboard-accessible) ── */}
            <div className="relative">

              {/* Trigger button */}
              <button
                ref={triggerRef}
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="true"
                aria-expanded={menuOpen}
                aria-label={t("topbar.accountMenu")}
                className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-accent transition-colors"
              >
                {companyLogo ? (
                  <img
                    src={resolveLogoUrl(companyLogo)}
                    alt={t("topbar.companyLogo")}
                    className="w-8 h-8 rounded-full object-cover shrink-0 ring-2 ring-primary/20"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-white text-xs font-bold shrink-0 ring-2 ring-amber-500/20">
                    {getInitials(displayName)}
                  </div>
                )}
                <div className="hidden sm:flex flex-col leading-tight text-left">
                  <span className="text-xs font-medium text-foreground">
                    {t("topbar.welcome").replace("{name}", displayName ?? "")}
                  </span>
                  <span className="text-[10px] text-muted-foreground capitalize">{role}</span>
                </div>
                <ChevronDown
                  size={12}
                  className={`text-muted-foreground hidden sm:block transition-transform duration-150 ${menuOpen ? "rotate-180" : ""}`}
                />
              </button>

              {/* Dropdown */}
              {menuOpen && (
                <div
                  ref={menuRef}
                  role="menu"
                  aria-label={t("topbar.accountMenu")}
                  className="
                    absolute right-0 top-full mt-1 z-50
                    w-48 rounded-lg border border-border bg-card shadow-lg
                    animate-in fade-in slide-in-from-top-1 duration-150
                  "
                >
                  {/* Header */}
                  <div className="px-3 py-2.5 border-b border-border">
                    {companyLogo && (
                      <img
                        src={resolveLogoUrl(companyLogo)}
                        alt={t("topbar.companyLogo")}
                        className="w-8 h-8 rounded-full object-cover mb-2 ring-2 ring-primary/20"
                      />
                    )}
                    <p className="text-xs font-semibold text-foreground truncate">{displayName}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{role}</p>
                  </div>

                  <div className="p-1.5 space-y-0.5">
                    {/* Language */}
                    <button
                      role="menuitem"
                      onClick={() => { toggleLanguage(); closeMenu(); }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    >
                      <Languages size={13} />
                      <span>
                        {language === "en"
                          ? t("topbar.switchToArabic")
                          : t("topbar.switchToEnglish")}
                      </span>
                      <span className="ml-auto font-semibold">
                        {language === "en" ? "عر" : "EN"}
                      </span>
                    </button>

                    {/* Theme */}
                    <button
                      role="menuitem"
                      onClick={() => { toggleTheme(); closeMenu(); }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    >
                      {isDark
                        ? <Sun  size={13} className="text-amber-400" />
                        : <Moon size={13} />
                      }
                      <span>{isDark ? t("topbar.lightMode") : t("topbar.darkMode")}</span>
                    </button>
                  </div>

                  {/* Sign out */}
                  <div className="p-1.5 border-t border-border">
                    <button
                      role="menuitem"
                      onClick={() => { closeMenu(); onLogout(); }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                    >
                      <LogOut size={13} />
                      <span>{t("topbar.signout")}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto bg-muted/30">
          <div className="mx-auto max-w-7xl p-6">
            {children}
          </div>
        </main>

      </div>
    </div>
  );
}
