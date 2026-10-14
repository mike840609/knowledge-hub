import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BlobMismatchError, type BlobBody, type BlobStore } from "@/modules/sources/ports/blob-store";

const SHA256 = /^[0-9a-f]{64}$/;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

export class FilesystemBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  private file(sha256: string): string {
    if (!SHA256.test(sha256)) throw new Error("A blob key is a lowercase hex SHA-256.");
    return path.join(this.root, "sha256", sha256.slice(0, 2), sha256.slice(2, 4), sha256);
  }

  async put(sha256: string, body: BlobBody, expectedSize: number): Promise<void> {
    const target = this.file(sha256);
    const temporary = path.join(this.root, "tmp", randomUUID());
    await mkdir(path.dirname(temporary), { recursive: true });
    const hash = createHash("sha256");
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        if (size > expectedSize) return done(new BlobMismatchError());
        hash.update(chunk);
        done(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(body as never), meter, createWriteStream(temporary, { flags: "wx" }));
      if (size !== expectedSize || hash.digest("hex") !== sha256) throw new BlobMismatchError();
      // Flushed before it gets its real name: a crash leaves a temp file, never a short image.
      const handle = await open(temporary, "r+");
      try { await handle.sync(); } finally { await handle.close(); }
      await mkdir(path.dirname(target), { recursive: true });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async open(sha256: string): Promise<{ body: BlobBody; size: number } | null> {
    const file = this.file(sha256);
    try {
      const { size } = await stat(file);
      return { body: Readable.toWeb(createReadStream(file)) as unknown as BlobBody, size };
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }

  async has(sha256: string): Promise<boolean> {
    try { return (await stat(this.file(sha256))).isFile(); } catch (error) { if (missing(error)) return false; throw error; }
  }

  async remove(sha256: string): Promise<void> {
    await rm(this.file(sha256), { force: true });
  }

  async *list(): AsyncIterable<{ sha256: string; modifiedAt: Date }> {
    const names = async (dir: string) => { try { return (await readdir(dir)).sort(); } catch (error) { if (missing(error)) return []; throw error; } };
    const base = path.join(this.root, "sha256");
    for (const first of await names(base)) {
      for (const second of await names(path.join(base, first))) {
        for (const name of await names(path.join(base, first, second))) {
          if (!SHA256.test(name)) continue;
          try { yield { sha256: name, modifiedAt: (await stat(path.join(base, first, second, name))).mtime }; } catch (error) { if (!missing(error)) throw error; }
        }
      }
    }
  }
}
