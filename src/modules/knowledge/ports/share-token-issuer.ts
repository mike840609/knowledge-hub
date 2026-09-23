/**
 * Issues share-link tokens. Implementations must return a random UUIDv4:
 * the codebase's uuidv7() is sequential within a millisecond, so a token
 * minted next to another ID could be computed from it (share-link spec §8).
 */
export interface ShareTokenIssuer {
  issue(): string;
}
