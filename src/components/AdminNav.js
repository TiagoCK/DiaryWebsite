"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/pages", label: "Page index" },
  { href: "/admin/people", label: "People" },
  { href: "/admin/editor", label: "Image Editor" },
];

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="adminnav">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`adminnav__tab${active ? " adminnav__tab--active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
