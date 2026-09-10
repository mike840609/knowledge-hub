export type Migration = {
  version: number;
  name: string;
  statements: readonly string[];
};
