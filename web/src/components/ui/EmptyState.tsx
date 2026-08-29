import type { ReactNode } from 'react';

export function EmptyState({
  glyph = '\u{1F9F1}',
  title,
  description,
  action,
}: {
  glyph?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span aria-hidden="true" className="text-4xl opacity-70">
        {glyph}
      </span>
      <h3 className="text-lg font-bold">{title}</h3>
      {description && <p className="max-w-sm text-sm text-balance text-muted">{description}</p>}
      {action}
    </div>
  );
}
