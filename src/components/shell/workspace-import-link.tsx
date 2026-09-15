"use client";
import Link from "next/link";
import type { ComponentProps } from "react";
import { useWorkspaceAuthorization } from "./use-workspace-authorization";

export function WorkspaceImportLink(props: ComponentProps<typeof Link>) {
  const { access, confirmed } = useWorkspaceAuthorization();
  return access.actions.canImport && confirmed ? <Link {...props} /> : null;
}
