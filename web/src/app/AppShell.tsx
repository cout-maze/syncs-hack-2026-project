import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CityWorkspace } from '@/features/builder/CityWorkspace';
import { SimulationMode } from '@/features/simulation/SimulationMode';
import { AccessMode } from '@/features/access/AccessMode';
import { FloatingWindow } from '@/components/ui/FloatingWindow';
import { AppMenu } from './AppMenu';
import { cx } from '@/lib/format';

/**
 * The shell is the map, plus things that float over it.
 *
 * There is no header, no sidebar and no tab strip. The map fills the viewport and
 * mounts once; Simulation and Proposal are floating windows that can both be open at
 * the same time, dragged around by their title bars, and closed without disturbing
 * anything on the map.
 *
 * Why the windows are opened differently: Simulation and Access are pure local
 * state, because nothing inside them is addressable. The Proposal window is driven by
 * the URL, because a proposal *is* addressable (`/propose/prp_garden1`) and FE #3's
 * detail view navigates between proposals. All three still float, and all three can be
 * open together.
 */

const SIM_ACCENT = 'var(--color-beacon)';
const PROPOSAL_ACCENT = 'var(--color-apricot)';
const ACCESS_ACCENT = 'var(--color-metric-accessibility)';

export function AppShell() {
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const proposalsOpen = location.pathname.startsWith('/propose');

  return (
    <div className="fixed inset-0 overflow-hidden bg-ink-950">
      <CityWorkspace>
        {/* ------------------------------------------------- menu, top left */}
        <div className="fixed top-3 left-3 z-[200]">
          <AppMenu />
        </div>

        {/* ----------------------------------------------- name, top centre */}
        <div className="pointer-events-none fixed inset-x-0 top-3 z-20 flex justify-center">
          <h1 className="font-display text-base font-extrabold tracking-tight text-cream drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
            The Missing Block
          </h1>
        </div>

        {/* --------------------------------- mode buttons, above the dock */}
        <div className="fixed right-3 bottom-[124px] z-[200] flex flex-col items-end gap-2">
          <ModeButton
            label="Simulation"
            hint="Learn how it works"
            glyph={'\u{1F52C}'}
            active={simulationOpen}
            accent={SIM_ACCENT}
            onClick={() => setSimulationOpen((current) => !current)}
          />
          <ModeButton
            label="Access"
            hint="Who can reach what"
            glyph={'\u{1F6A6}'}
            active={accessOpen}
            accent={ACCESS_ACCENT}
            onClick={() => setAccessOpen((current) => !current)}
          />
          <ModeButton
            label="Proposals"
            hint="Decide together"
            glyph={'\u{1F5F3}'}
            active={proposalsOpen}
            accent={PROPOSAL_ACCENT}
            onClick={() => navigate(proposalsOpen ? '/' : '/propose')}
          />
        </div>

        {/* --------------------------------------------- floating windows */}
        {simulationOpen && (
          <FloatingWindow
            title="Simulation"
            subtitle="Nothing here is stored or submitted"
            accent={SIM_ACCENT}
            width={420}
            initial={{ x: 0.26, y: 0.09 }}
            onClose={() => setSimulationOpen(false)}
          >
            <SimulationMode />
          </FloatingWindow>
        )}

        {accessOpen && (
          <FloatingWindow
            title="Access"
            subtitle="Per home: who lives there, what they must reach"
            accent={ACCESS_ACCENT}
            width={430}
            initial={{ x: 0.5, y: 0.12 }}
            onClose={() => setAccessOpen(false)}
          >
            <AccessMode />
          </FloatingWindow>
        )}

        {proposalsOpen && (
          <FloatingWindow
            title="Proposals"
            subtitle="Outcomes come from citizen votes"
            accent={PROPOSAL_ACCENT}
            width={440}
            initial={{ x: 0.74, y: 0.09 }}
            onClose={() => navigate('/')}
          >
            <Outlet />
          </FloatingWindow>
        )}
      </CityWorkspace>
    </div>
  );
}

function ModeButton({
  label,
  hint,
  glyph,
  active,
  accent,
  onClick,
}: {
  label: string;
  hint: string;
  glyph: string;
  active: boolean;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={hint}
      className={cx(
        'group flex items-center gap-2.5 rounded-xl border py-2 pr-3 pl-2.5 transition-colors',
        'bg-ink-900/85 shadow-lg shadow-black/40 backdrop-blur-md',
        active ? 'border-transparent text-cream' : 'border-line-bright text-fog hover:bg-ink-800',
      )}
      style={active ? { borderColor: accent, backgroundColor: `${accent}1f` } : undefined}
    >
      <span aria-hidden="true" className="text-base">
        {glyph}
      </span>
      <span className="text-left">
        <span className="block text-sm leading-tight font-semibold">{label}</span>
        <span className="block text-[10px] leading-tight tracking-wide text-muted uppercase">
          {hint}
        </span>
      </span>
    </button>
  );
}
