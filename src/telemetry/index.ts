import { TraceEvent, TraceContext } from '../core/types.js';

export class Telemetry {
  private traces = new Map<string, TraceContext>();
  private globalStats = {
    requests: 0,
    successes: 0,
    failures: 0,
    totalLatencyMs: 0,
    totalSavedUsd: 0,
    hedgeCount: 0,
    cacheHits: 0,
  };

  startTrace(context: TraceContext) {
    this.traces.set(context.traceId, context);
  }

  recordEvent(traceId: string, event: TraceEvent) {
    const trace = this.traces.get(traceId);
    if (trace) {
      trace.events.push(event);
      this.updateGlobalStats(event);
    }
  }

  private updateGlobalStats(event: TraceEvent) {
    switch (event.type) {
      case 'completed':
        this.globalStats.requests++;
        this.globalStats.successes++;
        this.globalStats.totalLatencyMs += event.totalLatency;
        break;
      case 'failed':
        this.globalStats.requests++;
        this.globalStats.failures++;
        break;
      case 'hedge_launched':
        this.globalStats.hedgeCount++;
        break;
    }
  }

  getMetrics() {
    return {
      rps: 0, // Mock for now
      p95: this.globalStats.requests > 0 ? this.globalStats.totalLatencyMs / this.globalStats.requests : 0, // Mock avg as p95 for now
      saved: this.globalStats.totalSavedUsd,
      healthy: true,
      ...this.globalStats
    };
  }

  getRecentTraces() {
    return Array.from(this.traces.values()).reverse().slice(0, 10);
  }
}
