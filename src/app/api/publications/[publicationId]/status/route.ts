import { publicationHttp, publicationIdOf, type PublicationRouteContext } from "@/server/publication-http";

export async function GET(_request: Request, context: PublicationRouteContext) {
  return publicationHttp(async (services, caller) =>
    services.publications.status(caller, await publicationIdOf(context)));
}
