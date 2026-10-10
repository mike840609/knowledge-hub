import { DomainError } from "@/shared/domain/errors";
import { publicOrigin } from "./config";
/** Compare the browser origin with the configured public origin, or else the actual request origin, including the port. */
export function assertReviewOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  // Behind the Gateway the request URL below is the bind address, never the public host, so the
  // deployment states its public origin and that alone is accepted.
  const configured = publicOrigin();
  if (configured) {
    if (origin !== configured) throw new DomainError("REVIEW_ORIGIN_DENIED", "A same-origin request is required.");
    return;
  }
  // NextRequest.url uses NextURL, which rewrites 127.0.0.1 to localhost.
  // Its native Request superclass retains the trusted original URL. Compare
  // that URL directly; never trust forwarding headers or equate host aliases.
  // Use the request's own superclass chain: production Next may bundle a
  // different Request implementation than the global constructor.
  let prototype:object|null=Object.getPrototypeOf(request);
  let originalUrlGetter:((this:Request)=>unknown)|undefined;
  while(prototype) {
    const getter=Object.getOwnPropertyDescriptor(prototype,"url")?.get;
    if(getter) originalUrlGetter=getter;
    prototype=Object.getPrototypeOf(prototype);
  }
  const requestUrl=originalUrlGetter?.call(request);
  if(typeof requestUrl!=="string") throw new DomainError("REVIEW_ORIGIN_DENIED","A same-origin request is required.");
  if (!origin || origin !== new URL(requestUrl).origin) throw new DomainError("REVIEW_ORIGIN_DENIED", "A same-origin request is required.");
}
