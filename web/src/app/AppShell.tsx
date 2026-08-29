import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CityWorkspace } from '@/features/builder/CityWorkspace';
import { BudgetPill } from '@/features/builder/BudgetPill';
import { SimulationMode } from '@/features/simulation/SimulationMode';
import { AccessMode } from '@/features/access/AccessMode';
import { useCityScene } from '@/features/builder/scene/useCityScene';
import { FloatingWindow } from '@/components/ui/FloatingWindow';
import { AppMenu } from './AppMenu';
import { IntroCurtain } from './IntroCurtain';
import { ProposalMapBackground } from '@/features/proposals/ProposalMode';
import { cx } from '@/lib/format';

/**
 * The shell is the map, plus things that float over it.
 *
 * There is no header, no sidebar and no tab strip. The map fills the viewport and
 * mounts once; Simulation and Proposal are floating windows that can both be open at
 * the same time, dragged around by their title bars, and closed without disturbing
 * anything on the map.
 *
 * Why the windows are opened differently: Simulation is pure local state, because
 * nothing inside it is addressable. The Proposal window is driven by the URL, because
 * a proposal *is* addressable (`/propose/prp_garden1`) and FE #3's detail view navigates
 * between proposals. Both still float, and both can be open together.
 *
 * Access isn't a mode window at all - there's no button for it. It's a corner popup
 * that appears on its own whenever a home is selected on either map, the same way the
 * selected-block card appears bottom-left. See features/access/AccessMode.tsx.
 */

const SIM_ACCENT = 'var(--color-beacon)';
const PROPOSAL_ACCENT = 'var(--color-honey)';
/** Text laid over each accent when its mode is active - amber needs black, blue white. */
const SIM_ON_ACCENT = '#ffffff';
const PROPOSAL_ON_ACCENT = '#000000';

export function AppShell() {
  const [simulationOpen, setSimulationOpen] = useState(false);
  // Closing the Proposals window (X, or Escape) only hides it - it does not leave the
  // council map. `proposalsOpen` (route-driven) still owns which map is mounted;
  // this just owns whether the window on top of it is showing. Only switching to
  // Simulation actually leaves Proposal mode.
  const [proposalWindowOpen, setProposalWindowOpen] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();

  const proposalsOpen = location.pathname.startsWith('/propose');
  // The scene only registers once it has drawn itself, so this is the honest
  // "the map is up" signal the intro curtain waits on.
  const cityScene = useCityScene();
  // Proposal mode owns a separate local canvas, so it must not wait for the
  // Simulation scene to register before dismissing the app intro.
  const mapReady = proposalsOpen || cityScene !== null;

  return (
    <div className="fixed inset-0 overflow-hidden bg-paper-50">
      <CityWorkspace interactive={!proposalsOpen} mapVisible={!proposalsOpen}>
        {proposalsOpen && <ProposalMapBackground />}
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
            onAccent={SIM_ON_ACCENT}
            onClick={() => {
              if (proposalsOpen) navigate('/');
              setSimulationOpen((current) => !current);
            }}
          />
          <ModeButton
            label="Proposals"
            hint="Decide together"
            glyph={'\u{1F5F3}'}
            active={proposalsOpen}
            accent={PROPOSAL_ACCENT}
            onAccent={PROPOSAL_ON_ACCENT}
            onClick={() => {
              setSimulationOpen(false);
              if (!proposalsOpen) {
                navigate('/propose');
                setProposalWindowOpen(true);
              } else {
                // Already on the council map - the button just toggles the window,
                // same as the X, and never navigates away.
                setProposalWindowOpen((current) => !current);
              }
            }}
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
            initial={{ x: 0, y: 0.09 }}
            onClose={() => setSimulationOpen(false)}
          >
            <SimulationMode />
          </FloatingWindow>
        )}

        {/* Corner popup, not a mode window - shows itself when a home is selected. */}
        <AccessMode />

        {proposalsOpen && proposalWindowOpen && (
          <FloatingWindow
            title="Proposals"
            subtitle="Outcomes come from citizen votes"
            accent={PROPOSAL_ACCENT}
            width={440}
            initial={{ x: 0, y: 0.09 }}
            onClose={() => setProposalWindowOpen(false)}
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
  onAccent,
  onClick,
}: {
  label: string;
  hint: string;
  glyph: string;
  active: boolean;
  accent: string;
  /** Text colour once the accent fills the button. */
  onAccent: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={hint}
      className={cx(
        'flex h-[52px] items-center gap-2 rounded-pill py-2 pr-5 pl-4 transition-colors',
        'shadow-lg shadow-black/12 ring-[1.5px] ring-black/15 backdrop-blur-md',
        active ? '' : 'bg-paper-0/90 text-ink hover:bg-paper-100',
      )}
      style={active ? { backgroundColor: accent, color: onAccent } : undefined}
    >
      <span aria-hidden="true" className="text-base">
        {glyph}
      </span>
      <span className="text-sm font-bold">{label}</span>
    </button>
  );
}
