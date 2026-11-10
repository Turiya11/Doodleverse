import * as THREE from 'three';
import { NEON_COLOR, neonMaterial, markGlow } from '../vfx/neon.js';

// A level tray of crayons and an eraser. Items lie along the tray's Z axis (pointing at the user)
// and are picked by tapping them with a fingertip, or clicking them in the desktop preview.

export const CRAYONS = [
    { name: 'Pink', color: 0xff3366 },
    { name: 'Blue', color: 0x33ccff },
    { name: 'Yellow', color: 0xffcc00 },
    { name: 'Green', color: 0x33cc33 },
    { name: 'Neon', color: NEON_COLOR, neon: true }, // draws with glowing light
];

const TRAY_W = 0.68;
const TRAY_D = 0.12;
const TRAY_T = 0.02;
const SPACING = 0.08;
const CRAYON_R = 0.012;
const CRAYON_LEN = 0.08;
const TIP_LEN = 0.02;
const LIFT = 0.02;             // selected item hops up this far
const HIT_RADIUS = 0.025;      // fingertip distance from an item's axis that counts as a tap
const HIT_HALF_LEN = 0.055;

const bodyGeometry = new THREE.CylinderGeometry(CRAYON_R, CRAYON_R, CRAYON_LEN, 16);
const tipGeometry = new THREE.ConeGeometry(CRAYON_R, TIP_LEN, 16);
const wrapperGeometry = new THREE.CylinderGeometry(CRAYON_R * 1.06, CRAYON_R * 1.06, CRAYON_LEN * 0.45, 16);
const wrapperMaterial = new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 0.9 });
const _home = new THREE.Vector3();
const _identity = new THREE.Quaternion();

// How far the drawing end of a held tool sits from where it's pinched, along its -Z (crayons point
// their tip along -Z; the eraser rubs with its front end).
export const TOOL_TIP = { crayon: 0.06, eraser: 0.035 };

function makeCrayon(color, neon) {
    const material = neon ? neonMaterial(color)
        : new THREE.MeshStandardMaterial({ color, roughness: 0.55, emissive: color, emissiveIntensity: 0 });
    const crayon = new THREE.Group();
    const body = new THREE.Mesh(bodyGeometry, material);
    const tip = new THREE.Mesh(tipGeometry, material);
    tip.position.y = CRAYON_LEN / 2 + TIP_LEN / 2;
    const wrapper = new THREE.Mesh(wrapperGeometry, wrapperMaterial);
    body.add(tip, wrapper);
    body.rotation.x = -Math.PI / 2; // lie down, tip pointing away from the user
    crayon.add(body);
    if (neon) markGlow(crayon);
    // The neon crayon always glows a little; every item brightens when selected.
    return { object: crayon, materials: [material], glow: neon ? material.emissiveIntensity : 0 };
}

function makeEraser() {
    const rubber = new THREE.MeshStandardMaterial({ color: 0xffb3c6, roughness: 0.9, emissive: 0xffb3c6, emissiveIntensity: 0 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x5b8def, roughness: 0.6, emissive: 0x5b8def, emissiveIntensity: 0 });
    const eraser = new THREE.Group();
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.022, 0.07), rubber);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.024, 0.03), sleeve);
    band.position.z = 0.012;
    eraser.add(block, band);
    return { object: eraser, materials: [rubber, sleeve] };
}

// Pinch the wand off the tray and wave it in a circle to bring the drawing to life (the app tracks
// the waving); it is an action, never the selected tool.
function makeWand() {
    const wand = new THREE.Group();
    const stick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.004, 0.004, 0.085, 12),
        new THREE.MeshStandardMaterial({ color: 0x8e6cf0, roughness: 0.5 })
    );
    stick.rotation.x = -Math.PI / 2;

    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
        const a = Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 0.008 : 0.018;
        star[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    const starMesh = new THREE.Mesh(
        new THREE.ExtrudeGeometry(star, { depth: 0.006, bevelEnabled: false }),
        new THREE.MeshStandardMaterial({ color: 0xffd93d, roughness: 0.4, emissive: 0xffd93d, emissiveIntensity: 0.5 })
    );
    starMesh.position.set(0, 0.012, -0.045); // standing up at the far end, facing the user
    wand.add(stick, starMesh);
    return { object: wand, materials: [], star: starMesh };
}

// A glowing green "I'm done" button: the same action as the wand, for anyone who looks for a button.
function makeDoneButton() {
    const material = new THREE.MeshStandardMaterial({ color: 0x33ff88, roughness: 0.3, emissive: 0x33ff88, emissiveIntensity: 0.8 });
    const button = new THREE.Group();
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.018, 24, 16), material);
    orb.position.y = 0.006;
    button.add(orb);
    return { object: button, materials: [], orb };
}

export class ArtTray extends THREE.Group {
    constructor() {
        super();

        const tray = new THREE.Mesh(
            new THREE.BoxGeometry(TRAY_W, TRAY_T, TRAY_D),
            new THREE.MeshStandardMaterial({ color: 0xf2e6d9, roughness: 0.7 })
        );
        tray.receiveShadow = true;
        this.add(tray);

        const specs = [
            ...CRAYONS.map((c) => ({ tool: 'crayon', name: c.name, color: c.color, ...makeCrayon(c.color, c.neon) })),
            { tool: 'done', name: 'Done', color: null, ...makeDoneButton() },
            { tool: 'eraser', name: 'Eraser', color: null, ...makeEraser() },
            { tool: 'wand', name: 'Magic wand', color: null, ...makeWand() },
        ];

        this.items = specs.map((item, i) => {
            item.baseY = TRAY_T / 2 + CRAYON_R;
            item.homeX = (i - (specs.length - 1) / 2) * SPACING;
            item.held = false;      // true while a hand carries it off the tray (the wand)
            item.object.position.set(item.homeX, item.baseY, 0);
            item.object.traverse((o) => { o.castShadow = true; o.userData.trayItem = item; });
            this.add(item.object);
            return item;
        });
        this.selected = null;
    }

    select(item) {
        this.selected = item;
    }

    // `local` is a point in this tray's space. Returns the item it is touching, if any.
    hitTest(local) {
        for (const item of this.items) {
            const p = item.object.position;
            const dz = Math.max(Math.abs(local.z - p.z) - HIT_HALF_LEN, 0);
            if (Math.hypot(local.x - p.x, local.y - p.y, dz) < HIT_RADIUS) return item;
        }
        return null;
    }

    update(dt) {
        const k = 1 - Math.exp(-dt * 12);
        for (const item of this.items) {
            const on = item === this.selected;
            // Settle into its slot (a released wand floats back home); a held item goes where the hand is.
            if (!item.held) {
                item.object.position.lerp(_home.set(item.homeX, item.baseY + (on ? LIFT : 0), 0), k);
                item.object.quaternion.slerp(_identity, k); // a held crayon was tilted toward the board
            }
            for (const m of item.materials) m.emissiveIntensity += ((on ? 0.35 : 0) + (item.glow ?? 0) - m.emissiveIntensity) * k;
            if (item.star) item.star.rotation.z += dt * (1.5 + (item.charge ?? 0) * 8); // spins faster as it charges
            if (item.orb) {
                this.pulse = (this.pulse ?? 0) + dt;
                item.orb.scale.setScalar(1 + 0.12 * Math.sin(this.pulse * 4));
                item.orb.material.emissiveIntensity = 0.6 + 0.4 * Math.sin(this.pulse * 4);
            }
        }
    }
}
