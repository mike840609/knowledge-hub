"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { GovernanceError, governanceFailure, governanceRequest, type GovernanceFailure } from "@/components/workspaces/governance-error";
import { RecipientPicker, type Recipient } from "./recipient-picker";

type Named = { userId: string; name: string; nameEn: string | null; empId: string };

const personText = (person: Named) => [person.name, person.empId, person.nameEn].filter(Boolean).join(" · ");

/**
 * Who a named share names (`onCount` must be stable, it is a dependency of the load): the people now, a way to add more, and a way to take one away. Each
 * change is its own request, so what is listed is what the server holds after it answers.
 */
export function NamedShareRecipients({ linkId, onCount }: { linkId: string; onCount: (linkId: string, count: number) => void }) {
  const [people, setPeople] = useState<Named[] | null>(null);
  const [pending, setPending] = useState<Recipient[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  const url = `/api/share-links/${linkId}/recipients`;

  const load = useCallback(async () => {
    const { recipients } = await governanceRequest<{ recipients: Named[] }>(url);
    setPeople(recipients);
    onCount(linkId, recipients.length);
  }, [url, linkId, onCount]);

  useEffect(() => {
    load().catch((failure) => setError(governanceFailure(failure)));
  }, [load]);

  const change = async (request: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await request();
      await load();
      return true;
    } catch (failure) {
      setError(governanceFailure(failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-kh-border pt-3">
      {people === null ? null : people.length === 0 ? (
        <p className="text-body-sm text-kh-text-muted">No one yet — only you can open it.</p>
      ) : (
        <ul aria-label="People who can open this link" className="divide-y divide-kh-border">
          {people.map((person) => (
            <li key={person.userId} className="flex items-center justify-between gap-3 py-1">
              <span className="min-w-0 truncate text-body-sm text-kh-text">{personText(person)}</span>
              <Button variant="ghost" size="sm" type="button" disabled={busy} aria-label={`Remove ${person.name} from this link`} onClick={() => void change(() => governanceRequest(`${url}/${person.userId}`, "DELETE"))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <RecipientPicker value={pending} onChange={setPending} disabled={busy} exclude={(people ?? []).map((person) => person.userId)} label="Add people to this link" />
        </div>
        <Button
          variant="secondary"
          size="md"
          type="button"
          disabled={busy || pending.length === 0}
          onClick={async () => { if (await change(() => governanceRequest(url, "POST", { userIds: pending.map((person) => person.id) }))) setPending([]); }}
        >
          Add
        </Button>
      </div>
      <GovernanceError error={error} />
    </div>
  );
}
