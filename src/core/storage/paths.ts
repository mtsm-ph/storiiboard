// node:path isn't available in the webview, and a path here can come from either a Mac or Windows. Only the file
// name is ever needed above the drivers, so this is all there is.

/** `/Projects/Bey County.sbd` → `Bey County.sbd`; Windows separators work too. */
export function fileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/**
 * A path as the system compares it, for telling whether two spellings name the same file: separators made the same,
 * and on Windows (a drive letter or a share) in any case, as NTFS and SMB match names. `Z:\Shoots\A.sbd` and
 * `z:/shoots/a.sbd` give one key; a Mac or Linux path keeps its case.
 */
export function pathKey(path: string): string {
  const same = path.replace(/\\/g, '/');
  return /^[A-Za-z]:\//.test(same) || same.startsWith('//') ? same.toLowerCase() : same;
}

/** `/Projects/Bey County.sbd` → `Bey County`: the `<Project>` in backup names. */
export function fileStem(path: string): string {
  return fileName(path).replace(/\.sbd$/i, '');
}
