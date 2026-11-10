import * as THREE from 'three';

// Pill-shaped floating panel: text drawn to a canvas, mapped onto a plane. HTML/CSS is not visible
// inside an immersive session, so all in-experience UI goes through this.

const PX_PER_METRE = 3200; // ~1088px across a 34cm panel keeps text crisp at arm's length
const FILL = 'rgba(25, 42, 86, 0.82)';
const ACCENT = '#4ecdc4';
const FONT = 'Nunito, system-ui, sans-serif';

export class SpatialPanel extends THREE.Mesh {
    // `radius` (metres) rounds the corners; leave it out for a pill with fully round ends.
    constructor({ width = 0.34, height = 0.085, radius = null, fill = FILL, accent = ACCENT } = {}) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * PX_PER_METRE);
        canvas.height = Math.round(height * PX_PER_METRE);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace; // otherwise canvas colours render washed out
        texture.anisotropy = 4;

        super(
            new THREE.PlaneGeometry(width, height),
            new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
        );
        this.renderOrder = 20;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.texture = texture;
        this.radius = radius;
        this.fill = fill;
        this.accent = accent;
        this.title = '';
        this.subtitle = '';
        this.size = { width, height };

        // The canvas falls back to system-ui until the web font arrives; redraw once it does.
        if (document.fonts) {
            Promise.all([document.fonts.load(`800 40px ${FONT}`), document.fonts.load(`600 40px ${FONT}`)])
                .then(() => this.redraw())
                .catch(() => {});
        }
    }

    // `subtitle` is one line, or an array of lines for a card (title on top, lines below).
    setText(title, subtitle = '') {
        if (title === this.title && JSON.stringify(subtitle) === JSON.stringify(this.subtitle)) return;
        this.title = title;
        this.subtitle = subtitle;
        this.redraw();
    }

    redraw() {
        const { ctx, canvas: { width: w, height: h } } = this;
        ctx.clearRect(0, 0, w, h);

        // Inset by half the stroke so the border isn't clipped at the canvas edge.
        const lw = h * 0.03;
        ctx.beginPath();
        const r = this.radius == null ? (h - lw) / 2 : this.radius * PX_PER_METRE;
        ctx.roundRect(lw / 2, lw / 2, w - lw, h - lw, r);
        ctx.fillStyle = this.fill;
        ctx.fill();
        ctx.lineWidth = lw;
        ctx.strokeStyle = this.accent;
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (Array.isArray(this.subtitle)) {
            const lines = this.subtitle;
            const pad = Math.max(r, w * 0.06);
            const titleY = Math.min(h * 0.15, w * 0.1);
            this.fillFitted(this.title, 800, titleY * 0.8, '#ffcc00', w / 2, titleY, w - 2 * pad);
            const step = (h * 0.94 - titleY * 1.7) / lines.length;
            const size = Math.min(h * 0.075, step * 0.62);
            lines.forEach((line, i) => {
                this.fillFitted(line, 600, size, '#ffffff', w / 2, titleY * 1.7 + step * (i + 0.5), w - 2 * pad);
            });
            this.texture.needsUpdate = true;
            return;
        }

        const maxWidth = w - h; // keep text clear of the rounded ends
        if (this.subtitle) {
            this.fillFitted(this.title, 800, h * 0.3, '#ffffff', w / 2, h * 0.4, maxWidth);
            this.fillFitted(this.subtitle, 600, h * 0.18, '#cfe9ff', w / 2, h * 0.7, maxWidth);
        } else {
            this.fillFitted(this.title, 800, h * 0.32, '#ffffff', w / 2, h / 2, maxWidth);
        }
        this.texture.needsUpdate = true;
    }

    // Shrinks the font until the text fits on one line.
    fillFitted(text, weight, size, color, x, y, maxWidth) {
        const { ctx } = this;
        do {
            ctx.font = `${weight} ${size}px ${FONT}`;
            size *= 0.92;
        } while (ctx.measureText(text).width > maxWidth && size > 8);
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
    }
}
