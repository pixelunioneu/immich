import { describe, expect, it } from 'vitest';
import { Metrics } from '../src/metrics.js';

describe('Metrics', () => {
  it('renders a summary as a sum and a count', () => {
    const metrics = new Metrics();
    metrics.describe('latency', 'summary', 'How long.');
    metrics.observe('latency', 0.25, { endpoint: 'a' });
    metrics.observe('latency', 0.75, { endpoint: 'a' });

    expect(metrics.render()).toBe(
      [
        '# HELP latency How long.',
        '# TYPE latency summary',
        'latency_sum{endpoint="a"} 1',
        'latency_count{endpoint="a"} 2',
        '',
      ].join('\n'),
    );
  });

  it('renders a histogram with cumulative buckets ending in +Inf', () => {
    const metrics = new Metrics();
    metrics.describe('latency', 'histogram', 'How long.', [1, 0.1, 10]);
    for (const seconds of [0.05, 0.5, 5, 50]) {
      metrics.observe('latency', seconds, { outcome: 'relayed' });
    }
    metrics.observe('latency', 1, { outcome: 'failed' });

    expect(metrics.render()).toBe(
      [
        '# HELP latency How long.',
        '# TYPE latency histogram',
        'latency_bucket{le="0.1",outcome="failed"} 0',
        'latency_bucket{le="1",outcome="failed"} 1',
        'latency_bucket{le="10",outcome="failed"} 1',
        'latency_bucket{le="+Inf",outcome="failed"} 1',
        'latency_sum{outcome="failed"} 1',
        'latency_count{outcome="failed"} 1',
        'latency_bucket{le="0.1",outcome="relayed"} 1',
        'latency_bucket{le="1",outcome="relayed"} 2',
        'latency_bucket{le="10",outcome="relayed"} 3',
        'latency_bucket{le="+Inf",outcome="relayed"} 4',
        'latency_sum{outcome="relayed"} 55.55',
        'latency_count{outcome="relayed"} 4',
        '',
      ].join('\n'),
    );
  });

  it('refuses a histogram without buckets', () => {
    const metrics = new Metrics();
    expect(() => metrics.describe('latency', 'histogram', 'How long.')).toThrow(
      /buckets/,
    );
  });
});
