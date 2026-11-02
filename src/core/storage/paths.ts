// node:path isn't available in the webview, and a path here can come from either a Mac or Windows. Only the file
// name is ever needed above the drivers, so this is all there is.

/** `/Projects/Bey County.sbd` → `Bey County.sbd`; Windows separators work too. */
export function fileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/** `/Projects/Bey County.sbd` → `Bey County`: the `<Project>` in backup names. */
export function fileStem(path: string): string {
  return fileName(path).replace(/\.sbd$/i, '');
}
