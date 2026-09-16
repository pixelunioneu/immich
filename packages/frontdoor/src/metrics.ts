/**
 * A minimal Prometheus text-exposition registry.
 *
 * Hand-rolled, like the HTTP layer, because this package lives inside a fork that
 * merges upstream regularly: every dependency is one more thing to reconcile at
 * merge time, and one more item in the supply chain of a process that holds
 * database credentials. The saving in bundle size is incidental.
 */

type Labels = Record<string, string>;

const key = (name: string, labels: Labels) => {
  const pairs = Object.keys(labels)
    .sort()
    .map((label) => `${label}="${escape(labels[label] ?? '')}"`);
  return pairs.length > 0 ? `${name}{${pairs.join(',')}}` : name;
};

const escape = (value: string) =>
  value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');

export class Metrics {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, { sum: number; count: number }>();
  private help = new Map<string, { type: string; text: string }>();

  describe(name: string, type: 'counter' | 'gauge' | 'summary', text: string) {
    this.help.set(name, { type, text });
  }

  increment(name: string, labels: Labels = {}, by = 1) {
    const id = key(name, labels);
    this.counters.set(id, (this.counters.get(id) ?? 0) + by);
  }

  setGauge(name: string, value: number, labels: Labels = {}) {
    this.gauges.set(key(name, labels), value);
  }

  observe(name: string, seconds: number, labels: Labels = {}) {
    const id = key(name, labels);
    const current = this.histograms.get(id) ?? { sum: 0, count: 0 };
    this.histograms.set(id, {
      sum: current.sum + seconds,
      count: current.count + 1,
    });
  }

  render(): string {
    const lines: string[] = [];
    const seen = new Set<string>();

    const header = (id: string) => {
      const name = id.split('{')[0] ?? id;
      if (seen.has(name)) {
        return;
      }
      seen.add(name);
      const meta = this.help.get(name);
      if (meta) {
        lines.push(
          `# HELP ${name} ${meta.text}`,
          `# TYPE ${name} ${meta.type}`,
        );
      }
    };

    for (const [id, value] of [...this.counters].sort()) {
      header(id);
      lines.push(`${id} ${value}`);
    }
    for (const [id, value] of [...this.gauges].sort()) {
      header(id);
      lines.push(`${id} ${value}`);
    }
    for (const [id, { sum, count }] of [...this.histograms].sort()) {
      header(id);
      const [name, rest] = splitId(id);
      lines.push(`${name}_sum${rest} ${sum}`, `${name}_count${rest} ${count}`);
    }

    return lines.join('\n') + '\n';
  }
}

const splitId = (id: string): [string, string] => {
  const brace = id.indexOf('{');
  return brace === -1 ? [id, ''] : [id.slice(0, brace), id.slice(brace)];
};

export const metrics = new Metrics();

metrics.describe(
  'frontdoor_requests_total',
  'counter',
  'Requests handled, by endpoint and outcome.',
);
metrics.describe(
  'frontdoor_wakes_avoided_total',
  'counter',
  'Requests answered that would otherwise have started a tenant.',
);
metrics.describe(
  'frontdoor_errors_total',
  'counter',
  'Requests that failed, by reason.',
);
metrics.describe(
  'frontdoor_db_latency_seconds',
  'summary',
  'Time spent in tenant database queries.',
);
metrics.describe(
  'frontdoor_pools_open',
  'gauge',
  'Tenant connection pools currently held.',
);
metrics.describe(
  'frontdoor_connections_open',
  'gauge',
  'Database connections currently held across all pools.',
);
metrics.describe(
  'frontdoor_breakers_open',
  'gauge',
  'Tenants currently failing fast.',
);
metrics.describe(
  'frontdoor_stream_decisions_total',
  'counter',
  'sync/stream dry runs, by verdict and, for busy, why.',
);
metrics.describe(
  'frontdoor_proxy_latency_seconds',
  'summary',
  'Time spent relaying a request to the tenant, by outcome.',
);
