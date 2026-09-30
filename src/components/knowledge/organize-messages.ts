/**
 * What the reader is told when they organize: after an archive, a restore or a rename, and when the
 * server refuses (daily-driver spec §7.1, §7.3). All of it is here so it reads as one voice and so
 * that a change of wording, or of language, is a change to this file and no other.
 *
 * Labels stay English, in the registry and the menus; these are the sentences around them, which the
 * spec gives in Chinese — as the composer's "已還原未存的修改。" is. Pure functions, no React: the
 * rules about which failure says what are the part worth testing without a browser.
 */

export const UNDO_LABEL = "復原";

const quote = (name: string) => `「${name}」`;

export function archivedDocument(title: string, backlinks: number | null): string {
  const base = `已封存${quote(title)}。`;
  // Links resolve only to active documents, so what pointed here now points at nothing until it is restored.
  return backlinks !== null && backlinks > 0 ? `${base}${backlinks} 份文件連到這裡，它們的連結會變成失效。` : base;
}

export const restoredDocument = (title: string) => `已還原${quote(title)}。`;
export const archivedFolder = (name: string) => `已封存資料夾${quote(name)}。`;
export const restoredFolder = (name: string) => `已還原資料夾${quote(name)}。`;
export const createdFolder = (name: string) => `已建立資料夾${quote(name)}。`;
export const renamedFolder = (to: string) => `已重新命名為${quote(to)}。`;

/** The name field's own rules, said before the request is sent; the server checks the same. */
export function folderNameProblem(raw: string, maxLength: number): string | null {
  const name = raw.trim();
  if (name === "") return "請輸入資料夾名稱。";
  if (name.length > maxLength) return `名稱太長了，最多 ${maxLength} 個字元。`;
  return null;
}

/**
 * What a refusal means for the reader, by the code the server sent. Anything not listed here keeps the
 * server's own message, in the server's language: a sentence nobody here wrote is still more useful
 * than "something went wrong".
 */
export function organizeFailure(failure: { code: string; message: string }): string {
  switch (failure.code) {
    case "FOLDER_NOT_EMPTY":
      return "這個資料夾裡還有文件或資料夾。先移走或封存裡面的內容，再封存它。";
    case "INVALID_PARENT":
      return "目標資料夾已不存在，或已被封存。";
    case "TREE_CYCLE":
      return "不能把資料夾移到它自己或它的子資料夾裡。";
    case "CROSS_SOURCE_MOVE":
      return "不能把項目移到另一個來源。";
    case "SOURCE_MANAGED_READ_ONLY":
    case "HUB_MANAGED_OPERATION_REQUIRED":
      return "這個來源由同步管理，內容不能在這裡修改。";
    case "SOURCE_ARCHIVED":
      return "這個來源已封存，不能修改。請先還原它。";
    case "NOT_FOUND":
      return "找不到這個項目。它可能已被移除，或你已沒有權限。";
    case "REQUEST_FAILED":
      return "無法完成這個操作，請再試一次。";
    default:
      return failure.message;
  }
}
