import client, { Counter, Histogram, Gauge, register } from 'prom-client';

// Collect default Node.js/process metrics (memory, CPU, event loop, etc.)
client.collectDefaultMetrics();

export const httpRequestCount = new Counter({
  name: 'http_request_count',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

export const queueDepth = new Gauge({
  name: 'queue_depth',
  help: 'Depth of background queues',
  labelNames: ['name'],
});

// Initialize queue gauges at 0
queueDepth.set({ name: 'erasure' }, 0);
queueDepth.set({ name: 'export' }, 0);
queueDepth.set({ name: 'notification' }, 0);

export { register };
