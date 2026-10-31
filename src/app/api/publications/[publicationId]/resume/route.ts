import { publicationHttp, publicationIdOf, type PublicationRouteContext } from "@/server/publication-http";

export async function POST(_request: Request, context: PublicationRouteContext) {
  return publicationHttp(async (services, caller) =>
    services.publications.resume(caller, await publicationIdOf(context)));
}
