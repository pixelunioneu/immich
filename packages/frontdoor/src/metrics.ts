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

type Summary = { sum: number; count: number };
type Histogram = Summary & { labels: Labels; counts: number[] };

export class Metrics {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private summaries = new Map<string, Summary>();
  private histograms = new Map<string, Histogram>();
  /** Upper bounds per histogram name; a name without one observes as a summary. */
  private buckets = new Map<string, number[]>();
  private help = new Map<string, { type: string; text: string }>();

  describe(
    name: string,
    type: 'counter' | 'gauge' | 'summary' | 'histogram',
    text: string,
    buckets?: number[],
  ) {
    this.help.set(name, { type, text });
    if (type === 'histogram') {
      if (!buckets?.length) {
        throw new Error(`histogram ${name} needs buckets`);
      }
      this.buckets.set(
        name,
        [...buckets].sort((a, b) => a - b),
      );
    }
  }

  increment(name: string, labels: Labels = {}, by = 1) {
    const id = key(name, labels);
    this.counters.set(id, (this.counters.get(id) ?? 0) + by);
  }

  setGauge(name: string, value: number, labels: Labels = {}) {
    this.gauges.set(key(name, labels), value);
  }

  observe(name: string, value: number, labels: Labels = {}) {
    const id = key(name, labels);
    const buckets = this.buckets.get(name);
    if (buckets) {
      const current = this.histograms.get(id) ?? {
        labels,
        counts: buckets.map(() => 0),
        sum: 0,
        count: 0,
      };
      for (const [index, bound] of buckets.entries()) {
        if (value <= bound) {
          current.counts[index] = (current.counts[index] ?? 0) + 1;
        }
      }
      current.sum += value;
      current.count += 1;
      this.histograms.set(id, current);
      return;
    }
    const current = this.summaries.get(id) ?? { sum: 0, count: 0 };
    this.summaries.set(id, {
      sum: current.sum + value,
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
    for (const [id, { sum, count }] of [...this.summaries].sort()) {
      header(id);
      const [name, rest] = splitId(id);
      lines.push(`${name}_sum${rest} ${sum}`, `${name}_count${rest} ${count}`);
    }
    for (const [id, { labels, counts, sum, count }] of [
      ...this.histograms,
    ].sort()) {
      header(id);
      const [name, rest] = splitId(id);
      const bounds = this.buckets.get(name) ?? [];
      // Buckets are cumulative, as the exposition format requires, and already
      // counted that way above. `+Inf` is every observation.
      for (const [index, bound] of bounds.entries()) {
        lines.push(
          `${key(`${name}_bucket`, { ...labels, le: String(bound) })} ${counts[index] ?? 0}`,
        );
      }
      lines.push(
        `${key(`${name}_bucket`, { ...labels, le: '+Inf' })} ${count}`,
        `${name}_sum${rest} ${sum}`,
        `${name}_count${rest} ${count}`,
      );
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
  'frontdoor_stream_types_total',
  'counter',
  'Entity types a sync/stream dry run produced, by type and verdict; once per distinct type per request.',
);
metrics.describe(
  'frontdoor_stream_served_bytes',
  'summary',
  'Size of the sync/stream bodies this service answered, in bytes.',
);
metrics.describe(
  'frontdoor_proxy_latency_seconds',
  'histogram',
  'Time spent relaying a request to the tenant, by outcome. Under a second or so the tenant was warm; longer, it was woken.',
  [0.1, 0.5, 1, 2, 5, 10, 30, 60],
);
