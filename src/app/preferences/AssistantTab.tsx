import { t } from '../../core/i18n';
import { ASSISTANT_TOOL_KINDS, ASSISTANT_TOOLS, type AssistantToolKind } from '../../core/model/assistantTools';
import { ASSISTANT_SCOPE, scopeWords } from '../../core/model/suggestionScope';
import { useProject } from '../projectStore';

// Settings → AI assistant (7.6, Phase 7 decision 14): what the MCP server reads and writes, said plainly. Every tool with
// one line, from the one list the server registers (src/core/model/assistantTools.ts); what the assistant can suggest,
// from the scope row itself (scopeWords), so neither can drift from what the code does; and that stored contact details
// are never read. The switch "Let the assistant read contact details" isn't built: it needs a project prop Kevin hasn't
// approved, and until it is the server never reads them.

const KIND_LABEL: Readonly<Record<AssistantToolKind, 'assistant.kind.read' | 'assistant.kind.check' | 'assistant.kind.propose'>> = {
  read: 'assistant.kind.read',
  check: 'assistant.kind.check',
  propose: 'assistant.kind.propose',
};

export function AssistantTab() {
  const name = useProject((s) => s.project?.name ?? null);
  const scope = scopeWords(ASSISTANT_SCOPE);
  return (
    <div className="flex max-w-[620px] flex-col gap-3 p-4" data-assistant-tab="">
      <p className="text-[13px]">{t('assistant.intro')}</p>
      <p className="text-[13px]" data-assistant-privacy="">
        {t('assistant.privacy')}
      </p>
      <p className="text-[13px]">{name === null ? t('assistant.arriveNoProject') : t('assistant.arrive', { folder: `${name} Suggestions` })}</p>
      <h3 className="sb-label">{t('assistant.tools')}</h3>
      {ASSISTANT_TOOL_KINDS.map((kind) => {
        const tools = ASSISTANT_TOOLS.filter((tool) => tool.kind === kind);
        return (
          <section key={kind} aria-label={t(KIND_LABEL[kind])} className="flex flex-col border border-border">
            <h4 className="border-b border-border px-3 py-1.5 text-[13px] font-bold">{t(KIND_LABEL[kind])}</h4>
            <ul className="flex flex-col">
              {tools.map((tool) => (
                <li key={tool.name} className="flex flex-col gap-0.5 border-b border-border px-3 py-2 last:border-b-0" data-assistant-tool={tool.name}>
                  <span className="font-mono text-[12px]">{tool.name}</span>
                  <span className="text-[13px]">{t(tool.words)}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <section aria-label={scope.title} className="flex flex-col gap-1" data-assistant-scope="">
        <h3 className="sb-label">{scope.title}</h3>
        <ul className="flex flex-col gap-1">
          {scope.lines.map((line) => (
            <li key={line} className="text-[13px]">
              {line}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
