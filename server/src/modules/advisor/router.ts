import { Router } from "express";
import { advisorAnalysisBodySchema, advisorReportSchema, type MetricName } from "@rmc/shared";
import { requireUser } from "../../lib/auth";
import { HttpError } from "../../lib/errors";
import { store } from "../../lib/store";
import { publicProposal } from "../../lib/voting";

export const advisorRouter = Router();

function fallbackAnalysis(body: ReturnType<typeof advisorAnalysisBodySchema.parse>) {
  const metrics = body.simulation.metrics;
  const weakest = (Object.entries(metrics) as [MetricName, number][]).sort((a, b) => a[1] - b[1])[0];
  const failed = body.simulation.journeys.filter((journey) => !journey.accessible);
  const groups = failed.slice(0, 4).map((journey) => ({
    personaId: journey.personaId,
    impact: journey.issues?.[0] ?? `Cannot reach ${journey.targetService.replaceAll("_", " ")}.`,
  }));
  const hasTransport = body.city.blocks.some((block) => block.typeId === "transport");
  const techHeavy = body.city.blocks.filter((block) => block.typeId === "technology_hub").length >= 2;
  return advisorReportSchema.parse({
    headline:
      failed[0] != null
        ? `${failed.length} resident journey${failed.length === 1 ? "" : "s"} fail accessibility checks.`
        : `The weakest city metric is ${weakest[0]} (${weakest[1]}/100).`,
    biggestWeakness: {
      metric: weakest[0],
      explanation: `The layout scores ${weakest[1]} on ${weakest[0]}. Placement — not a missing feature — is the constraint.`,
    },
    affectedGroups: groups.length
      ? groups
      : [{ personaId: "limited_digital_access", impact: "Digital-heavy layouts leave in-person residents behind." }],
    tradeoffs: [
      techHeavy
        ? "Technology hubs buy efficiency, but participation then depends on being online."
        : "Every block you place is a block you cannot place somewhere else.",
    ],
    suggestions: [
      {
        title: "Move healthcare closer to housing",
        description:
          "Shift the healthcare block one or two cells toward the housing cluster so older residents and wheelchair users have a shorter journey.",
        expectedImpact: ["accessibility", "inclusion"],
      },
      ...(!hasTransport
        ? [
            {
              title: "Add a transport spine",
              description: "Connect housing to essential services instead of filling the gap with more buildings.",
              expectedImpact: ["accessibility", "resilience"] as MetricName[],
            },
          ]
        : [
            {
              title: "Add a community hub near housing",
              description: "Give residents who cannot or do not use digital services a place that still works in person.",
              expectedImpact: ["community", "inclusion"] as MetricName[],
            },
          ]),
    ].slice(0, 3),
    fallback: true,
  });
}

async function callClaude(system: string, user: string) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
        max_tokens: 800,
        temperature: 0.3,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { content?: Array<{ text?: string }> };
    const text = data.content?.[0]?.text ?? "";
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

advisorRouter.post("/advisor/analysis", async (req, res, next) => {
  try {
    requireUser(req);
    const body = advisorAnalysisBodySchema.parse(req.body);
    const parsed = await callClaude(
      "You are the City Advisor in Rebuild My City. Return JSON only matching {headline, biggestWeakness:{metric,explanation}, affectedGroups:[{personaId,impact}], tradeoffs?:string[], suggestions:[{title,description,expectedImpact?:string[]}], fallback:false}. Never assign proposal voting scores. Metrics must be one of accessibility,sustainability,efficiency,community,resilience,inclusion.",
      JSON.stringify(body),
    );
    if (parsed) {
      const report = advisorReportSchema.safeParse({ ...parsed, fallback: false });
      if (report.success) {
        res.json(report.data);
        return;
      }
    }
    res.json(fallbackAnalysis(body));
  } catch (error) {
    next(error);
  }
});

advisorRouter.post("/advisor/proposal-explanation", async (req, res, next) => {
  try {
    requireUser(req);
    const proposalId = String(req.body?.proposalId ?? "");
    const proposal = store.read().proposals.find((row) => row.id === proposalId);
    if (!proposal) throw new HttpError(404, "NOT_FOUND", "Proposal not found.");
    const results = req.body?.votingResults ?? publicProposal(proposal, store.read().votes).results;
    const fallback = {
      explanation: `${proposal.title}: ${proposal.description} Cost: ${proposal.blockCost} blocks.`,
      tradeoffs: proposal.expectedBenefits?.length
        ? [`Likely benefit: ${proposal.expectedBenefits.join(", ")}.`]
        : ["The change uses limited grid space that could go to another service."],
      communityReadout: results
        ? `Support is currently ${results.overallApprovalPct}% overall across ${results.totalVoters} voters.`
        : null,
      fallback: true,
    };
    const parsed = await callClaude(
      "Explain a civic proposal in plain language. Return JSON {explanation, tradeoffs?:string[], communityReadout?:string|null, fallback:false}. Describe voting results if provided. Never predict scores or tell people how to vote. Never invent metrics.",
      JSON.stringify({ proposal, votingResults: results }),
    );
    if (parsed && typeof parsed === "object") {
      res.json({ ...fallback, ...parsed, fallback: false });
      return;
    }
    res.json(fallback);
  } catch (error) {
    next(error);
  }
});
