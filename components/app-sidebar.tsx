"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/protected/batch", label: "Batches" },
  { href: "/protected/customers", label: "Customers" },
  { href: "/protected/customer-sequences", label: "Customer Sequences" },
  { href: "/protected/logs", label: "Data Logs" },
] as const;

/** Desktop top nav: batches | customer setup | data logs — then Reports. */
const mainNavSections: ReadonlyArray<ReadonlyArray<(typeof navLinks)[number]>> = [
  [navLinks[0]],
  [navLinks[1], navLinks[2]],
  [navLinks[3]],
];

const reportLinks = [
  { href: "/protected/reports/customer-bags", label: "Customer Bags" },
] as const;

const navLinkClass =
  "rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors";

function NavLinksVertical({ onLinkClick }: { onLinkClick?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {navLinks.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          onClick={onLinkClick}
          className={navLinkClass}
        >
          {label}
        </Link>
      ))}
      <Link
        href="/docs/"
        onClick={onLinkClick}
        className={navLinkClass + " text-muted-foreground"}
      >
        Help &amp; docs
      </Link>
      <div className="pt-2 mt-2 border-t border-border">
        <p className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Reports
        </p>
        {reportLinks.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            onClick={onLinkClick}
            className={navLinkClass + " block"}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function ReportsNavItem() {
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setOpen(false), 150);
  };

  useEffect(() => {
    return () => clearCloseTimer();
  }, []);

  return (
    <div
      className="relative"
      onMouseEnter={() => {
        clearCloseTimer();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={cn(
          navLinkClass,
          "flex items-center gap-0.5",
          open && "bg-accent text-accent-foreground"
        )}
        aria-expanded={open}
        aria-haspopup="true"
      >
        Reports
        <ChevronDown className="size-4" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full pt-1 z-50 min-w-[10rem] rounded-md border bg-popover text-popover-foreground shadow-md py-1"
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClose}
        >
          {reportLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="block px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground rounded-sm mx-1"
            >
              {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function MainNavSectionDivider() {
  return (
    <span
      aria-hidden
      className="mx-3 h-5 w-px shrink-0 bg-border/45 dark:bg-border/55"
    />
  );
}

function NavLinksHorizontal() {
  return (
    <nav className="flex items-center" aria-label="Main navigation">
      {mainNavSections.map((section, sectionIndex) => (
        <div key={section[0].href} className="flex items-center">
          {sectionIndex > 0 ? <MainNavSectionDivider /> : null}
          <div className="flex items-center gap-2">
            {section.map(({ href, label }) => (
              <Link key={href} href={href} className={navLinkClass}>
                {label}
              </Link>
            ))}
          </div>
        </div>
      ))}
      <MainNavSectionDivider />
      <ReportsNavItem />
      <MainNavSectionDivider />
      <Link href="/docs/" className={navLinkClass}>
        Help &amp; docs
      </Link>
    </nav>
  );
}

export function AppSidebar({
  trailing,
}: {
  trailing: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const drawerContent = (
    <>
      <Link
        href="/"
        className="flex items-center shrink-0 -ml-0.5 mb-6"
        aria-label="Trak by WasteZero home"
        onClick={() => setMobileOpen(false)}
      >
        <Image
          src="/assets/trak_logo_color.png"
          alt="Trak by WasteZero"
          width={360}
          height={96}
          className="h-8 w-auto object-contain"
        />
      </Link>
      <NavLinksVertical onLinkClick={() => setMobileOpen(false)} />
      <div className="mt-auto pt-6 flex flex-col gap-2 border-t border-border">
        {trailing}
      </div>
    </>
  );

  const logo = (
    <Link
      href="/"
      className="flex items-center shrink-0 -ml-0.5"
      aria-label="Trak by WasteZero home"
      onClick={() => setMobileOpen(false)}
    >
      <Image
        src="/assets/trak_logo_color.png"
        alt="Trak by WasteZero"
        width={360}
        height={96}
        className="h-8 w-auto object-contain"
      />
    </Link>
  );

  return (
    <>
      {/* Mobile: hamburger bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 h-14 flex items-center px-4 border-b border-border bg-background">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open menu"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {/* Mobile: drawer overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 lg:hidden"
          aria-hidden
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile: drawer panel */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-full w-64 flex flex-col bg-background border-r border-border p-5 transition-transform duration-200 ease-out lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium text-muted-foreground">Menu</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        {drawerContent}
      </aside>

      {/* Desktop: horizontal top nav bar */}
      <header className="hidden lg:block fixed top-0 left-0 right-0 z-40 h-14 border-b border-border bg-background">
        <div className="h-full w-full flex justify-between items-center px-5 relative">
          <div className="flex items-center shrink-0">
            {logo}
          </div>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <NavLinksHorizontal />
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {trailing}
          </div>
        </div>
      </header>
    </>
  );
}
