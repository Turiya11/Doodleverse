import * as THREE from 'three';

// Simple cartoon physics for the awakened character once it has been picked up: it follows whatever
// holds it, flies at the release velocity, bounces with a squash on landing, then does happy hops.
// Created on the first grab; until then the character hovers on its scripted idle animation.

const GRAVITY = 6;              // m/s², softer than real gravity so throws read floaty and cartoonish
const MAX_SPEED = 6;
const BOUNCE = 0.45;            // fraction of downward speed kept on each bounce
const GROUND_FRICTION = 0.6;    // fraction of sideways speed kept on each bounce
const SETTLE_SPEED = 0.8;       // impacts slower than this stop bouncing
const HOPS = 2;
const HOP_SPEED = 1.8;
const HOP_DELAY = 0.25;
const TURN_RATE = 4;
const HOME_RANGE = 2.5;         // landed farther than this from the user (maybe through a real wall):
const HOME_HOP_SPEED = 1.4;     // ...it hops back toward them at this sideways speed
const HOME_RANGE_STOP = 1.2;
const CHASE_SPEED = 2.2;        // fastest sideways hop speed when fetching the ball
const CHASE_HOP_DELAY = 0.12;   // eager: barely pauses between hops
const CHASE_LEAD = 0.3;         // seconds of the ball's motion to aim ahead by
const JUMP_REACH = 0.35;        // ball within this horizontal distance and...
const JUMP_MIN = 0.15;          // ...at least this far above: jump up for it
const MAX_JUMP = 4;

const _prev = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

export class CharacterBody {
    // `root` > `pivot` > `content` is the rig from the awakening. The pivot's world transform becomes the
    // root's so the body moves about the character's own centre.
    constructor(root, pivot, content) {
        this.root = root;
        this.pivot = pivot;

        pivot.getWorldPosition(root.position);
        const yaw = new THREE.Euler().setFromQuaternion(pivot.getWorldQuaternion(_q), 'YXZ').y;
        root.quaternion.setFromAxisAngle(_up, yaw);
        pivot.position.set(0, 0, 0);
        pivot.rotation.set(0, 0, 0);
        root.updateMatrixWorld(true);

        // Distance from the centre down to the character's lowest point, for resting on the floor.
        const box = new THREE.Box3().setFromObject(content);
        this.bottomOffset = root.position.y - box.min.y;

        this.velocity = new THREE.Vector3();
        this.state = 'held';    // held | flying | resting
        this.thrown = false;
        this.hopsLeft = 0;
        this.hopTimer = 0;
        this.squash = 0;
        this.chasing = false;
        this.chaseTarget = new THREE.Vector3();
    }

    get position() {
        return this.root.position;
    }

    hold(target, dt) {
        _prev.copy(this.root.position);
        this.root.position.copy(target);
        // Smoothed so one jittery frame of hand tracking doesn't decide the throw.
        if (dt > 0) this.velocity.lerp(_vel.subVectors(target, _prev).divideScalar(dt), 0.4);
        this.state = 'held';
    }

    release() {
        this.velocity.clampLength(0, MAX_SPEED);
        this.state = 'flying';
        this.thrown = true;
    }

    // `headPos` is the user (for hopping home); `lookPos` is what it watches: their head, or a hand nearby.
    update(dt, headPos, lookPos, floorY) {
        if (this.state !== 'held') this.step(dt, floorY, headPos);

        // Squash-and-stretch on landing.
        const s = this.squash;
        this.pivot.scale.set(1 + s * 0.5, 1 - s, 1 + s * 0.5);
        this.squash *= Math.exp(-dt * 8);

        // Turn to face what it's watching (its front is local +Z), and tip up or down toward it.
        const p = this.root.position;
        const dx = lookPos.x - p.x;
        const dz = lookPos.z - p.z;
        _q.setFromAxisAngle(_up, Math.atan2(dx, dz));
        const k = 1 - Math.exp(-dt * TURN_RATE);
        this.root.quaternion.slerp(_q, k);
        const pitch = THREE.MathUtils.clamp(-Math.atan2(lookPos.y - p.y, Math.hypot(dx, dz)), -0.5, 0.5);
        this.pivot.rotation.x += (pitch - this.pivot.rotation.x) * k;
    }

    step(dt, floorY, facePos) {
        const p = this.root.position;
        const v = this.velocity;

        if (this.state === 'flying') {
            v.y -= GRAVITY * dt;
            p.addScaledVector(v, dt);
        }

        const ground = floorY + this.bottomOffset;
        if (this.state === 'flying' && p.y <= ground && v.y <= 0) {
            p.y = ground;
            const impact = -v.y;
            if (impact > SETTLE_SPEED) {
                v.y = impact * BOUNCE;
                v.x *= GROUND_FRICTION;
                v.z *= GROUND_FRICTION;
                this.squash = Math.min(0.35, impact * 0.08);
            } else {
                v.set(0, 0, 0);
                this.squash = Math.max(this.squash, 0.2);
                this.state = 'resting';
                this.hopTimer = HOP_DELAY;
                if (this.thrown) {
                    this.hopsLeft = HOPS; // a landing after a throw earns a couple of happy hops
                    this.thrown = false;
                }
            }
        }

        // Fetching the ball beats everything else: hop after it, or jump for it if it's overhead.
        if (this.state === 'resting' && this.chasing) {
            this.hopsLeft = 0;
            this.homing = false;
            this.hopTimer = Math.min(this.hopTimer, CHASE_HOP_DELAY) - dt;
            if (this.hopTimer <= 0) this.chaseHop(p, v);
            return;
        }

        if (this.state === 'resting' && this.hopsLeft > 0) {
            this.hopTimer -= dt;
            if (this.hopTimer <= 0) {
                this.hopsLeft--;
                v.set(0, HOP_SPEED, 0);
                this.squash = 0.25; // crouch before the jump
                this.state = 'flying';
            }
        }

        // Too far to reach: hop home, one hop at a time, until it's back within arm's reach-ish.
        if (this.state === 'resting' && this.hopsLeft === 0) {
            const dx = facePos.x - p.x;
            const dz = facePos.z - p.z;
            const dist = Math.hypot(dx, dz);
            if (dist > HOME_RANGE || (this.homing && dist > HOME_RANGE_STOP)) {
                this.homing = true;
                this.hopTimer -= dt;
                if (this.hopTimer <= 0) {
                    v.set((dx / dist) * HOME_HOP_SPEED, HOP_SPEED, (dz / dist) * HOME_HOP_SPEED);
                    this.squash = 0.25;
                    this.state = 'flying';
                }
            } else {
                this.homing = false;
            }
        }
    }

    // Go after a target (the ball). `targetVel` lets it lead a rolling ball a little.
    chase(target, targetVel) {
        this.chasing = true;
        this.chaseTarget.copy(target).addScaledVector(targetVel, CHASE_LEAD);
        this.chaseTarget.y = target.y;
    }

    chaseHop(p, v) {
        const t = this.chaseTarget;
        const dx = t.x - p.x;
        const dz = t.z - p.z;
        const dist = Math.hypot(dx, dz) || 1e-6;
        const above = t.y - p.y;

        if (dist < JUMP_REACH && above > JUMP_MIN) {
            // Right underneath it: jump straight up to meet it.
            v.set((dx / dist) * 0.3, Math.min(Math.sqrt(2 * GRAVITY * above), MAX_JUMP), (dz / dist) * 0.3);
        } else {
            // Hop toward it, covering the remaining distance in one hop if that's not too far.
            const airTime = (2 * HOP_SPEED) / GRAVITY;
            const speed = Math.min(dist / airTime, CHASE_SPEED);
            v.set((dx / dist) * speed, HOP_SPEED, (dz / dist) * speed);
        }
        this.squash = 0.25;
        this.state = 'flying';
    }
}
