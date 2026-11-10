import * as THREE from 'three';
import { TOOL_TIP } from '../ui/ArtTray.js';

// Laptop tour: drives an emulated Meta Quest (IWER) with the mouse and keyboard, so the real WebXR
// experience (hand tracking, pinches, the gaze guide, spatial sound) can be shown without a headset.
//
//   Mouse            your right index fingertip follows the pointer, hovering just in front of
//                    whatever is under it (or pointing, for things out of reach)
//   Left button      touch: push the fingertip in (draw, press buttons, tap crayons)
//   Space / right button   pinch (pick up a crayon, the wand, the board handle, the ball)
//   Shift            bring the left hand in beside the right (two-hand carry and catch)
//   W A S D          walk          Arrow keys or Alt + mouse   look around
//   Q / E            crouch / stand up                          Esc   leave
//
// The emulated hand's transform is its pointing ray (-Z forward); its joints hang off that. Each frame
// the hand is placed so that its fingertip (or, while pinching, the point between thumb and finger)
// lands where the pointer aims, using the offset measured from the joints the app saw last frame.

const HOVER = 0.04;         // fingertip stands this far off a surface (beyond the app's 3cm arming height)
const PRESS = 0.006;        // ...and pushes this far through it while the left button is down
const REACH = 1.1;          // things farther than this are pointed at, not touched (a generous laptop "arm")
const POINT_DEPTH = 0.45;   // where the hand sits while pointing at something far away
const HOLD_GAP = 0.03;      // a held crayon hovers this far off the board, until the button presses it on
const SNAP = 0.07;          // a pinch snaps to a grabbable thing this close to the pointer's ray
const TWO_HAND_GAP = 0.12;  // Shift: left hand this far to the left of the right one
const WALK_SPEED = 1.2;
const TURN_SPEED = 1.6;
const MOUSE_LOOK = 0.004;   // radians per pixel with Alt held
const MIN_EYE = 0.7;
const MAX_EYE = 1.8;
const CROUCH_SPEED = 0.8;

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _anchor = new THREE.Vector3();
const _target = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _plane = new THREE.Plane();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const UP = new THREE.Vector3(0, 1, 0);

function visibleInScene(o) {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
}

export class TourControls {
    constructor(app, device) {
        this.app = app;
        this.device = device;
        this.yaw = 0;
        this.pitch = -0.35;     // looking a little down at the board
        this.eye = 1.5;
        this.mouse = new THREE.Vector2(innerWidth / 2, innerHeight * 0.62);
        this.touching = false;
        this.pinching = false;
        this.twoHands = false;
        this.keys = new Set();
        this.holdDepth = POINT_DEPTH;
        // Fingertip / pinch-point offsets in hand space, refined from the real joints each frame.
        // (Starting values measured from IWER's Quest 3 hand poses.)
        this.offsets = {
            right: { tip: new THREE.Vector3(-0.034, 0.064, -0.034), pinch: new THREE.Vector3(0.0005, -0.025, -0.012) },
            left: { tip: new THREE.Vector3(0.034, 0.064, -0.034), pinch: new THREE.Vector3(-0.0005, -0.025, -0.012) },
        };
        this.listen();
        device.position.set(0, this.eye, 0);
    }

    get active() {
        return this.app.renderer.xr.isPresenting;
    }

    listen() {
        const el = this.app.renderer.domElement;
        addEventListener('pointermove', (e) => {
            if (!this.active) return;
            if (e.altKey) {
                this.yaw -= e.movementX * MOUSE_LOOK;
                this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * MOUSE_LOOK, -1.4, 1.4);
                return;
            }
            this.mouse.set(e.clientX, e.clientY);
        });
        el.addEventListener('pointerdown', (e) => {
            if (!this.active) return;
            this.mouse.set(e.clientX, e.clientY);
            if (e.button === 0) this.touching = true;
            if (e.button === 2) this.setPinch(true);
        });
        addEventListener('pointerup', (e) => {
            if (e.button === 0) this.touching = false;
            if (e.button === 2) this.setPinch(false);
        });
        el.addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });
        addEventListener('keydown', (e) => {
            if (!this.active) return;
            if (e.code === 'Space') { this.setPinch(true); e.preventDefault(); }
            if (e.key === 'Shift') this.twoHands = true;
            if (e.key === 'Escape') this.app.renderer.xr.getSession()?.end();
            this.keys.add(e.code);
        });
        addEventListener('keyup', (e) => {
            if (e.code === 'Space') this.setPinch(false);
            if (e.key === 'Shift') this.twoHands = false;
            this.keys.delete(e.code);
        });
        addEventListener('blur', () => {
            this.keys.clear();
            this.touching = false;
            this.setPinch(false);
            this.twoHands = false;
        });
    }

    setPinch(on) {
        if (on === this.pinching) return;
        this.pinching = on;
        if (on) {
            // Out of reach: a point-and-pinch, so the hand stays where it was, still pointing.
            const d = this.aimDistance ?? Infinity;
            this.holdDepth = d <= REACH ? Math.max(d, 0.2) : POINT_DEPTH;
            this.snapPending = true;
        }
    }

    // Thin things (the wand, a crayon) are easy to miss with the pointer, so a new pinch grabs at the
    // depth of whatever grabbable thing lies closest to the ray.
    snapPinch() {
        const app = this.app;
        const spots = [];
        if (app.appState === 'DRAWING') {
            for (const item of app.tray.items) if (item.tool !== 'done') spots.push(item.object.getWorldPosition(new THREE.Vector3()));
            spots.push(app.canvasHandle.getWorldPosition(new THREE.Vector3()));
        }
        if (app.ball.group.visible) spots.push(app.ball.position.clone());
        const c = app.character;
        if (c && this.twoHands) spots.push(c.body ? c.body.position.clone() : c.pivot.getWorldPosition(new THREE.Vector3()));
        let best = this.twoHands ? SNAP * 3 : SNAP; // a character is a big target
        for (const p of spots) {
            const t = _v.subVectors(p, _origin).dot(_dir);
            if (t < 0.1 || t > REACH) continue;
            const off = _ray.ray.distanceToPoint(p);
            if (off < best) {
                best = off;
                this.holdDepth = t;
            }
        }
    }

    // Called every frame while presenting, before the app reads the hands.
    update(dt) {
        this.moveHead(dt);
        const cam = this.app.renderer.xr.getCamera();
        const view = cam.cameras?.[0] ?? cam;
        if (!view.matrixWorld) return;

        // The pointer's ray from the eye.
        _ndc.set((this.mouse.x / innerWidth) * 2 - 1, -(this.mouse.y / innerHeight) * 2 + 1);
        _ray.setFromCamera(_ndc, view);
        _origin.copy(_ray.ray.origin);
        _dir.copy(_ray.ray.direction);

        const hit = this.aim();
        this.aimDistance = hit ? hit.distance : Infinity;
        const right = this.offsets.right;
        let usePinchPoint = this.pinching;

        if (this.pinching && this.heldTool()) {
            // Holding a crayon or the eraser: slide its tip over the board's plane.
            const board = this.app.canvasGroup;
            _normal.set(0, 0, 1).applyQuaternion(board.getWorldQuaternion(_q));
            _plane.setFromNormalAndCoplanarPoint(_normal, board.getWorldPosition(_v));
            if (_ray.ray.intersectPlane(_plane, _anchor)) {
                const tip = TOOL_TIP[this.app.toolHold.item.tool];
                _anchor.addScaledVector(_normal, tip + (this.touching ? -PRESS : HOLD_GAP));
            } else {
                _anchor.copy(_origin).addScaledVector(_dir, this.holdDepth);
            }
        } else if (this.pinching) {
            if (this.snapPending) this.snapPinch();
            // Carrying something (or a far pinch): keep it at the depth where the pinch began.
            _anchor.copy(_origin).addScaledVector(_dir, Math.min(this.holdDepth, REACH));
        } else if (hit && hit.distance <= REACH) {
            _anchor.copy(hit.point).addScaledVector(_dir, this.touching ? PRESS : -HOVER);
            usePinchPoint = false;
        } else {
            _anchor.copy(_origin).addScaledVector(_dir, POINT_DEPTH); // pointing at something far away
        }

        // Point the hand along the ray, then place it so the chosen finger point lands on the anchor.
        _m.lookAt(_v.set(0, 0, 0), _dir, UP);
        _q.setFromRotationMatrix(_m);
        // Shift: both hands, centred on the pointer, either side of it.
        _right.set(1, 0, 0).applyQuaternion(view.getWorldQuaternion(_qInv));
        if (this.twoHands) _anchor.addScaledVector(_right, TWO_HAND_GAP / 2);
        this.placeHand('right', _anchor, _q, usePinchPoint ? right.pinch : right.tip, this.pinching ? 1 : 0);

        if (this.twoHands) {
            _target.copy(_anchor).addScaledVector(_right, -TWO_HAND_GAP);
            const left = this.offsets.left;
            this.placeHand('left', _target, _q, usePinchPoint ? left.pinch : left.tip, this.pinching ? 1 : 0);
        } else {
            // Resting low and to the side, out of the way.
            _fwd.set(0, 0, -1).applyAxisAngle(UP, this.yaw);
            _right.set(1, 0, 0).applyAxisAngle(UP, this.yaw);
            _target.set(0, this.eye - 0.55, 0).addScaledVector(_fwd, 0.2).addScaledVector(_right, -0.3);
            _q.setFromAxisAngle(UP, this.yaw);
            this.placeHand('left', _target, _q, this.offsets.left.tip, 0);
        }
        this.measure();
        this.snapPending = false;
    }

    heldTool() {
        const hold = this.app.toolHold;
        return hold && hold.by === this.handState('right');
    }

    moveHead(dt) {
        const k = this.keys;
        if (k.has('ArrowLeft')) this.yaw += TURN_SPEED * dt;
        if (k.has('ArrowRight')) this.yaw -= TURN_SPEED * dt;
        if (k.has('ArrowUp')) this.pitch = Math.min(this.pitch + TURN_SPEED * dt, 1.4);
        if (k.has('ArrowDown')) this.pitch = Math.max(this.pitch - TURN_SPEED * dt, -1.4);
        if (k.has('KeyQ')) this.eye = Math.max(this.eye - CROUCH_SPEED * dt, MIN_EYE);
        if (k.has('KeyE')) this.eye = Math.min(this.eye + CROUCH_SPEED * dt, MAX_EYE);
        _fwd.set(0, 0, -1).applyAxisAngle(UP, this.yaw);
        _right.set(1, 0, 0).applyAxisAngle(UP, this.yaw);
        _v.set(0, 0, 0);
        if (k.has('KeyW')) _v.add(_fwd);
        if (k.has('KeyS')) _v.sub(_fwd);
        if (k.has('KeyD')) _v.add(_right);
        if (k.has('KeyA')) _v.sub(_right);
        const p = this.device.position;
        if (_v.lengthSq() > 0) {
            _v.normalize().multiplyScalar(WALK_SPEED * dt);
            p.set(p.x + _v.x, this.eye, p.z + _v.z);
        } else {
            p.set(p.x, this.eye, p.z);
        }
        _euler.set(this.pitch, this.yaw, 0);
        _q.setFromEuler(_euler);
        this.device.quaternion.set(_q.x, _q.y, _q.z, _q.w);
    }

    // The nearest visible, touchable thing under the pointer.
    aim() {
        const app = this.app;
        const targets = [];
        const add = (o) => { if (o && visibleInScene(o)) targets.push(o); };
        if (app.appState === 'DRAWING') {
            add(app.canvasMesh);
            add(app.tray.children[0]); // the tray's shelf
            app.tray.items.forEach((item) => { if (!item.held) add(item.object); });
            add(app.canvasHandle);
            add(app.exitBtn);
        }
        if (app.playGuide.visible) add(app.drawAgainBtn);
        if (app.exitDiamond.visible) add(app.exitHit);
        if (app.ball.group.visible && app.ballHand == null) add(app.ball.ball);
        if (app.character && !app.grab) add(app.character.root);
        const hits = _ray.intersectObjects(targets, true).filter((h) => visibleInScene(h.object) || h.object === app.exitHit);
        if (hits[0]) return hits[0];
        // Otherwise the floor, so things lying on it can be reached after crouching.
        _plane.set(UP, 0);
        if (_ray.ray.intersectPlane(_plane, _target)) return { point: _target.clone(), distance: _target.distanceTo(_origin) };
        return null;
    }

    // Which of the app's three.js hands belongs to this emulated hand (whichever is closer to it).
    handState(side) {
        const pos = this.device.hands[side].position;
        _v.set(pos.x, pos.y, pos.z);
        let best = null;
        let bestD = Infinity;
        for (const hand of this.app.hands) {
            const tip = hand.joints['index-finger-tip'];
            if (!hand.visible || !tip?.visible) continue;
            const d = tip.getWorldPosition(_target).distanceTo(_v);
            if (d < bestD) {
                bestD = d;
                best = hand;
            }
        }
        return best?.userData ?? null;
    }

    placeHand(side, anchor, q, offset, pinch) {
        const hand = this.device.hands[side];
        _v.copy(offset).applyQuaternion(q);
        hand.position.set(anchor.x - _v.x, anchor.y - _v.y, anchor.z - _v.z);
        hand.quaternion.set(q.x, q.y, q.z, q.w);
        if (hand.pinchValue !== pinch) hand.updatePinchValue(pinch);
    }

    // Refine the fingertip and pinch-point offsets from the joints three.js received last frame.
    measure() {
        for (const side of ['left', 'right']) {
            const ip = this.device.hands[side];
            const pos = _origin.set(ip.position.x, ip.position.y, ip.position.z);
            _qInv.set(ip.quaternion.x, ip.quaternion.y, ip.quaternion.z, ip.quaternion.w).invert();
            for (const hand of this.app.hands) {
                const tip = hand.joints['index-finger-tip'];
                const thumb = hand.joints['thumb-tip'];
                if (!hand.visible || !tip?.visible || !thumb?.visible) continue;
                tip.getWorldPosition(_target);
                if (_target.distanceTo(pos) > 0.25) continue; // the other hand
                const o = this.offsets[side];
                if (ip.pinchValue > 0.99) {
                    thumb.getWorldPosition(_v);
                    o.pinch.lerp(_target.add(_v).multiplyScalar(0.5).sub(pos).applyQuaternion(_qInv), 0.5);
                } else if (ip.pinchValue < 0.01) {
                    o.tip.lerp(_target.sub(pos).applyQuaternion(_qInv), 0.5);
                }
            }
        }
    }
}
