import { publicationHttp, publicationIdOf, type PublicationRouteContext } from "@/server/publication-http";

export async function POST(_request: Request, context: PublicationRouteContext) {
  return publicationHttp(async (services, caller) => {
    await services.publications.restore(caller, await publicationIdOf(context));
  }, 204);
}
