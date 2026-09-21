"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { WorkspaceAccessView, WorkspaceNavigationModel } from "@/server/workspace-admin";
import { writeStored } from "@/components/shell/use-persisted-state";

export type WorkspaceAuthorization = {
  access: WorkspaceAccessView;
  navigation: WorkspaceNavigationModel;
  confirmed: boolean;
  refresh: () => Promise<void>;
};
export const WorkspaceAuthorizationContext = createContext<WorkspaceAuthorization | null>(null);
export function useWorkspaceAuthorization() {
  const value = useContext(WorkspaceAuthorizationContext);
  if (!value) throw new Error("Workspace authorization requires the Workspace shell.");
  return value;
}

export function requestWorkspaceAccessCheck(status: number, code?: string) {
  if (code === "REVISION_CONFLICT") return;
  if ([403, 404, 409].includes(status)) window.dispatchEvent(new Event("kh:workspace-access-check"));
}

/** Navigation and capabilities are re-read for the affected browser, not just the actor. */
export function useWorkspaceAuthorizationRefresh(initialAccess: WorkspaceAccessView, initialNavigation: WorkspaceNavigationModel) {
  const router = useRouter();
  const pathname = usePathname();
  const [access, setAccess] = useState(initialAccess);
  const [navigation, setNavigation] = useState(initialNavigation);
  const [confirmed, setConfirmed] = useState(true);
  const [revoked, setRevoked] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const current = useRef(initialAccess);
  const workspaceId = initialAccess.workspace.id;

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    try {
      const navResponse = await fetch("/api/workspaces", { cache: "no-store", signal: abort.signal });
      if (!navResponse.ok) throw new Error("Could not refresh workspace navigation.");
      const nav = await navResponse.json() as WorkspaceNavigationModel;
      const mySpace = nav.items.find((item) => item.type === "PERSONAL");
      if (!mySpace) throw new Error("Personal workspace unavailable.");
      const visible = nav.items.some((item) => item.id === workspaceId);
      const response = visible
        ? await fetch(`/api/workspaces/${workspaceId}`, { cache: "no-store", signal: abort.signal })
        : null;
      if (response && !response.ok && response.status !== 404) throw new Error("Could not refresh workspace access.");
      const fresh = response?.ok ? await response.json() as WorkspaceAccessView : null;
      if (request !== generation.current) return;
      setNavigation(nav);
      if (!fresh) {
        setConfirmed(false);
        setRevoked(true);
        // A document navigation drops the App Router cache and all mounted scope state.
        writeStored("session", "kh:workspace-access-notice", "1");
        window.location.replace(`/w/${mySpace.id}/knowledge?notice=access-changed`);
        return;
      }
      const changed = JSON.stringify(current.current) !== JSON.stringify(fresh);
      current.current = fresh;
      setAccess(fresh);
      setConfirmed(true);
      if (pathname.includes(`/w/${workspaceId}/settings`) && !fresh.actions.canOpenSettings) {
        router.replace(`/w/${workspaceId}/knowledge`);
      } else if (changed) {
        router.refresh();
      }
    } catch {
      if (request === generation.current && !abort.signal.aborted) setConfirmed(false);
    }
  }, [workspaceId, pathname, router]);

  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setInterval> | undefined;
    const schedule = () => {
      clearInterval(timer);
      if (document.visibilityState === "visible") timer = setInterval(() => void refresh(), 30_000);
    };
    const visible = () => {
      schedule();
      if (document.visibilityState === "visible") void refresh();
    };
    const trigger = () => { void refresh(); };
    const denied = () => { setConfirmed(false); void refresh(); };
    schedule();
    window.addEventListener("focus", trigger);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("kh:workspace-mutation", trigger);
    window.addEventListener("kh:workspace-access-check", denied);
    return () => {
      ++generation.current;
      controller.current?.abort();
      clearInterval(timer);
      window.removeEventListener("focus", trigger);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("kh:workspace-mutation", trigger);
      window.removeEventListener("kh:workspace-access-check", denied);
    };
  }, [refresh]);
  return { access, navigation, confirmed, refresh, revoked };
}
