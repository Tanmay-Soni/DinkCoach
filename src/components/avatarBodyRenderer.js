/**
 * Canvas2D volumetric-body renderer for the composite avatar.
 *
 * Paints the composite's normalized keypoints as a fleshed-out mannequin — head,
 * neck, filled torso, tapered capsule limbs — then the tracked landmarks as
 * markers, then fault rings. This is deliberately NOT MediaPipe DrawingUtils
 * (which only draws thin lines/dots). Framework-agnostic; the React wrapper is
 * CompositeAvatarPlayer.jsx.
 */

import {
  POSE_BONES,
  BODY_RADII,
  BODY_COLORS,
} from '../lib/avatar/constants.js';

const R = BODY_RADII;
const C = BODY_COLORS;

const LIMBS = [
  ['leftShoulder', 'leftElbow', 'upperArm'],
  ['rightShoulder', 'rightElbow', 'upperArm'],
  ['leftElbow', 'leftWrist', 'forearm'],
  ['rightElbow', 'rightWrist', 'forearm'],
  ['leftHip', 'leftKnee', 'thigh'],
  ['rightHip', 'rightKnee', 'thigh'],
  ['leftKnee', 'leftAnkle', 'shin'],
  ['rightKnee', 'rightAnkle', 'shin'],
];

function project(keypoints, joint, width, height, mirror) {
  const kp = keypoints[joint];
  if (!kp) {
    return null;
  }
  const x = mirror ? (1 - kp[0]) * width : kp[0] * width;
  return [x, kp[1] * height];
}

function disc(ctx, point, radius) {
  if (!point) {
    return;
  }
  ctx.beginPath();
  ctx.arc(point[0], point[1], radius, 0, Math.PI * 2);
  ctx.fill();
}

function capsule(ctx, a, b, ra, rb) {
  if (!a || !b) {
    return;
  }
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  ctx.beginPath();
  ctx.moveTo(a[0] + nx * ra, a[1] + ny * ra);
  ctx.lineTo(b[0] + nx * rb, b[1] + ny * rb);
  ctx.lineTo(b[0] - nx * rb, b[1] - ny * rb);
  ctx.lineTo(a[0] - nx * ra, a[1] - ny * ra);
  ctx.closePath();
  ctx.fill();
  disc(ctx, a, ra);
  disc(ctx, b, rb);
}

function midpoint(a, b) {
  if (!a || !b) {
    return null;
  }
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

// One rim/fill pass over the whole body. pad > 0 draws the bright outline underlay.
function bodyPass(ctx, P, u, color, pad) {
  ctx.fillStyle = color;
  const f = (radius) => radius + pad;
  const { leftShoulder, rightShoulder, leftHip, rightHip } = P;

  if (leftShoulder && rightShoulder && leftHip && rightHip) {
    const pts = [leftShoulder, rightShoulder, rightHip, leftHip];
    const cx = (leftShoulder[0] + rightShoulder[0] + leftHip[0] + rightHip[0]) / 4;
    const cy = (leftShoulder[1] + rightShoulder[1] + leftHip[1] + rightHip[1]) / 4;
    const ex = R.torsoExpandX * u + pad;
    const ey = 0.03 * u + pad;
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const px = x + (x > cx ? ex : -ex);
      const py = y + (y > cy ? ey : -ey);
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    });
    ctx.closePath();
    ctx.fill();
  }

  const shoulderMid = midpoint(leftShoulder, rightShoulder);
  const hipMid = midpoint(leftHip, rightHip);
  disc(ctx, leftShoulder, f(R.shoulderBall));
  disc(ctx, rightShoulder, f(R.shoulderBall));
  disc(ctx, leftHip, f(R.hipBall));
  disc(ctx, rightHip, f(R.hipBall));
  disc(ctx, shoulderMid, f(R.shoulderBall));
  disc(ctx, hipMid, f(R.hipBall));
  capsule(ctx, shoulderMid, hipMid, f(R.shoulderBall), f(R.hipBall));

  for (const [a, b, kind] of LIMBS) {
    const [r0, r1] = R[kind];
    capsule(ctx, P[a], P[b], f(u * r0), f(u * r1));
  }

  disc(ctx, P.leftWrist, f(u * R.hand));
  disc(ctx, P.rightWrist, f(u * R.hand));
  disc(ctx, P.leftAnkle, f(u * R.foot));
  disc(ctx, P.rightAnkle, f(u * R.foot));

  if (P.nose) {
    const headC = [P.nose[0], P.nose[1] - 0.04 * u];
    const hrx = R.headRx * u + pad;
    const hry = R.headRy * u + pad;
    capsule(ctx, shoulderMid, [headC[0], headC[1] + hry * 0.6], f(u * R.neck), f(u * R.neck * 0.9));
    ctx.beginPath();
    ctx.ellipse(headC[0], headC[1], hrx, hry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFloorShadow(ctx, P, u) {
  const la = P.leftAnkle;
  const ra = P.rightAnkle;
  if (!la && !ra) {
    return;
  }
  const cx = ((la ? la[0] : ra[0]) + (ra ? ra[0] : la[0])) / 2;
  const cy = Math.max(la ? la[1] : 0, ra ? ra[1] : 0) + 6;
  const rw = (la && ra ? Math.abs(ra[0] - la[0]) : u) * 1.7 + 22;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, rw);
  gradient.addColorStop(0, 'rgba(0,245,212,0.16)');
  gradient.addColorStop(1, 'rgba(0,245,212,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rw, 8, 0, 0, Math.PI * 2);
  ctx.fill();
}

function faultRingColor(joint) {
  return joint.includes('Elbow') || joint.includes('Wrist') || joint === 'rightShoulder' || joint === 'leftShoulder'
    ? C.faultSwing
    : C.faultKnee;
}

function drawFaultRing(ctx, point, pulse, joint) {
  const radius = 9 + pulse * 4;
  ctx.save();
  ctx.strokeStyle = faultRingColor(joint);
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.35 + pulse * 0.45;
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(point[0], point[1], radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw one composite frame as a volumetric body.
 * @param opts { width, height, mirror, highlightJoints, pulse }
 */
export function drawBodyFrame(ctx, keypoints, opts) {
  const { width, height, mirror = true, highlightJoints = [], pulse = 1 } = opts;

  const P = {};
  for (const joint of Object.keys(keypoints)) {
    P[joint] = project(keypoints, joint, width, height, mirror);
  }

  const u =
    P.leftShoulder && P.rightShoulder
      ? Math.abs(P.rightShoulder[0] - P.leftShoulder[0]) || width * 0.12
      : width * 0.12;

  drawFloorShadow(ctx, P, u);
  bodyPass(ctx, P, u, C.outline, 3);
  bodyPass(ctx, P, u, C.fill, 0);

  const shoulderMid = midpoint(P.leftShoulder, P.rightShoulder);
  const hipMid = midpoint(P.leftHip, P.rightHip);
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = C.light;
  capsule(ctx, shoulderMid, hipMid, u * R.shoulderBall * 0.42, u * R.hipBall * 0.42);
  ctx.restore();

  for (const joint of Object.keys(keypoints)) {
    const point = P[joint];
    if (!point) {
      continue;
    }
    ctx.fillStyle = C.socket;
    disc(ctx, point, 6);
    ctx.fillStyle = C.joint;
    disc(ctx, point, 4.5);
  }

  for (const joint of highlightJoints) {
    if (P[joint]) {
      drawFaultRing(ctx, P[joint], pulse, joint);
    }
  }
}

/** Faint per-rep wireframe for the "ghost" spread behind the body. */
export function drawGhostWireframe(ctx, keypoints, opts) {
  const { width, height, mirror = true, alpha = 0.12 } = opts;
  ctx.save();
  ctx.strokeStyle = `rgba(0,245,212,${alpha})`;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  for (const [a, b] of POSE_BONES) {
    const pa = project(keypoints, a, width, height, mirror);
    const pb = project(keypoints, b, width, height, mirror);
    if (!pa || !pb) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(pa[0], pa[1]);
    ctx.lineTo(pb[0], pb[1]);
    ctx.stroke();
  }
  ctx.restore();
}
