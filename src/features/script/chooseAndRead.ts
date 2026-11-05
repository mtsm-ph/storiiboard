import { showNotice } from '../../app/notice';
import { projectStore } from '../../app/projectStore';
import { chooseScript } from '../../app/scripts';
import { parseScreenplayPdf } from '../../core/script/pdfLayout';
import { parseScript } from '../../core/script/parse';
import type { Script } from '../../core/script/script';
import { showImport } from './importStore';
import { t } from '../../core/i18n';

/** A PDF by its layout (pdf.js loads only for one); Fountain and Final Draft by their text. */
async function read(name: string, bytes: ArrayBuffer): Promise<Script> {
  const head = new Uint8Array(bytes.slice(0, 5));
  if (name.toLowerCase().endsWith('.pdf') || String.fromCharCode(...head) === '%PDF-') {
    const { readPdfText } = await import('./readPdf');
    return parseScreenplayPdf(await readPdfText(bytes, name));
  }
  return parseScript(new TextDecoder('utf-8').decode(bytes));
}

/** Import script…: the Open dialog, then the file read and parsed into the preview. A file with no scenes says so. */
export async function chooseScriptToImport(): Promise<void> {
  const opened = projectStore.getState().project;
  if (!opened) return;
  try {
    const file = await chooseScript();
    if (!file) return;
    const script = await read(file.name, await file.bytes());
    if (script.scenes.length === 0) {
      showNotice(
        file.name.toLowerCase().endsWith('.pdf')
          ? t('script.noHeadingsPdf', { name: file.name })
          : t('script.noHeadings', { name: file.name }),
      );
      return;
    }
    showImport({ fileName: file.name, script, projectId: opened.projectId, path: opened.file.path });
  } catch (error) {
    showNotice(error);
  }
}
