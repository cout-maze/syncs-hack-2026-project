import { useNavigate } from 'react-router-dom';

const FEATURES = [
  {
    number: '01',
    title: 'Build it visually',
    body: 'Place homes, transport, healthcare, parks and shared services on a living city map. Complex planning choices become tangible and easy to understand.',
  },
  {
    number: '02',
    title: 'Test the consequences',
    body: 'Simulation follows real needs through the city and reveals where access, resilience or inclusion breaks down before a decision is made.',
  },
  {
    number: '03',
    title: 'Decide together',
    body: 'Turn an issue into a visible proposal, then let the community rate it across six qualities. Real outcomes come from citizen votes—not an algorithm.',
  },
];

export function AboutPage() {
  const navigate = useNavigate();

  return (
    <main className="fixed inset-0 z-[250] overflow-y-auto bg-paper-50 bg-blueprint">
      <div className="mx-auto flex min-h-full max-w-6xl flex-col px-6 pt-24 pb-10 sm:px-10 lg:px-16">
        <section className="grid flex-1 items-center gap-12 py-8 lg:grid-cols-[1.2fr_0.8fr] lg:py-16">
          <div>
            <p className="mb-5 text-xs font-extrabold tracking-[0.14em] text-honey-deep uppercase">
              About The Missing Block
            </p>
            <h1 className="max-w-4xl text-balance text-5xl leading-[0.98] sm:text-6xl lg:text-7xl">
              Better cities begin when everyone can see the trade-offs.
            </h1>
            <p className="mt-7 max-w-2xl text-balance text-lg leading-8 text-muted sm:text-xl">
              The Missing Block is a visual civic-planning platform that helps people build,
              test and improve a city together—one block at a time.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="rounded-pill bg-ink px-6 py-3 text-sm font-bold text-paper-0 transition-transform hover:-translate-y-0.5"
              >
                Return to your city
              </button>
              <button
                type="button"
                onClick={() => navigate('/propose')}
                className="rounded-pill bg-honey px-6 py-3 text-sm font-bold text-ink transition-transform hover:-translate-y-0.5"
              >
                Explore proposals
              </button>
            </div>
          </div>

          <aside className="rounded-card bg-ink p-8 text-paper-0 shadow-2xl shadow-black/15 sm:p-10">
            <span className="text-4xl" aria-hidden="true">◇</span>
            <h2 className="mt-10 text-2xl text-paper-0">The main selling point</h2>
            <p className="mt-4 text-lg leading-8 text-paper-300">
              It makes the impact of planning decisions visible before they become permanent.
              Instead of debating abstract ideas, people can see a proposed change, test who it
              helps, discover who it leaves behind and make a better-informed choice together.
            </p>
          </aside>
        </section>

        <section aria-labelledby="why-it-works" className="py-12 lg:py-20">
          <div className="mb-8 max-w-2xl">
            <p className="text-xs font-extrabold tracking-[0.14em] text-beacon uppercase">
              Why it is useful
            </p>
            <h2 id="why-it-works" className="mt-3 text-3xl sm:text-4xl">
              From an idea to an informed decision
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {FEATURES.map((feature) => (
              <article key={feature.number} className="rounded-card bg-paper-0 p-7 ring-1 ring-black/10 sm:p-8">
                <span className="text-xs font-extrabold tracking-widest text-faint">{feature.number}</span>
                <h3 className="mt-8 text-xl">{feature.title}</h3>
                <p className="mt-3 leading-7 text-muted">{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="my-8 rounded-card bg-honey px-7 py-10 sm:px-10 lg:flex lg:items-end lg:justify-between lg:gap-12">
          <div className="max-w-3xl">
            <p className="text-xs font-extrabold tracking-[0.14em] text-honey-deep uppercase">
              Why it is good
            </p>
            <h2 className="mt-3 text-3xl sm:text-4xl">Clear, inclusive and accountable by design.</h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-fog">
              The experience is approachable enough to learn by playing, but rigorous enough to
              expose real trade-offs. The advisor explains evidence in plain language; it never
              decides. Simulation data stays separate from civic votes, so people—not AI—remain
              responsible for the outcome.
            </p>
          </div>
          <p className="mt-8 shrink-0 font-display text-sm font-extrabold tracking-tight lg:mt-0">
            BUILD → TEST → DISCOVER → REBUILD
          </p>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line-bright py-7 text-sm text-muted">
          <p>Built for more understandable, participatory cities.</p>
          <p className="font-bold text-ink">The Missing Block</p>
        </footer>
      </div>
    </main>
  );
}
