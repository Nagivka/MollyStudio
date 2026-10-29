export const WEATHER_EFFECTS = Object.freeze(['none', 'rain', 'snow', 'leaves']);
export const WEATHER_DENSITIES = Object.freeze(['light', 'normal', 'dense']);

/** Bounded, time-based particles. No document, image, or project state. */
export class WeatherParticles {
    constructor(effect, density, width, height, random = Math.random) {
        this.effect = WEATHER_EFFECTS.includes(effect) ? effect : 'none';
        this.density = WEATHER_DENSITIES.includes(density) ? density : 'normal';
        this.random = random;
        this.time = 0;
        this.speedFactor = 1;
        this.wind = -.15;
        this.populationScale = 1;
        this.particles = [];
        this.resize(width, height);
    }

    resize(width, height) {
        const previousWidth = this.width, previousHeight = this.height;
        this.width = Math.max(1, Math.min(16384, Number(width) || 1));
        this.height = Math.max(1, Math.min(16384, Number(height) || 1));
        if (previousWidth && previousHeight && (previousWidth !== this.width || previousHeight !== this.height)) {
            for (const particle of this.particles) {
                particle.x = Math.max(-48, Math.min(this.width + 48, particle.x * this.width / previousWidth));
                particle.y = Math.max(-64, Math.min(this.height + 24, particle.y * this.height / previousHeight));
            }
        }
        this.updatePopulation();
    }

    configure({weatherSpeed = 100, weatherWind = -15, weatherDensity = this.density, weatherQuality = 'auto'} = {}) {
        this.speedFactor = Number.isFinite(weatherSpeed) ? Math.max(.25, Math.min(2, weatherSpeed / 100)) : 1;
        this.wind = Number.isFinite(weatherWind) ? Math.max(-1, Math.min(1, weatherWind / 100)) : -.15;
        this.density = WEATHER_DENSITIES.includes(weatherDensity) ? weatherDensity : 'normal';
        this.populationScale = weatherQuality === 'economy' ? .6 : 1;
        this.updatePopulation();
        if (this.effect === 'rain') for (const particle of this.particles) particle.vx = particle.speed * this.wind * .4;
    }

    updatePopulation() {
        const area = Math.min(3, Math.max(.3, this.width * this.height / 1e6));
        const rate = {rain: 80, snow: 96, leaves: 20, none: 0}[this.effect];
        const density = {light: .55, normal: 1, dense: 1.6}[this.density];
        // Snow needs more particles to read as snowfall rather than isolated flakes.
        // Keep a separate bound so large windows still distinguish density levels.
        const limit = this.effect === 'snow' ? 440 : 220;
        const count = Math.round(Math.min(limit, area * rate * density) * this.populationScale);
        if (count === this.particles.length) return;
        if (count < this.particles.length) this.particles.length = count;
        while (this.particles.length < count) this.particles.push(this.create(true));
        this.particles.sort((a, b) => a.depth - b.depth);
    }

    create(scattered = false) {
        const random = this.random;
        const depth = .35 + random() * .65;
        return {
            x: random() * (this.width + 80) - 40,
            y: scattered ? random() * this.height : -24 - random() * 40,
            depth, size: this.effect === 'leaves' ? 7 + depth * 7 : this.effect === 'snow' ? 1 + depth * 4 : 1 + depth * 2,
            speed: this.effect === 'rain' ? 360 + depth * 360 : this.effect === 'snow' ? 14 + depth * 24 : 24 + depth * 30,
            phase: random() * Math.PI * 2, rotation: random() * Math.PI * 2,
            spin: (random() - .5) * 2, color: Math.floor(random() * 4), variant: Math.floor(random() * 64), vx: 0
        };
    }

    step(seconds) {
        const dt = (Number.isFinite(seconds) ? Math.max(0, Math.min(.05, seconds)) : 0) * this.speedFactor;
        if (!dt) return;
        const before = this.time;
        this.time += dt;
        // Integrate wind and flutter analytically so they do not depend on FPS.
        const wave = (frequency, phase) => (Math.cos(before * frequency + phase) - Math.cos(this.time * frequency + phase)) / frequency;
        const gust = wave(.45, 0) * this.wind * 16;
        for (let index = 0; index < this.particles.length; index++) {
            const particle = this.particles[index];
            const drift = this.effect === 'rain' ? particle.speed * this.wind * .4 : this.wind * (32 + particle.depth * 38);
            const flutter = this.effect === 'leaves' ? 22 : this.effect === 'snow' ? 10 : 0;
            const frequency = this.effect === 'leaves' ? .8 : .6;
            particle.x += drift * dt + gust * particle.depth + wave(frequency, particle.phase) * flutter;
            particle.vx = drift + Math.sin(this.time * .45) * this.wind * 16 * particle.depth
                + Math.sin(this.time * frequency + particle.phase) * flutter;
            particle.y += particle.speed * dt;
            if (this.effect === 'leaves') particle.y += (Math.sin(this.time * 1.3 + particle.phase) - Math.sin(before * 1.3 + particle.phase)) * 3;
            particle.rotation += particle.spin * dt;
            if (this.effect === 'leaves') particle.rotation += (Math.sin(this.time * 1.4 + particle.phase) - Math.sin(before * 1.4 + particle.phase)) * .25;
            if (particle.y > this.height + 24) this.particles[index] = this.create();
            else if (particle.x < -48) particle.x = this.width + 32;
            else if (particle.x > this.width + 48) particle.x = -32;
        }
    }

    scrollBy(dx,dy) {
        for(const particle of this.particles){
            const parallax=.2+particle.depth*.55;
            particle.x-=dx*parallax;particle.y-=dy*parallax;
            particle.x=((particle.x+48)%(this.width+96)+(this.width+96))%(this.width+96)-48;
            particle.y=((particle.y+64)%(this.height+88)+(this.height+88))%(this.height+88)-64;
        }
    }
}
