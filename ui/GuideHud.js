import * as THREE from 'three';
import { SpatialPanel } from './SpatialPanel.js';

// A small instruction sign that follows the user's gaze in the headset, so they always know what to
// do next and never lose track of the board or their character.
//
// - It sits a little below the centre of view and lazily re-centres only once the user has looked
//   well away from it (like the system menus), so it doesn't swim with every head movement.
// - When the thing they should be looking at (the board, later their character) is out of view, it
//   says so and an arrow points the way.
// - Once a message has been on screen for a while and the target is in view, it fades out, and comes
//   back as soon as there's something new to say.

const DISTANCE = 0.9;
const DROP = 0.2;              // below eye level
const RECENTER_ANGLE = 0.35;   // radians the gaze may wander before the sign follows
const FOLLOW = 3;
const OUT_OF_VIEW = 0.7;       // radians off the gaze direction counts as out of view (~40°)
const SHOW_FOR = 8;            // seconds a message stays before fading (while the target is in view)
const FADE = 4;

const _head = new THREE.Vector3();
const _gaze = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _local = new THREE.Vector3();
const _inv = new THREE.Matrix4();

function arrowShape() {
    const s = new THREE.Shape();
    s.moveTo(0.022, 0);
    s.lineTo(-0.012, 0.018);
    s.lineTo(-0.004, 0);
    s.lineTo(-0.012, -0.018);
    s.closePath();
    return s;
}

export class GuideHud extends THREE.Group {
    constructor() {
        super();
        this.visible = false;
        this.panel = new SpatialPanel({ width: 0.36, height: 0.085 });
        this.panel.renderOrder = 30;
        this.panel.material.depthTest = false; // always readable, even if something is in front
        this.add(this.panel);

        this.arrow = new THREE.Mesh(
            new THREE.ShapeGeometry(arrowShape()),
            new THREE.MeshBasicMaterial({ color: 0xffd93d, transparent: true, depthTest: false, side: THREE.DoubleSide })
        );
        this.arrow.renderOrder = 31;
        this.arrow.visible = false;
        this.add(this.arrow);

        this.anchor = new THREE.Vector3(0, 0, -1); // direction from the head where the sign sits
        this.placed = false;
        this.shownFor = 0;
        this.key = '';
        this.opacity = 0;
    }

    reset() {
        this.placed = false;
        this.key = '';
    }

    // `camera` is the XR camera; `message` is [title, subtitle]; `target` is a world position the user
    // should keep in view (or null), described by `targetName` ("Your board").
    update(dt, camera, message, target, targetName) {
        camera.getWorldPosition(_head);
        camera.getWorldDirection(_gaze);

        // Is the target out of view? Then the message becomes "it's over there" with an arrow.
        let out = false;
        if (target) {
            _toTarget.subVectors(target, _head).normalize();
            out = _toTarget.angleTo(_gaze) > OUT_OF_VIEW;
        }
        const [title, subtitle] = out ? [`${targetName} is over there`, 'Follow the arrow'] : message;

        const key = `${title}|${subtitle}`;
        if (key !== this.key) {
            this.key = key;
            this.shownFor = 0;
            this.panel.setText(title, subtitle);
        }
        this.shownFor += dt;

        // Lazy follow: only swing round once the gaze has moved well away from where the sign is.
        if (!this.placed) {
            this.anchor.copy(_gaze);
            this.placed = true;
        } else if (this.anchor.angleTo(_gaze) > RECENTER_ANGLE || out) {
            this.anchor.lerp(_gaze, 1 - Math.exp(-dt * FOLLOW)).normalize();
        }
        this.position.copy(_head).addScaledVector(this.anchor, DISTANCE);
        this.position.y -= DROP;
        this.lookAt(_head);

        // Arrow on the sign's edge, pointing toward the target as seen from the head.
        this.arrow.visible = out;
        if (out) {
            _inv.copy(camera.matrixWorld).invert();
            _local.copy(target).applyMatrix4(_inv); // camera space: -Z ahead, +X right, +Y up
            let x = _local.x;
            let y = _local.y;
            if (_local.z > 0) { // behind: just say left or right
                y = 0;
                x = Math.sign(x) || 1;
            }
            const a = Math.atan2(y, x);
            this.arrow.position.set(Math.cos(a) * 0.21, Math.sin(a) * 0.065, 0.002);
            this.arrow.rotation.z = a;
        }

        // Fade out once it's been read and nothing needs attention; come back for anything new.
        const wanted = out || this.shownFor < SHOW_FOR ? 1 : 0;
        this.opacity += (wanted - this.opacity) * (1 - Math.exp(-dt * FADE));
        this.panel.material.opacity = this.opacity;
        this.arrow.material.opacity = this.opacity;
        this.visible = this.opacity > 0.02;
    }
}
