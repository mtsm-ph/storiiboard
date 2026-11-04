import { showNotice } from '../../app/notice';
import { projectStore } from '../../app/projectStore';
import { chooseScript } from '../../app/scripts';
import { parseScript } from '../../core/script/parse';
import { showImport } from './importStore';

/** Import script…: the Open dialog, then the file read and parsed into the preview. A file with no scenes says so. */
export async function chooseScriptToImport(): Promise<void> {
  const opened = projectStore.getState().project;
  if (!opened) return;
  try {
    const file = await chooseScript();
    if (!file) return;
    const script = parseScript(await file.text());
    if (script.scenes.length === 0) {
      showNotice(`No scene headings in “${file.name}”. Scenes start with INT. or EXT., as in “INT. DINER - NIGHT”.`);
      return;
    }
    showImport({ fileName: file.name, script, projectId: opened.projectId, path: opened.file.path });
  } catch (error) {
    showNotice(error);
  }
}
