import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useActiveCity } from './ActiveCityProvider';
import { API_MODE } from '@/lib/env';
import { cx } from '@/lib/format';

/**
 * Everything that is not the map.
 *
 * The city switcher, "new city" and sign out all used to sit in a header bar. They are
 * infrequent actions, so they live behind one button in the corner instead and the map
 * gets the whole screen.
 */
export function AppMenu() {
  const { user, logout } = useAuth();
  const { cities, cityId, select, createCity, isCreating } = useActiveCity();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const activeCity = cities.find((city) => city.id === cityId);

  return (
    <div ref={containerRef} className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Menu"
        className={cx(
          'grid size-10 place-items-center rounded-xl border transition-colors',
          'bg-paper-0/90 shadow-lg shadow-black/15 backdrop-blur-md',
          open
            ? 'border-honey-deep text-honey-deep'
            : 'border-line-bright text-fog hover:border-honey-deep/60 hover:text-ink',
        )}
      >
        <svg viewBox="0 0 18 18" className="size-4.5" aria-hidden="true">
          <path
            d="M2 4.5h14M2 9h14M2 13.5h14"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-[calc(100%+8px)] left-0 w-64 overflow-hidden rounded-card border border-line-bright bg-paper-0/95 shadow-2xl shadow-black/20 backdrop-blur-md"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-ink">{user?.displayName}</p>
            <p className="truncate text-xs text-muted">{user?.email}</p>
          </div>

          <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
            <label
              htmlFor="city-switcher"
              className="text-[11px] font-bold tracking-wide text-muted uppercase"
            >
              City
            </label>
            <select
              id="city-switcher"
              value={cityId ?? ''}
              onChange={(event) => select(event.target.value)}
              className="h-9 w-full truncate rounded-lg border border-line-bright bg-paper-50 px-2 text-sm text-ink"
            >
              {cities.length === 0 && <option value="">No cities yet</option>}
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
            {activeCity && (
              <p className="text-xs text-muted">
                {activeCity.blocksUsed} of {activeCity.blockBudget} blocks used
              </p>
            )}
          </div>

          <div className="flex flex-col p-1.5">
            <MenuItem
              onClick={() => {
                void createCity();
                setOpen(false);
              }}
              disabled={isCreating}
            >
              {isCreating ? 'Creating...' : 'New city'}
            </MenuItem>
            <MenuItem onClick={logout} tone="danger">
              Sign out
            </MenuItem>
          </div>

          {API_MODE !== 'real' && (
            <p className="border-t border-line px-4 py-2 text-[11px] text-faint">
              Running on <span className="font-semibold text-honey-deep">{API_MODE}</span> data
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
  tone = 'normal',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'normal' | 'danger';
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'rounded-lg px-2.5 py-2 text-left text-sm font-semibold transition-colors disabled:opacity-50',
        tone === 'danger'
          ? 'text-bad hover:bg-bad/15'
          : 'text-fog hover:bg-paper-100 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
