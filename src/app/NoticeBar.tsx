import { t } from '../core/i18n';
import { useIsTopWindow, useOpenWindowCount } from '../ui/InAppWindow';
import { clearNotice, useNotice } from './notice';

/**
 * The notice: what didn't happen, or what's worth knowing. Above the workspace, or inside the top window of the app's
 * own while one is open (polish B), since everything behind a window is out of reach and unheard: a Compact project
 * pressed in Settings says how it went there. Each window that can raise one draws a bar; only one shows at a time.
 */
export function NoticeBar() {
  const notice = useNotice();
  const top = useIsTopWindow();
  const windows = useOpenWindowCount();
  // In a window: only the top one. Outside: only with no window open.
  if (notice.message === null || (top === null ? windows > 0 : !top)) return null;
  return notice.kind === 'warning' ? (
    <div data-notice="" role="alert" className="mx-gap mt-gap flex shrink-0 items-center gap-3 bg-warning px-3 py-2 text-paper-fixed">
      <p className="text-[13px]">{notice.message}</p>
      <button type="button" onClick={clearNotice} className="sb-label ml-auto border border-paper-fixed px-2 py-1 focus-visible:outline-paper-fixed">
        {t('appShell.dismiss')}
      </button>
    </div>
  ) : (
    <div data-notice="" role="status" className="mx-gap mt-gap flex shrink-0 items-center gap-3 border border-text px-3 py-1.5">
      <p className="text-[13px]">{notice.message}</p>
      <button type="button" onClick={clearNotice} className="sb-label ml-auto border border-text px-2 py-1">
        {t('appShell.gotIt')}
      </button>
    </div>
  );
}
