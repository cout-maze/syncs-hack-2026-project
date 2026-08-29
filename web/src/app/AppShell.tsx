import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CityWorkspace } from '@/features/builder/CityWorkspace';
import { BudgetPill } from '@/features/builder/BudgetPill';
import { SimulationMode } from '@/features/simulation/SimulationMode';
import { useCityScene } from '@/features/builder/scene/useCityScene';
import { FloatingWindow } from '@/components/ui/FloatingWindow';
import { AppMenu } from './AppMenu';
import { IntroCurtain } from './IntroCurtain';
import { cx } from '@/lib/format';

/**
 * The shell is the map, plus things that float over it.
 *
 * There is no header, no sidebar and no tab strip. The map fills the viewport and
 * mounts once; Simulation and Proposal are floating windows that can both be open at
 * the same time, dragged around by their title bars, and closed without disturbing
 * anything on the map.
 *
 * Why the two windows are opened differently: the Simulation window is pure local
 * state, because nothing inside it is addressable. The Proposal window is driven by
 * the URL, because a proposal *is* addressable (`/propose/prp_garden1`) and FE #3's
 * detail view navigates between proposals. Both still float, and both can be open
 * together.
 */

const SIM_ACCENT = 'var(--color-beacon)';
const PROPOSAL_ACCENT = 'var(--color-honey-deep)';

export function AppShell() {
  const [simulationOpen, setSimulationOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const proposalsOpen = location.pathname.startsWith('/propose');
  // The scene only registers once it has drawn itself, so this is the honest
  // "the map is up" signal the intro curtain waits on.
  const mapReady = useCityScene() !== null;

  return (
    <div className="fixed inset-0 overflow-hidden bg-paper-50">
      <CityWorkspace>
        {/* ------------------------------------------------- menu, top left */}
        <div className="fixed top-3 left-3 z-[200]">
          <AppMenu />
        </div>

        {/* ----------------------------------------------- name, top centre
            Hidden below xl, where the menu and the mode cluster would collide with
            it. The intro curtain and the tab title still carry the name there. */}
        <div className="pointer-events-none fixed inset-x-0 top-3 z-20 hidden justify-center xl:flex">
          <h1 className="font-display text-base font-extrabold tracking-tight text-ink drop-shadow-[0_1px_3px_rgba(255,255,255,0.9)]">
            The Missing Block
          </h1>
        </div>

        {/* ------------------------- modes + budget, one cluster top right */}
        <div className="fixed top-3 right-3 z-[200] flex items-center gap-2">
          <ModeButton
            label="Simulation"
            hint="Learn how it works"
            glyph={'\u{1F52C}'}
            active={simulationOpen}
            accent={SIM_ACCENT}
            onClick={() => setSimulationOpen((current) => !current)}
          />
          <ModeButton
            label="Proposals"
            hint="Decide together"
            glyph={'\u{1F5F3}'}
            active={proposalsOpen}
            accent={PROPOSAL_ACCENT}
            onClick={() => navigate(proposalsOpen ? '/' : '/propose')}
          />
          <BudgetPill />
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

      {/* Sits outside the workspace so it covers the loading state too. */}
      <IntroCurtain ready={mapReady} />
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
        'flex h-[52px] items-center gap-2 rounded-xl border py-2 pr-3.5 pl-3 transition-colors',
        'bg-paper-0/90 shadow-lg shadow-black/15 backdrop-blur-md',
        active ? 'border-transparent text-ink' : 'border-line-bright text-fog hover:bg-paper-100',
      )}
      style={active ? { borderColor: accent, backgroundColor: `${accent}1f` } : undefined}
    >
      <span aria-hidden="true" className="text-base">
        {glyph}
      </span>
      <span className="text-sm font-semibold">{label}</span>
    </button>
  );
}
