import { stringify } from "yaml";
export function exportMarkdown(input: { title: string; markdown: string; metadata: Record<string, unknown> }): string {
  return `---\n${stringify({ ...input.metadata, title: input.title })}---\n\n${input.markdown}`;
}
export function exportName(label: string, id: string): string {
  const cleaned = label.normalize("NFC").replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_").replace(/^\.+|[. ]+$/g, "").slice(0, 60);
  return `${cleaned || "Untitled"}-${id}`;
}
function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Standard uncompressed UTF-8 ZIP. Explicit bounds avoid ZIP64 truncation. */
export function exportZip(files: { path: string; content: string }[]): Uint8Array<ArrayBuffer> {
  if (files.length > 10_000) throw new Error("Too many export files.");
  const chunks: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const file of files) {
    if (file.path.startsWith("/") || file.path.split("/").some(s => s === ".." || s === ".") || file.path.includes("\\")) throw new Error("Unsafe export path.");
    const name = Buffer.from(file.path); const data = Buffer.from(file.content);
    if (name.length > 65535 || offset + data.length > 64 * 1024 * 1024) throw new Error("Export exceeds 64 MiB. Export individual documents instead.");
    const crc = crc32(data); const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    chunks.push(header, name, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(33, 14);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, name); offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, directory, end]));
}
