"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthContext } from "@/components/auth/AuthProvider";
import { useTheme } from "@/contexts/ThemeContext";
import { HelpButton } from "@/components/walkthrough/HelpButton";

export function TopNav() {
  const pathname = usePathname();
  const { user, logout, pendingInvitations } = useAuthContext();
  const { theme, toggleTheme } = useTheme();

  if (!user) return null;

  const links = [
    { href: "/", label: "Map", icon: "🗺️" },
    { href: "/groups", label: "Groups", icon: "👥", badge: pendingInvitations },
    { href: "/profile", label: "Profile", icon: "👤" },
    ...(user.is_admin
      ? [{ href: "/admin", label: "Admin", icon: "⚙️" }]
      : []),
  ];

  return (
    <nav className="flex items-center justify-between border-b border-border bg-nav px-4 py-2">
      <div className="flex items-center gap-1">
        <span className="text-sm font-bold text-primary mr-4">🏍️ Moto-GPS</span>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`
              flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors
              ${
                pathname === link.href
                  ? "bg-surface-alt text-primary"
                  : "text-muted hover:text-primary hover:bg-surface"
              }
            `}
          >
            <span>{link.icon}</span>
            {link.label}
            {link.badge ? (
              <span className="ml-1 bg-red-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                {link.badge}
              </span>
            ) : null}
          </Link>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <HelpButton />
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="text-muted hover:text-primary transition-colors text-sm"
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        <span className="text-xs text-muted">{user.name}</span>
        <button
          onClick={logout}
          className="text-xs text-muted hover:text-primary transition-colors"
        >
          Logout
        </button>
      </div>
    </nav>
  );
}
