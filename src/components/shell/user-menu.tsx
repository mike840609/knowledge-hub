"use client";
import { useRef, useState } from "react";
import { FeedbackReport } from "@/components/knowledge/feedback-report";
import Link from "next/link";

import { ChevronUp, Moon, Monitor, Rows3, Rows4, Sun, UserRound, Settings, CircleHelp, MessageSquareWarning } from "lucide-react";
import {Tooltip} from "@/components/ui/tooltip";
import { buttonClasses } from "@/components/ui/button";
import {
  MenuContent,
  MenuItem,
  MenuGroup,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { useTheme, type Theme } from "./use-theme";
import { useDensity, type Density } from "./use-density";

/**
 * The account affordance, and where personal preferences live.
 *
 * Theme used to sit in the topbar as a permanent control, which spent chrome
 * on a setting a reader changes about twice in the life of an account. It does
 * not belong in Settings either — that surface is workspace governance, and
 * the theme is a personal preference held in this browser.
 */
export function UserMenu({ identityName, identityEmpId, workspaceId, compact = false, trigger = "account" }: { identityName: string; identityEmpId: string; workspaceId?: string; compact?: boolean; trigger?: "account" | "preferences" }) {
  const [reportOpen, setReportOpen] = useState(false);
  const accountRef = useRef<HTMLButtonElement>(null);
  const { theme, setTheme } = useTheme();
  const { density, setDensity } = useDensity();

  const accountTrigger=(
      <MenuTrigger
        ref={accountRef}
        aria-label={trigger === "preferences" ? "Personal preferences" : `Account: ${identityName}`}
        className={buttonClasses({ variant: trigger === "preferences" ? "secondary" : "ghost", className: trigger === "preferences" ? "" : compact ? "w-full justify-center px-0" : "w-full justify-start gap-2" })}
      >
        {trigger === "preferences" ? <><Settings className="h-4 w-4 shrink-0" aria-hidden="true"/><span className="profile-preferences-label">Preferences</span></> : <><UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
        {!compact ? <><span className="min-w-0 flex-1 truncate text-left">{identityName}</span><ChevronUp className="h-4 w-4 shrink-0" aria-hidden="true" /></> : null}</>}
      </MenuTrigger>
  );
  return (
    <>
    <MenuRoot>
      {/* The rail is compact, so a full name may still be cut off; the tooltip says it whole, expanded or not. */}
      {trigger === "account" ? <Tooltip label={identityName} side={compact ? "right" : "top"}>{accountTrigger}</Tooltip> : accountTrigger}
      <MenuContent side="top" align="start" className="w-60">
        <MenuGroup>
          <MenuGroupLabel>Signed in as</MenuGroupLabel>
          <p className="truncate px-2 pb-1 text-body text-kh-text" title={identityName}>
            {identityName}
          </p>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Theme</MenuGroupLabel>
          {/* One row, not three: the choices are icons with their names, and
              selection is the row's fill. This is the same live preference,
              spending 32px instead of 96px of the account menu. */}
          <MenuRadioGroup
            value={theme ?? undefined}
            onValueChange={(value) => setTheme(value as Theme)}
            className="grid grid-cols-3 gap-0.5 px-1"
          >
            <MenuRadioItem compact value="light" closeOnClick={false}>
              <Sun className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Light</span>
            </MenuRadioItem>
            <MenuRadioItem compact value="dark" closeOnClick={false}>
              <Moon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Dark</span>
            </MenuRadioItem>
            <MenuRadioItem compact value="system" closeOnClick={false}>
              <Monitor className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>System</span>
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
        <MenuGroup>
          <MenuGroupLabel>Density</MenuGroupLabel>
          <MenuRadioGroup
            value={density ?? undefined}
            onValueChange={(value) => setDensity(value as Density)}
            className="grid grid-cols-2 gap-0.5 px-1"
          >
            <MenuRadioItem compact value="comfortable" closeOnClick={false}>
              <Rows3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Comfortable</span>
            </MenuRadioItem>
            <MenuRadioItem compact value="compact" closeOnClick={false}>
              <Rows4 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Compact</span>
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
        {workspaceId ? <><MenuSeparator /><MenuItem render={<Link href="/help" />}><span className="flex items-center gap-2"><CircleHelp className="h-4 w-4 shrink-0 text-kh-text-muted" aria-hidden="true" />Help &amp; guides</span></MenuItem></> : null}
        <MenuItem onClick={() => setReportOpen(true)}><span className="flex items-center gap-2"><MessageSquareWarning className="h-4 w-4 shrink-0 text-kh-text-muted" aria-hidden="true" />Report a problem</span></MenuItem>
      </MenuContent>
    </MenuRoot>
    <FeedbackReport empId={identityEmpId} open={reportOpen} onOpenChange={setReportOpen} returnFocus={accountRef} />
    </>
  );
}
