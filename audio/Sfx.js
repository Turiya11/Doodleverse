import * as THREE from 'three';

// Spatial sound effects. Every sound is a THREE.PositionalAudio attached to the object that makes it
// (the wand, the ball, the character), so it comes from that spot in the room. The sounds are
// synthesised into AudioBuffers at start-up: no audio files to download.
//
// Browsers start the AudioContext suspended until a user gesture, so the app calls resume() from
// its click and pointer handlers.

const TAU = Math.PI * 2;

function makeBuffer(ctx, seconds, fill, peak = 0.8) {
    const sr = ctx.sampleRate;
    const n = Math.floor(seconds * sr);
    const buffer = ctx.createBuffer(1, n, sr);
    const data = buffer.getChannelData(0);
    fill(data, sr);
    let max = 1e-6;
    for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(data[i]));
    for (let i = 0; i < n; i++) data[i] *= peak / max;
    return buffer;
}

// A seamless 2-second loop of high, chiming partials with a tremolo and little glittery ticks.
// Every frequency is a whole number of hertz, so it loops without a click.
function shimmer(ctx) {
    return makeBuffer(ctx, 2, (d, sr) => {
        const partials = [[1568, 0.5], [2093, 0.4], [2637, 0.3], [3136, 0.25], [4186, 0.15]];
        for (let i = 0; i < d.length; i++) {
            const t = i / sr;
            let s = 0;
            partials.forEach(([f, a], k) => { s += a * Math.sin(TAU * f * t + 0.8 * Math.sin(TAU * 3 * t + k)); });
            d[i] = s * (0.6 + 0.4 * Math.sin(TAU * 4 * t));
        }
        for (let k = 0; k < 70; k++) {
            const start = Math.floor(Math.random() * (d.length - sr * 0.1));
            const f = 4500 + Math.random() * 3500;
            for (let j = 0; j < sr * 0.08; j++) {
                const t = j / sr;
                d[start + j] += 0.9 * Math.sin(TAU * f * t) * Math.exp(-t * 60);
            }
        }
    }, 0.7);
}

// A springy cartoon "boing": a falling pitch with a decaying wobble.
function boing(ctx) {
    return makeBuffer(ctx, 0.5, (d, sr) => {
        let phase = 0;
        for (let i = 0; i < d.length; i++) {
            const t = i / sr;
            const f = 150 + 260 * Math.exp(-7 * t) + 30 * Math.sin(TAU * 14 * t) * Math.exp(-4 * t);
            phase += (TAU * f) / sr;
            const env = Math.exp(-5 * t) * Math.min(t / 0.004, 1);
            d[i] = env * (Math.sin(phase) + 0.3 * Math.sin(2 * phase));
        }
    }, 0.8);
}

// A bright, satisfying "pop": a fast downward pitch blip with a tiny click.
function pop(ctx) {
    return makeBuffer(ctx, 0.16, (d, sr) => {
        let phase = 0;
        for (let i = 0; i < d.length; i++) {
            const t = i / sr;
            const f = 350 + 1300 * Math.exp(-28 * t);
            phase += (TAU * f) / sr;
            d[i] = Math.exp(-32 * t) * Math.sin(phase) + (t < 0.006 ? 0.35 * (Math.random() * 2 - 1) * (1 - t / 0.006) : 0);
        }
    }, 0.9);
}

// Cute gibberish: 2-4 sung syllables at a high, childlike pitch. Each vowel is shaped by weighting
// the voice's harmonics around two formant frequencies.
const VOWELS = [[800, 1200], [400, 2300], [500, 900], [350, 800], [650, 1700], [300, 2600]];

function babble(ctx) {
    const syllables = 2 + Math.floor(Math.random() * 3);
    const plan = [];
    let total = 0.03;
    for (let k = 0; k < syllables; k++) {
        const len = 0.07 + Math.random() * 0.07;
        plan.push({
            start: total, len,
            pitch: 430 + Math.random() * 160,
            slide: (Math.random() - 0.4) * 0.35,
            vowel: VOWELS[Math.floor(Math.random() * VOWELS.length)],
        });
        total += len + 0.02 + Math.random() * 0.04;
    }
    return makeBuffer(ctx, total + 0.05, (d, sr) => {
        for (const s of plan) {
            const i0 = Math.floor(s.start * sr);
            const n = Math.floor(s.len * sr);
            let phase = 0;
            for (let j = 0; j < n && i0 + j < d.length; j++) {
                const u = j / n;
                const f0 = s.pitch * (1 + s.slide * u);
                phase += (TAU * f0) / sr;
                let v = 0;
                for (let h = 1; h <= 12; h++) {
                    const fh = h * f0;
                    if (fh > 5000) break;
                    const a = Math.exp(-(((fh - s.vowel[0]) / 200) ** 2)) + 0.6 * Math.exp(-(((fh - s.vowel[1]) / 280) ** 2)) + 0.04 / h;
                    v += a * Math.sin(h * phase);
                }
                const env = Math.sin(Math.PI * u) ** 0.6;
                const consonant = u < 0.08 ? 0.25 * (Math.random() * 2 - 1) * (1 - u / 0.08) : 0;
                d[i0 + j] += env * v + consonant;
            }
        }
    }, 0.7);
}

export class Sfx {
    constructor(camera) {
        this.listener = new THREE.AudioListener();
        camera.add(this.listener);
        const ctx = this.listener.context;
        this.buffers = {
            shimmer: shimmer(ctx),
            boing: boing(ctx),
            pop: pop(ctx),
            babble: Array.from({ length: 8 }, () => babble(ctx)),
        };
    }

    get ready() {
        return this.listener.context.state === 'running';
    }

    resume() {
        if (!this.ready) this.listener.context.resume().catch(() => {});
    }

    // A positional sound source attached to `object`.
    attach(object, { refDistance = 0.5, loop = false, buffer = null } = {}) {
        const sound = new THREE.PositionalAudio(this.listener);
        sound.setRefDistance(refDistance);
        sound.setRolloffFactor(1.5);
        sound.setLoop(loop);
        if (buffer) sound.setBuffer(buffer);
        object.add(sound);
        return sound;
    }

    // (Re)start `sound` with `buffer`. Silently skipped until the AudioContext is allowed to run.
    play(sound, buffer, { volume = 1, rate = 1 } = {}) {
        if (!this.ready) return;
        if (sound.isPlaying) sound.stop();
        sound.setBuffer(buffer);
        sound.setPlaybackRate(rate);
        sound.setVolume(volume);
        sound.play();
    }

    stop(sound) {
        if (sound?.isPlaying) sound.stop();
    }

    // Stop and unhook a sound whose object is being thrown away.
    release(sound) {
        if (!sound) return;
        this.stop(sound);
        sound.removeFromParent();
        sound.gain.disconnect();
    }
}
