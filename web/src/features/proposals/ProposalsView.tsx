import { useEffect, useState } from "react";
import { METRIC_LABELS, type MetricName } from "@rmc/shared";
import { api } from "../../api/client";

type MetricVote = { metric: MetricName; support: boolean };
type VotingResults = {
  totalVoters: number;
  overallApprovalPct: number;
  outcomeIfClosedNow: string;
  metricResults: Array<{
    metric: MetricName;
    supportCount: number;
    opposeCount: number;
    supportPct: number;
  }>;
};
type Proposal = {
  id: string;
  title: string;
  description: string;
  blockCost: number;
  expectedBenefits?: string[];
  affectedPersonaIds?: string[];
  votingMetrics: MetricName[];
  status: string;
  results: VotingResults;
  myVotes?: MetricVote[] | null;
};

export function ProposalsView() {
  const [list, setList] = useState<Proposal[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Proposal | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);

  async function refreshList() {
    setList(await api<Proposal[]>("/proposals"));
  }

  useEffect(() => {
    refreshList().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!openId) return;
    let cancelled = false;
    api<Proposal>(`/proposals/${openId}`)
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch(() => undefined);
    const timer = window.setInterval(() => {
      api<VotingResults>(`/proposals/${openId}/results`)
        .then((results) => {
          if (!cancelled) setDetail((current) => (current ? { ...current, results } : current));
        })
        .catch(() => undefined);
    }, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [openId]);

  async function vote(proposal: Proposal, metric: MetricName, support: boolean) {
    const current = new Map((proposal.myVotes ?? []).map((item) => [item.metric, item.support]));
    current.set(metric, support);
    const votes = proposal.votingMetrics.map((name) => ({
      metric: name,
      support: current.get(name) ?? true,
    }));
    const result = await api<{ myVotes: MetricVote[]; results: VotingResults }>(
      `/proposals/${proposal.id}/votes`,
      { method: "PUT", body: JSON.stringify({ votes }) },
    );
    setDetail({ ...proposal, myVotes: result.myVotes, results: result.results });
    refreshList().catch(() => undefined);
  }

  async function explain(proposal: Proposal) {
    const body = await api<{ explanation: string; communityReadout?: string | null }>(
      "/advisor/proposal-explanation",
      {
        method: "POST",
        body: JSON.stringify({ proposalId: proposal.id, votingResults: proposal.results }),
      },
    );
    setExplanation([body.explanation, body.communityReadout].filter(Boolean).join(" "));
  }

  const view = detail && detail.id === openId ? detail : null;

  return (
    <div className="panel">
      <header>
        <p className="eyebrow">Citizens get a say</p>
        <h2>Council proposes. The community scores it.</h2>
        <p>Outcomes come from votes — never from the Advisor.</p>
      </header>
      <div className="proposal-grid">
        {list.map((proposal) => (
          <button key={proposal.id} type="button" className="card buttony" onClick={() => setOpenId(proposal.id)}>
            <h3>{proposal.title}</h3>
            <p>
              {proposal.results.overallApprovalPct}% · {proposal.status} · {proposal.results.totalVoters} voters
            </p>
          </button>
        ))}
      </div>
      {view ? (
        <article className="card">
          <h3>{view.title}</h3>
          <p>{view.description}</p>
          <p>
            Cost {view.blockCost} blocks
            {view.expectedBenefits?.length ? ` · ${view.expectedBenefits.join(", ")}` : ""}
          </p>
          <p>
            {view.results.overallApprovalPct}% overall · {view.results.totalVoters} voters · if closed now:{" "}
            {view.results.outcomeIfClosedNow}
          </p>
          <ul className="vote-list">
            {view.votingMetrics.map((metric) => {
              const row = view.results.metricResults.find((item) => item.metric === metric);
              const mine = view.myVotes?.find((item) => item.metric === metric)?.support;
              return (
                <li key={metric}>
                  <div className="vote-row">
                    <span>{METRIC_LABELS[metric]}</span>
                    <strong>
                      {row?.supportPct ?? 0}% ({row?.supportCount ?? 0} yes / {row?.opposeCount ?? 0} no)
                    </strong>
                  </div>
                  <div className="row">
                    <button type="button" className={mine === true ? "primary" : "ghost"} onClick={() => vote(view, metric, true)}>
                      Support
                    </button>
                    <button type="button" className={mine === false ? "primary" : "ghost"} onClick={() => vote(view, metric, false)}>
                      Oppose
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <button type="button" className="ghost" onClick={() => explain(view)}>
            Explain this proposal
          </button>
          {explanation ? <p>{explanation}</p> : null}
        </article>
      ) : null}
    </div>
  );
}
