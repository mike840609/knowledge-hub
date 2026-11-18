"use client";

import { ActionIcon } from "@/components/actions/action-icon";
import type { Action } from "@/components/actions/action-registry";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { requestPeek } from "./peek-request";

export function RowPreviewButton({ actions, label, className }: { actions: readonly Action[]; label: string; className: string }) {
  const action = actions.find(({ id }) => id === "document.open-side-peek");
  if (action?.effect.kind !== "side-peek") return null;
  const { documentId, sourceId } = action.effect;
  return (
    <span className={className}>
      <Tooltip label={action.label}>
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={`${action.label}: ${label}`}
          onClick={(event) => requestPeek({ documentId, sourceId, opener: event.currentTarget })}
        >
          <ActionIcon name={action.icon} className="size-3.5" />
        </Button>
      </Tooltip>
    </span>
  );
}
