"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** SSR and no-JS use explicit UTC; hydration exchanges results and zone together. */
export function TaskSearchOffsetHydrator({ hasDateFilter, explicitOffset }: {
  hasDateFilter: boolean;
  explicitOffset: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!hasDateFilter || explicitOffset) return;
    const location = new URL(window.location.href);
    if (location.searchParams.has("offset")) return;
    location.searchParams.set("offset", String(-new Date().getTimezoneOffset()));
    location.searchParams.delete("cursor");
    router.replace(location.pathname + location.search, { scroll: false });
  }, [hasDateFilter, explicitOffset, router]);
  return null;
}

