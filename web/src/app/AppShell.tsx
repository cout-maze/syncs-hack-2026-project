import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useActiveCity } from './ActiveCityProvider';
import { Button } from '@/components/ui/Button';
import { cx } from '@/lib/format';
import { API_MODE } from '@/lib/env';

/**
 * The app shell: brand, city switcher, the mode switch, and the account control.
 *
 * Two modes, not four tabs. Both render the same city-builder map; only the panel
 * beside it changes. FE #2 and FE #3 plug their panels in via routes.tsx - nothing
 * else in here should need to change as features land.
 */

const MODES = [
  { to: '/simulate', label: 'Simulation', hint: 'Learn how it works' },
  { to: '/propose', label: 'Proposal', hint: 'Decide together' },
] as const;

export function AppShell() {
  const { user, logout } = useAuth();
  const { cities, cityId, select, createCity, isCreating } = useActiveCity();

  return (
    <div className="flex min-h-dvh flex-col bg-ink-950">
      <header className="sticky top-0 z-30 border-b border-line bg-ink-950/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-4 px-4">
          <div className="flex items-baseline gap-2">
            <span aria-hidden="true" className="text-lg">
              {'\u{1F9F1}'}
            </span>
            <span className="font-display text-sm font-extrabold tracking-tight text-cream">
              Rebuild My City
            </span>
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            <span className="h-4 w-px bg-line-bright" aria-hidden="true" />
            <label htmlFor="city-switcher" className="sr-only">
              Active city
            </label>
            <select
              id="city-switcher"
              value={cityId ?? ''}
              onChange={(event) => select(event.target.value)}
              className="h-8 max-w-44 truncate rounded-lg border border-line-bright bg-ink-900 px-2 text-sm text-cream"
            >
              {cities.length === 0 && <option value="">No cities yet</option>}
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="ghost"
              loading={isCreating}
              onClick={() => void createCity()}
              title="Create a new city"
            >
              + New
            </Button>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {API_MODE !== 'real' && (
              <span
                title={`API mode: ${API_MODE}`}
                className="hidden rounded-pill border border-apricot/35 bg-apricot/10 px-2 py-0.5 text-[11px] font-semibold text-apricot md:inline"
              >
                {API_MODE} data
              </span>
            )}
            <span className="hidden text-sm text-muted sm:inline">{user?.displayName}</span>
            <Button size="sm" variant="secondary" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>

        <nav aria-label="Mode" className="mx-auto w-full max-w-[1600px] px-4">
          <ul className="-mb-px flex gap-1 overflow-x-auto">
            {MODES.map((mode) => (
              <li key={mode.to}>
                <NavLink
                  to={mode.to}
                  className={({ isActive }) =>
                    cx(
                      'flex items-baseline gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors',
                      isActive
                        ? 'border-apricot text-cream'
                        : 'border-transparent text-muted hover:text-fog',
                    )
                  }
                >
                  {mode.label}
                  <span className="text-[10px] font-bold tracking-widest uppercase opacity-50">
                    {mode.hint}
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}
