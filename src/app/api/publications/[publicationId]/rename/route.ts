import {
  parsePublicationRenameInput,
  publicationHttp,
  publicationIdOf,
  type PublicationRouteContext,
} from "@/server/publication-http";

export async function POST(request: Request, context: PublicationRouteContext) {
  return publicationHttp(async (services, caller) => {
    const publicationId = await publicationIdOf(context);
    const { name } = await parsePublicationRenameInput(request);
    await services.publications.rename(caller, publicationId, name);
  }, 204);
}
