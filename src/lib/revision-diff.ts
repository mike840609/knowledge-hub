export type RevisionDiffLine = { kind: "same" | "added" | "removed"; text: string; before: number | null; after: number | null };

/** Line comparison with a bounded LCS table. Large rewrites remain exact as a replacement block. */
export function revisionDiff(before: string, after: string): RevisionDiffLine[] {
  const oldLines = before === "" ? [] : before.split("\n");
  const newLines = after === "" ? [] : after.split("\n");
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let endOld = oldLines.length, endNew = newLines.length;
  while (endOld > prefix && endNew > prefix && oldLines[endOld - 1] === newLines[endNew - 1]) { endOld--; endNew--; }
  const result: RevisionDiffLine[] = [];
  const emit = (kind: RevisionDiffLine["kind"], i: number, j: number) => result.push({ kind, text: kind === "added" ? newLines[j] : oldLines[i], before: kind === "added" ? null : i + 1, after: kind === "removed" ? null : j + 1 });
  for (let i = 0; i < prefix; i++) emit("same", i, i);
  const rows = endOld - prefix, cols = endNew - prefix;
  if ((rows + 1) * (cols + 1) > 500_000) {
    for (let i = prefix; i < endOld; i++) emit("removed", i, prefix);
    for (let j = prefix; j < endNew; j++) emit("added", prefix, j);
  } else {
    const width = cols + 1;
    const lcs = new Uint32Array((rows + 1) * width);
    for (let i = rows - 1; i >= 0; i--) for (let j = cols - 1; j >= 0; j--) {
      lcs[i * width + j] = oldLines[prefix + i] === newLines[prefix + j]
        ? lcs[(i + 1) * width + j + 1] + 1
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
    let i = 0, j = 0;
    while (i < rows || j < cols) {
      if (i < rows && j < cols && oldLines[prefix + i] === newLines[prefix + j]) { emit("same", prefix + i, prefix + j); i++; j++; }
      else if (i < rows && (j === cols || lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) { emit("removed", prefix + i, prefix + j); i++; }
      else { emit("added", prefix + i, prefix + j); j++; }
    }
  }
  for (let i = endOld, j = endNew; i < oldLines.length; i++, j++) emit("same", i, j);
  return result;
}

/** Two context lines around changes, rather than repeating both whole documents. */
export function revisionDiffContext(lines: readonly RevisionDiffLine[]): (RevisionDiffLine | null)[] {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.kind !== "same") for (let i = Math.max(0, index - 2); i <= Math.min(lines.length - 1, index + 2); i++) keep.add(i);
  });
  const visible: (RevisionDiffLine | null)[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (keep.has(i)) visible.push(lines[i]);
    else if (visible.length && visible.at(-1) !== null) visible.push(null);
  }
  if (visible.at(-1) === null) visible.pop();
  return visible;
}
