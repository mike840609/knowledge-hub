import { publicationHttp } from "@/server/publication-http";

/**
 * What the publish and join dialogs may offer: teams where this caller holds
 * `source.manage`, and their own folders. Every entry is re-judged in the
 * service; the list is convenience, never authorization.
 */
export async function GET() {
  return publicationHttp(async (services, caller) => services.publications.options(caller));
}
