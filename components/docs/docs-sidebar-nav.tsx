import Link from "next/link";
import { cn } from "@/lib/utils";
import { DOC_NAV } from "@/lib/docs/config";

type Props = {
  currentSlug: string;
  className?: string;
};

function docHref(slug: string): string {
  return slug === "help" ? "/protected/docs" : `/protected/docs/${slug}`;
}

export function DocsSidebarNav({ currentSlug, className }: Props) {
  return (
    <nav
      className={cn("flex flex-col gap-6 text-sm", className)}
      aria-label="Help Documentation"
    >
      {DOC_NAV.map((section) => (
        <div key={section.label} className="space-y-1.5">
          <p className="px-2 text-xs font-semibold tracking-wide text-muted-foreground">
            {section.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = currentSlug === item.slug;
              return (
                <li key={item.slug}>
                  <Link
                    href={docHref(item.slug)}
                    className={cn(
                      "block rounded-md px-2 py-1.5 transition-colors",
                      active
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
