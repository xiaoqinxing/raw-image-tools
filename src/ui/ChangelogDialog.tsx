import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useStore } from '../state/store';
import { BUILD_INFO } from '../build-info';

export function ChangelogDialog() {
  const open = useStore((s) => s.showChangelog);
  const setOpen = useStore((s) => s.setShowChangelog);
  if (!open) return null;
  const { version, packageVersion, commit, shortCommit, date, commitCount, repository, changelog } = BUILD_INFO;
  const commitUrl = (sha: string) => (repository ? `${repository}/commit/${sha}` : '');
  return (
    <Dialog.Root open onOpenChange={(value) => { if (!value) setOpen(false); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content className="modal modal-center w-[560px]" aria-describedby={undefined} data-testid="changelog-dialog">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-ink-700 px-4">
            <div>
              <Dialog.Title className="text-[13px] text-ink-100">更新日志</Dialog.Title>
              <div className="text-[10px] text-ink-500">版本号与提交记录由构建自动生成</div>
            </div>
            <button className="text-ink-400 hover:text-white" onClick={() => setOpen(false)} aria-label="关闭更新日志">✕</button>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink-700 px-4 py-2.5 text-[11px] text-ink-500">
            <span className="badge badge-ok mono">v{version}</span>
            {shortCommit ? (
              commitUrl(commit) ? (
                <a className="mono text-[#a8d2ff] hover:text-white" href={commitUrl(commit)} target="_blank" rel="noreferrer" title={commit}>{shortCommit}</a>
              ) : <span className="mono text-ink-300">{shortCommit}</span>
            ) : <span>无 Git 元数据</span>}
            {date ? <span className="mono">{date}</span> : null}
            <span>共 {commitCount} 次提交</span>
            {packageVersion !== version ? <span className="mono">基线 {packageVersion}</span> : null}
          </div>

          <div className="max-h-[min(58vh,520px)] overflow-auto scroll-thin p-2" data-testid="changelog-list">
            {changelog.length ? changelog.map((entry, index) => {
              const url = commitUrl(entry.sha);
              return (
                <div
                  key={entry.sha}
                  data-testid="changelog-entry"
                  className="flex items-baseline gap-2 rounded px-2 py-1.5 text-[11px] hover:bg-ink-850"
                >
                  <span className="mono w-[68px] shrink-0 text-[10px] text-ink-500">{entry.date}</span>
                  {url ? (
                    <a className="mono shrink-0 text-[10px] text-[#a8d2ff] hover:text-white" href={url} target="_blank" rel="noreferrer" title={entry.sha}>{entry.short}</a>
                  ) : (
                    <span className="mono shrink-0 text-[10px] text-ink-500">{entry.short}</span>
                  )}
                  <span className="min-w-0 flex-1 leading-4 text-ink-200">{entry.subject}</span>
                  {index === 0 ? <span className="badge badge-ok shrink-0">当前</span> : null}
                </div>
              );
            }) : (
              <div className="p-4 text-center text-[11px] leading-5 text-ink-500">
                当前构建未包含 Git 历史。请在完整 Git 仓库中重新构建，或检查 CI 的 checkout fetch-depth。
              </div>
            )}
          </div>

          <div className="border-t border-ink-700 px-4 py-2 text-[10px] leading-4 text-ink-500">
            版本号 = package.json 的 major.minor + Git 提交数；更新日志来自 <span className="mono">git log</span>，不需要手动维护。
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
