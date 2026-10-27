export async function requestSourceRename(sourceId: string, name: string): Promise<void> {
  const response = await fetch(`/api/sources/${sourceId}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  throw new Error(body?.error?.message ?? "Could not rename the source.");
}
