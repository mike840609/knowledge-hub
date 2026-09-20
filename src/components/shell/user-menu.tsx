"use client";

import { ChevronDown, Moon, Sun, UserRound } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import {
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { useTheme, type Theme } from "./use-theme";

/**
 * The account affordance, and where personal preferences live.
 *
 * Theme used to sit in the topbar as a permanent control, which spent chrome
 * on a setting a reader changes about twice in the life of an account. It does
 * not belong in Settings either — that surface is workspace governance, and
 * the theme is a personal preference held in this browser.
 */
export function UserMenu({ identityName }: { identityName: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <MenuRoot>
      <MenuTrigger
        aria-label={`Account: ${identityName}`}
        className={buttonClasses({ variant: "ghost", className: "max-w-[14rem]" })}
      >
        <UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden min-w-0 truncate sm:inline">{identityName}</span>
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
      </MenuTrigger>
      <MenuContent align="end" className="w-56">
        <MenuGroup>
          <MenuGroupLabel>Signed in as</MenuGroupLabel>
          <p className="truncate px-2 pb-1 text-body text-kh-text" title={identityName}>
            {identityName}
          </p>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Theme</MenuGroupLabel>
          {/* Null until the effect resolves, so neither option claims to be
              current while the server and client renders are still agreeing. */}
          <MenuRadioGroup
            value={theme ?? undefined}
            onValueChange={(value) => setTheme(value as Theme)}
          >
            <MenuRadioItem value="light" closeOnClick={false}>
              <span className="flex items-center gap-2">
                <Sun className="h-4 w-4 shrink-0 text-kh-text-muted" aria-hidden="true" />
                Light
              </span>
            </MenuRadioItem>
            <MenuRadioItem value="dark" closeOnClick={false}>
              <span className="flex items-center gap-2">
                <Moon className="h-4 w-4 shrink-0 text-kh-text-muted" aria-hidden="true" />
                Dark
              </span>
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
      </MenuContent>
    </MenuRoot>
  );
}
