import { randomUUID } from "node:crypto";
import type { ShareTokenIssuer } from "@/modules/knowledge/ports/share-token-issuer";

export class RandomShareTokenIssuer implements ShareTokenIssuer {
  issue(): string {
    return randomUUID();
  }
}
