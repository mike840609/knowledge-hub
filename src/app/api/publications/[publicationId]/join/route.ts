import {
  parsePublicationJoinInput,
  publicationHttp,
  publicationIdOf,
  type PublicationRouteContext,
} from "@/server/publication-http";

export async function POST(request: Request, context: PublicationRouteContext) {
  return publicationHttp(async (services, caller) => {
    const publicationId = await publicationIdOf(context);
    const input = await parsePublicationJoinInput(request);
    return services.publications.join(caller, { publicationId, ...input });
  });
}
