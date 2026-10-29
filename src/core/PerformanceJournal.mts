export interface TimingSummary {
    name: string;
    count: number;
    totalMs: number;
    maxMs: number;
    p50Ms: number;
    p95Ms: number;
}
interface Timing {
    count: number;
    total: number;
    max: number;
    samples: number[];
}
export class PerformanceJournal {
    private readonly timings = new Map<string, Timing>();
    private readonly events: {
        kind: string;
        message: string;
        at: number;
    }[] = [];
    record(name: string, ms: number): void {
        if (!Number.isFinite(ms) || ms < 0)
            return;
        if (!this.timings.has(name) && this.timings.size >= 64)
            return;
        const entry = this.timings.get(name) ?? { count: 0, total: 0, max: 0, samples: [] };
        entry.count++;
        entry.total += ms;
        entry.max = Math.max(entry.max, ms);
        entry.samples.push(ms);
        if (entry.samples.length > 120)
            entry.samples.shift();
        this.timings.set(name, entry);
    }
    event(kind: string, message: string): void {
        this.events.push({ kind: kind.slice(0, 40), message: message.slice(0, 500), at: Date.now() });
        if (this.events.length > 80)
            this.events.shift();
    }
    snapshot(): {
        timings: TimingSummary[];
        events: ReadonlyArray<{
            kind: string;
            message: string;
            at: number;
        }>;
    } {
        return { timings: [...this.timings].map(([name, e]) => { const sorted = [...e.samples].sort((a, b) => a - b), p = (n: number) => Math.round((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * n))] ?? 0) * 100) / 100; return { name, count: e.count, totalMs: Math.round(e.total * 100) / 100, maxMs: Math.round(e.max * 100) / 100, p50Ms: p(.5), p95Ms: p(.95) }; }), events: this.events.map(e => ({ ...e })) };
    }
    clear(): void { this.timings.clear(); this.events.length = 0; }
}
