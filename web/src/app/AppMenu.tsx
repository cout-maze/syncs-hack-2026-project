import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useActiveCity } from './ActiveCityProvider';
import { API_MODE } from '@/lib/env';
import { cx } from '@/lib/format';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Everything that is not the map.
 *
 * The city switcher, "new city" and sign out all used to sit in a header bar. They are
 * infrequent actions, so they live behind one button in the corner instead and the map
 * gets the whole screen.
 */
export function AppMenu() {
  const { user, logout } = useAuth();
  const { cities, cityId, createCity, isCreating } = useActiveCity();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
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
          'grid size-11 place-items-center rounded-full transition-colors',
          'shadow-lg shadow-black/12 ring-[1.5px] ring-black/15 backdrop-blur-md',
          open ? 'bg-ink text-paper-0' : 'bg-paper-0/90 text-ink hover:bg-paper-100',
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
          className="absolute top-[calc(100%+10px)] left-0 w-64 overflow-hidden rounded-card bg-paper-0/95 shadow-2xl shadow-black/15 ring-[1.5px] ring-black/15 backdrop-blur-md"
        >
          <div className="bg-paper-100 px-5 py-4">
            <p className="text-sm font-bold text-ink">{user?.displayName}</p>
            <p className="truncate text-xs text-muted">{user?.email}</p>
          </div>

          {/* The city is named in the centre of the screen now, so this is a readout
              rather than a picker - no switcher, just what you are working on. */}
          <div className="flex flex-col gap-1 px-5 py-4">
            <p className="text-[11px] font-extrabold tracking-[0.08em] text-muted uppercase">
              City
            </p>
            <p className="truncate text-sm font-bold text-ink">
              {activeCity?.name ?? 'No city yet'}
            </p>
            {activeCity && (
              <p className="text-xs text-muted">
                {activeCity.blocksUsed} of {activeCity.blockBudget} blocks used
              </p>
            )}
          </div>

          <div className="flex flex-col gap-0.5 px-2.5 pb-2.5">
            <MenuItem
              onClick={() => {
                navigate(location.pathname === '/about' ? '/' : '/about');
                setOpen(false);
              }}
            >
              {location.pathname === '/about' ? 'Back to city' : 'About'}
            </MenuItem>
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
            <p className="bg-paper-100 px-5 py-2.5 text-[11px] text-muted">
              Running on <span className="font-bold text-ink">{API_MODE}</span> data
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
        'rounded-pill px-3.5 py-2.5 text-left text-sm font-bold transition-colors disabled:opacity-40',
        tone === 'danger' ? 'text-bad hover:bg-bad/12' : 'text-fog hover:bg-paper-100 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
