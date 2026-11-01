import { parsePublicationPublishInput, publicationHttp } from "@/server/publication-http";

export async function POST(request: Request) {
  return publicationHttp(async (services, caller) => {
    const input = await parsePublicationPublishInput(request);
    return services.publications.publish(caller, input);
  }, 201);
}
