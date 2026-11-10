import * as THREE from 'three';
import { BLOOM_LAYER } from './neon.js';

// A pool of glowing star sparkles in world space (a single THREE.Points draw call). Each particle
// drifts, slows down, falls a little and fades out; dead particles are swapped out of the live range.
// Fading uses per-vertex alpha (an RGBA colour attribute) rather than darkening alone, so additive
// sparkles leave no dark smudge over passthrough in the headset.

function sparkleTexture() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const c = size / 2;
    const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    // Four-point star on top of the glow.
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    const r = c * 0.95;
    const w = c * 0.12;
    ctx.moveTo(c, c - r);
    ctx.lineTo(c + w, c - w);
    ctx.lineTo(c + r, c);
    ctx.lineTo(c + w, c + w);
    ctx.lineTo(c, c + r);
    ctx.lineTo(c - w, c + w);
    ctx.lineTo(c - r, c);
    ctx.lineTo(c - w, c - w);
    ctx.closePath();
    ctx.fill();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

let sharedTexture = null;
const _color = new THREE.Color();

export class Sparkles extends THREE.Points {
    constructor({ capacity = 400, size = 0.015 } = {}) {
        const geometry = new THREE.BufferGeometry();
        const positions = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
        const colors = new THREE.BufferAttribute(new Float32Array(capacity * 4), 4);
        positions.setUsage(THREE.DynamicDrawUsage);
        colors.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('position', positions);
        geometry.setAttribute('color', colors);
        geometry.setDrawRange(0, 0);
        const material = new THREE.PointsMaterial({
            size, map: (sharedTexture ??= sparkleTexture()), vertexColors: true, transparent: true,
            depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
        });
        super(geometry, material);
        this.frustumCulled = false;
        this.renderOrder = 20;
        this.layers.enable(BLOOM_LAYER);

        this.capacity = capacity;
        this.count = 0;
        this.vel = new Float32Array(capacity * 3);
        this.base = new Float32Array(capacity * 3);
        this.life = new Float32Array(capacity);
        this.maxLife = new Float32Array(capacity);
        this.drag = new Float32Array(capacity);
        this.gravity = new Float32Array(capacity);
        this.phase = new Float32Array(capacity);
    }

    get alive() {
        return this.count;
    }

    // `pos` and `vel` are world-space Vector3s; `color` anything THREE.Color accepts.
    emit(pos, vel, color, life, { drag = 0, gravity = 0 } = {}) {
        if (this.count >= this.capacity) return;
        const i = this.count++;
        this.geometry.attributes.position.setXYZ(i, pos.x, pos.y, pos.z);
        this.vel.set([vel.x, vel.y, vel.z], i * 3);
        _color.set(color);
        this.base.set([_color.r, _color.g, _color.b], i * 3);
        this.life[i] = this.maxLife[i] = life;
        this.drag[i] = drag;
        this.gravity[i] = gravity;
        this.phase[i] = Math.random() * Math.PI * 2;
    }

    update(dt) {
        const pos = this.geometry.attributes.position;
        const col = this.geometry.attributes.color;
        const p = pos.array;
        const c = col.array;
        for (let i = 0; i < this.count; i++) {
            this.life[i] -= dt;
            if (this.life[i] <= 0) {
                this.swap(i, --this.count);
                i--;
                continue;
            }
            const k = Math.exp(-this.drag[i] * dt);
            const v = i * 3;
            this.vel[v] *= k;
            this.vel[v + 1] = this.vel[v + 1] * k - this.gravity[i] * dt;
            this.vel[v + 2] *= k;
            p[v] += this.vel[v] * dt;
            p[v + 1] += this.vel[v + 1] * dt;
            p[v + 2] += this.vel[v + 2] * dt;

            const t = this.life[i] / this.maxLife[i];
            this.phase[i] += dt * 18;
            const a = t * t * (0.75 + 0.25 * Math.sin(this.phase[i])); // fade out, with a twinkle
            const o = i * 4;
            c[o] = this.base[v];
            c[o + 1] = this.base[v + 1];
            c[o + 2] = this.base[v + 2];
            c[o + 3] = a;
        }
        this.geometry.setDrawRange(0, this.count);
        pos.needsUpdate = true;
        col.needsUpdate = true;
    }

    swap(i, j) {
        if (i === j) return;
        const p = this.geometry.attributes.position.array;
        for (let k = 0; k < 3; k++) {
            p[i * 3 + k] = p[j * 3 + k];
            this.vel[i * 3 + k] = this.vel[j * 3 + k];
            this.base[i * 3 + k] = this.base[j * 3 + k];
        }
        this.life[i] = this.life[j];
        this.maxLife[i] = this.maxLife[j];
        this.drag[i] = this.drag[j];
        this.gravity[i] = this.gravity[j];
        this.phase[i] = this.phase[j];
    }

    clear() {
        this.count = 0;
        this.geometry.setDrawRange(0, 0);
    }
}
