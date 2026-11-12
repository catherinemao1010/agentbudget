export type Call = {
  id: string;
  model: string;
  reserved_usd: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  latency_ms: number;
  status: string;
  created_at: string;
  pricing_version: string;
  note?: string;
};
export type Run = {
  id: string;
  name: string;
  agent: string;
  budget_usd: number;
  spent_usd: number;
  reserved_usd: number;
  status: string;
  created_at: string;
  is_demo: boolean;
  calls: Call[];
};
export const agents = [
  "Code reviewer",
  "Research assistant",
  "Support agent",
  "Documentation agent",
];
const names = [
  "Review pull request #128",
  "Research vector databases",
  "Resolve support ticket #402",
  "Update API documentation",
  "Audit authentication changes",
  "Compare retrieval strategies",
  "Summarize customer feedback",
  "Generate integration guide",
];
export function simulate(
  name: string,
  agent: string,
  budget: number,
  daysAgo = 0,
  index = 0,
): Run {
  const date = new Date(
    Date.now() - daysAgo * 86400000 - index * 1800000,
  ).toISOString();
  const r: Run = {
    id: crypto.randomUUID().slice(0, 8),
    name,
    agent,
    budget_usd: budget,
    spent_usd: 0,
    reserved_usd: 0,
    status: "completed",
    created_at: date,
    is_demo: true,
    calls: [],
  };
  for (let i = 0; i < 6 + (index % 4); i++) {
    const input = 6000 + index * 760 + i * 350,
      output = 1500 + (index % 5) * 240;
    const cost = ((input - 1000) * 0.4 + 1000 * 0.1 + output * 1.6) / 1e6;
    if (r.spent_usd + cost > budget) {
      r.status = "blocked";
      break;
    }
    r.spent_usd += cost;
    r.calls.push({
      id: `${r.id}-${i}`,
      model: "gpt-4.1-mini",
      reserved_usd: cost,
      cost_usd: cost,
      input_tokens: input,
      output_tokens: output,
      cached_tokens: 1000,
      latency_ms: 850 + (index % 5) * 190 + i * 80,
      status: "completed",
      created_at: date,
      pricing_version: "openai-standard-2026-11-11",
    });
  }
  return r;
}
export function seed(): Run[] {
  return Array.from({ length: 36 }, (_, i) => {
    const r = simulate(
      names[i % 8],
      agents[i % 4],
      i % 7 === 0 ? 0.025 : 0.25,
      Math.floor(i / 3),
      i % 3,
    );
    if (i % 13 === 3) r.status = "failed";
    return r;
  });
}
const KEY = "agentbudget-demo-v1";
export function loadDemo(): Run[] {
  try {
    const s = localStorage.getItem(KEY);
    if (s) {
      const d = JSON.parse(s);
      if (
        Array.isArray(d) &&
        d.every(
          (r) => Array.isArray(r.calls) && typeof r.spent_usd === "number",
        )
      )
        return d;
    }
  } catch {}
  return seed();
}
export function saveDemo(runs: Run[]) {
  localStorage.setItem(KEY, JSON.stringify(runs));
}
export const usd = (n: number, digits = 2) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
export const short = (n: number) =>
  Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
