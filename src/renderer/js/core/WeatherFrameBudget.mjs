/** Hysteresis keeps brief spikes from continually changing the frame rate. */
export class WeatherFrameBudget {
    constructor() { this.average = 0;this.samples = 0;this.slow = false;this.healthy = 0;this.expensive = 0; }
    sample(milliseconds) {
        if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
        const cost = Math.min(milliseconds, 50);
        this.average = this.samples ? this.average * .9 + cost * .1 : cost;
        this.samples++;
        this.expensive = this.average > 6 ? this.expensive + 1 : 0;
        if (this.samples >= 30 && this.expensive >= 8) { this.slow = true;this.healthy = 0; }
        if (this.slow && this.average < 2.5) {
            if (++this.healthy >= 120) { this.slow = false;this.healthy = 0; }
        } else this.healthy = 0;
    }
    fps(quality) { return quality === 'economy' || this.slow ? 30 : 60; }
}
