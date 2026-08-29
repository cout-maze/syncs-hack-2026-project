import type { ReactNode } from 'react';

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper-50 bg-blueprint px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <p className="font-display text-[11px] font-extrabold tracking-[0.3em] text-ink uppercase">
            The Missing Block
          </p>
          <h1 className="mt-3 text-3xl font-extrabold text-balance">{title}</h1>
          <p className="mt-1.5 text-sm text-balance text-muted">{subtitle}</p>
        </div>

        <div className="rounded-card bg-paper-0 p-7 shadow-2xl shadow-black/10 ring-[1.5px] ring-black/15">
          {children}
        </div>

        <p className="mt-5 text-center text-sm text-muted">{footer}</p>
      </div>
    </div>
  );
}
