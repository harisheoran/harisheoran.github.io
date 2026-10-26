import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./kit/iso-kit.mjs";
import { kitScript } from "./scripts/inline-kit.mjs";
import { LAYERS, PAYLOAD, U_PER_BYTE, sizeAfter, FRAME_BYTES, FRAME_BITS } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";

const WIDTH = 880;
const HEIGHT = 420;

/* ---------------------------------------------------------------- world */

const PLATE = { x: -182, y: -72, w: 392, d: 146, r: 9 };
const PLATE_H = 12;
const FOOT_H = 5;

const RAIL_BACK = -26;
const RAIL_FRONT = 14;
const RAIL_FROM = -166;
const RAIL_TO = 150;
const RAIL_H = 3;

const SCREW_Y = -42;
const SCREW_Z = 7;
const SCREW_R = 3.4;

const STATION_X = [-120, -80, -40, 0, 40, 80, 120];
const PORTAL_X = [-140, 140];
const POST_BACK = -54;
const POST_FRONT = 40;
const POST_R = 4.2;
const POST_TOP = 60;

const BEAM_H = 10;
const BEAM_Z = POST_TOP;                 // 52 .. 62

const CAR = { x: -29, y: -32, w: 58, d: 56, r: 3 };
const CAR_Z = 3;
const CAR_TOP = 9;

const PARCEL_Y = -12;
const PARCEL_D = 18;
const PARCEL_H = 16;
const BED_H = 1.2;
const PARCEL_TOP = CAR_TOP + BED_H + PARCEL_H;   // 28.2
const PAY_RIGHT = 15;
const PAY_W = PAYLOAD * U_PER_BYTE;              // 30

// The ram presses just in front of the parcel's centreline, so it is always
// nearer the camera than the parcel and never has to be depth-sorted against it.
const RAM_Y = PARCEL_Y + PARCEL_D / 2;           // centred on the parcel
const RAM_DX = -12;                              // over the end collars land on
const RAM_R = 4.6;
const RAM_H = 7;
const RAM_REST = 44;
const RAM_DOWN = PARCEL_TOP;                     // down onto the parcel
const BARREL_Z = RAM_REST + RAM_H;               // 45 .. 52

const BEAM = { x: PORTAL_X[0] - 12, y: RAM_Y - 7, w: PORTAL_X[1] - PORTAL_X[0] + 24, d: 14, r: 3 };

const BOX = { x: 160, y: -20, w: 34, d: 52, r: 3 };
const BOX_H = 38;

const TRAVEL = [STATION_X[0], STATION_X[STATION_X.length - 1]];

const P = k.fitProjection(
  [
    ...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0),
    ...k.boxCorners(BEAM, BEAM_Z, BEAM_Z + BEAM_H + 12),
    [PORTAL_X[0], POST_BACK, POST_TOP],
    [PORTAL_X[1], POST_FRONT, POST_TOP],
    [BOX.x + BOX.w, BOX.y + BOX.d, BOX_H + 6],
  ],
  WIDTH,
  HEIGHT,
  { pad: 26, azimuth: 52 },
);

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (pts, style) => k.dotsSvg(pts, style);
const byDepth = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

/* -------------------------------------------------------- parcel layout */

const SEGMENTS = [];
{
  let left = PAY_RIGHT - PAY_W;
  let right = PAY_RIGHT;
  SEGMENTS.push({ station: 0, kind: "payload", from: left, to: right });
  LAYERS.forEach((layer, index) => {
    if (layer.head > 0) { const w = layer.head * U_PER_BYTE; SEGMENTS.push({ station: index, kind: "head", from: left - w, to: left }); left -= w; }
    if (layer.tail > 0) { const w = layer.tail * U_PER_BYTE; SEGMENTS.push({ station: index, kind: "tail", from: right, to: right + w }); right += w; }
  });
}

/* ------------------------------------------------------------- the base */

function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 26))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 9, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P, 9), { tone: "lo" }));
  const screws = k.corners(PLATE, 11);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));

  // T-slots down the bed, outside each way.
  for (const y of [RAIL_BACK - 10, RAIL_FRONT + 10]) {
    const slot = { x: RAIL_FROM + 4, y, w: RAIL_TO - RAIL_FROM - 8, d: 4, r: 1.6 };
    out.push(L(k.planOutline(slot, 0, P, 3), { tone: "faint" }));
    out.push(L(k.planOutline(k.insetPlan(slot, 1.2), 0, P, 3), { tone: "faint" }));
  }
  // Chip trough along the front edge: a closed recess with its own floor.
  const trough = { x: RAIL_FROM, y: PLATE.y + PLATE.d - 24, w: RAIL_TO - RAIL_FROM, d: 10, r: 2 };
  out.push(S(k.slabOf(trough, -3, 3, P, 4), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(trough, 0, P, 4), { tone: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(trough, 1.4), -3, P, 4), { tone: "faint" }));
  // Cable duct along the back, lid seam and fixings.
  const duct = { x: RAIL_FROM - 4, y: PLATE.y + 8, w: RAIL_TO - RAIL_FROM + 8, d: 11, r: 2 };
  out.push(S(k.slabOf(duct, 0, 7, P, 4, 0.5), { tone: "mid" }));
  out.push(L(k.sideSeam(duct, 4.4, P, 4), { tone: "faint" }));
  out.push(L(k.planOutline(k.insetPlan(duct, 2.4), 7, P, 4), { tone: "faint" }));
  out.push(D(Array.from({ length: 10 }, (_, i) => at([duct.x + 12 + i * ((duct.w - 24) / 9), duct.y + duct.d / 2, 7])), { size: 0.45, tone: "lo" }));

  // Stock tray at the front left: the spare collar blanks the magazines are
  // refilled from, in the four sizes the line actually sets.
  const tray = { x: PLATE.x + 16, y: 30, w: 86, d: 30, r: 2.5 };
  out.push(S(k.slabOf(tray, -2.4, 2.4, P, 4), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(tray, 0, P, 4), { tone: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(tray, 1.6), -2.4, P, 4), { tone: "faint" }));
  // One divider per size, and a short stack of blanks in each bay.
  const sizes = [14, 20, 20, 5];
  let bx = tray.x + 5;
  sizes.forEach((bytes, i) => {
    const w = Math.max(2.2, bytes * U_PER_BYTE);
    if (i) out.push(L(k.rise([bx - 2.5, tray.y + 2], -2.4, 0, P), { tone: "faint" }));
    for (let j = 0; j < 3; j++) {
      out.push(S(k.slabOf({ x: bx, y: tray.y + 5 + j * 0.6, w, d: 18, r: 0.8 }, -2.4 + j * 1.5, 1.5, P, 2), { tone: "hi", crease: "none" }));
    }
    bx += w + 7;
  });
  out.push(D(k.corners(tray, 2).map(([x, y]) => at([x, y, 0])), { size: 0.45, tone: "lo" }));

  // Ruler strip along the front, a major tick under each station.
  const strip = { x: STATION_X[0] - 10, y: PLATE.y + PLATE.d - 12, w: STATION_X[6] - STATION_X[0] + 20, d: 7, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const t = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 5, 8, strip.y + 0.8, 0.6, [2, 3.8], P);
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }));

  // Label plate, back left.
  const plan = { x: PLATE.x + 15, y: PLATE.y + 24, w: 48, d: 19, r: 2 };
  out.push(S(k.slabOf(plan, 0, 0.8, P, 4), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(plan, 1.6), 0.8, P, 4), { tone: "faint" }));
  [7, 12, 9].forEach((len, i) => {
    const y = plan.y + 5.6 + i * 3.8;
    out.push(L(k.lineOnTop([plan.x + 5, y], [plan.x + 5 + len * 2.4, y], 0.8, P), { tone: "lo", free: true }));
  });
  out.push(D([at([plan.x + 3, plan.y + 3, 0.8]), at([plan.x + plan.w - 3, plan.y + plan.d - 3, 0.8])], { size: 0.45 }));
  return out.join("");
}

function ways() {
  const out = [];
  for (const y of [RAIL_BACK, RAIL_FRONT]) {
    out.push(S(k.slabOf({ x: RAIL_FROM, y, w: RAIL_TO - RAIL_FROM, d: 5, r: 1 }, 0, RAIL_H, P, 3, 0.4), { tone: "mid" }));
    out.push(D([RAIL_FROM + 10, RAIL_TO - 10].map((x) => at([x, y + 2.5, RAIL_H])), { size: 0.4, tone: "lo" }));
  }
  // Leadscrew: back half of the thread, the shaft, then the front half.
  const helix = k.coil(RAIL_FROM + 12, RAIL_TO - 14, [SCREW_Y, SCREW_Z], SCREW_R, 38, "x", P);
  out.push(L(helix.back, { tone: "faint" }));
  out.push(S(k.slabOf({ x: RAIL_FROM + 8, y: SCREW_Y - SCREW_R, w: RAIL_TO - RAIL_FROM - 16, d: SCREW_R * 2, r: SCREW_R }, SCREW_Z - SCREW_R, SCREW_R * 2, P, 4), { tone: "mid", crease: "none" }));
  out.push(L(helix.front, { tone: "lo" }));
  for (const x of [RAIL_FROM + 3, RAIL_TO - 12]) {
    out.push(S(k.slabOf({ x, y: SCREW_Y - 7, w: 8, d: 14, r: 2 }, 0, 14, P, 3, 0.5), { tone: "mid" }));
    out.push(D([at([x + 4, SCREW_Y - 4.5, 14]), at([x + 4, SCREW_Y + 4.5, 14])], { size: 0.45, tone: "lo" }));
  }
  // Handwheel on the right end of the screw.
  const hw = RAIL_TO + 2;
  out.push(S(k.slabOf({ x: RAIL_TO - 6, y: SCREW_Y - SCREW_R, w: 10, d: SCREW_R * 2, r: SCREW_R }, SCREW_Z - SCREW_R, SCREW_R * 2, P, 4), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(hw, SCREW_Y, 10, SCREW_Z - 1.4, 2.8, P, 40, 0.5), { tone: "mid" }));
  out.push(L(k.knurl(hw, SCREW_Y, 10, SCREW_Z - 1.4, SCREW_Z + 1.4, 40, P, 0.3), { tone: "lo" }));
  out.push(L(k.ring(hw, SCREW_Y, 6.2, SCREW_Z + 1.4, P, 32), { tone: "faint" }));
  out.push(S(k.cylinder(hw, SCREW_Y, 2.6, SCREW_Z + 1.4, 3, P, 20), { tone: "mid" }));
  out.push(D([at([hw, SCREW_Y, SCREW_Z + 4.4])], { size: 0.5, tone: "hi" }));
  // End stops on the ways.
  for (const x of [RAIL_FROM - 6, RAIL_TO + 1]) {
    out.push(S(k.slabOf({ x, y: RAIL_BACK - 3, w: 5, d: RAIL_FRONT - RAIL_BACK + 11, r: 1.2 }, 0, 8, P, 3, 0.5), { tone: "mid" }));
    out.push(D([at([x + 2.5, RAIL_BACK + 2, 8]), at([x + 2.5, RAIL_FRONT + 3, 8])], { size: 0.45 }));
  }
  return out.join("");
}

/* ------------------------------------------------------ portals and beam */

function post(x, y) {
  const out = [];
  out.push(S(k.slabOf({ x: x - 8, y: y - 8, w: 16, d: 16, r: 3 }, 0, 4, P, 4, 0.6), { tone: "mid" }));
  out.push(D(k.corners({ x: x - 8, y: y - 8, w: 16, d: 16 }, 3).map(([cx, cy]) => at([cx, cy, 4])), { size: 0.45, tone: "lo" }));
  out.push(S(k.cylinder(x, y, POST_R, 4, POST_TOP - 4, P, 26), { tone: "mid", crease: "none" }));
  out.push(L([16, 32, 46].map((z) => k.sideArc(x, y, POST_R, z, P, 16)).join(""), { tone: "faint" }));
  return out.join("");
}

function portalHead(x) {
  const out = [];
  const head = { x: x - 9, y: POST_BACK - 7, w: 18, d: POST_FRONT - POST_BACK + 14, r: 3 };
  out.push(S(k.slabOf(head, POST_TOP, BEAM_H, P, 4, 0.7), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(head, 3.4), POST_TOP + BEAM_H, P, 4), { tone: "faint" }));
  out.push(D([POST_BACK, POST_FRONT].flatMap((y) => [at([x - 5, y, POST_TOP + BEAM_H]), at([x + 5, y, POST_TOP + BEAM_H])]), { size: 0.45 }));
  return out.join("");
}

function beam() {
  const out = [];
  out.push(S(k.slabOf(BEAM, BEAM_Z, BEAM_H, P, 4, 0.8), { tone: "mid" }));
  out.push(L(k.sideSeam(BEAM, BEAM_Z + BEAM_H - 3.2, P, 4), { tone: "faint" }));
  out.push(L(k.planOutline(k.insetPlan(BEAM, 3.2), BEAM_Z + BEAM_H, P, 4), { tone: "faint" }));
  // Bolt rows along the beam top, two per station bay.
  const bolts = [];
  for (let x = BEAM.x + 10; x <= BEAM.x + BEAM.w - 10; x += 20) {
    bolts.push(at([x, BEAM.y + 3, BEAM_Z + BEAM_H]), at([x, BEAM.y + BEAM.d - 3, BEAM_Z + BEAM_H]));
  }
  out.push(D(bolts, { size: 0.42, tone: "lo" }));
  return out.join("");
}

/* -------------------------------------------- one station under the beam */

function station(index) {
  const layer = LAYERS[index];
  const sx = STATION_X[index];
  const rx = sx + RAM_DX;
  const bytes = layer.head + layer.tail;
  const out = [];

  // Depth stop standing on the beam: its height IS this layer's byte count.
  const stopH = 3 + bytes * 0.42;
  out.push(S(k.slabOf({ x: sx - 6, y: BEAM.y + 2, w: 12, d: 10, r: 2 }, BEAM_Z + BEAM_H, 2.6, P, 3, 0.4), { tone: "mid" }));
  out.push(S(k.cylinder(sx, BEAM.y + 7, 2.6, BEAM_Z + BEAM_H + 2.6, stopH, P, 20), { tone: "mid" }));
  out.push(L(k.knurl(sx, BEAM.y + 7, 2.6, BEAM_Z + BEAM_H + 2.6, BEAM_Z + BEAM_H + 2.6 + stopH, 16, P), { tone: "lo" }));
  out.push(D([at([sx, BEAM.y + 7, BEAM_Z + BEAM_H + 2.6 + stopH])], { size: 0.52, tone: bytes > 0 ? "hi" : "lo" }));

  // Collar magazine hanging off the back face of the beam: one blank per
  // collar this layer sets, so the empty stations read as empty.
  const count = (layer.head > 0 ? 1 : 0) + (layer.tail > 0 ? 1 : 0);
  const mag = { x: sx - 7, y: BEAM.y - 8, w: 14, d: 8, r: 1.2 };
  out.push(S(k.slabOf(mag, BEAM_Z - 7, 3, P, 3, 0.4), { tone: "mid" }));
  for (let i = 0; i < count; i++) {
    out.push(S(k.slabOf(k.insetPlan(mag, 2 + i * 0.5), BEAM_Z - 4 + i * 2.2, 1.8, P, 2), { tone: "hi", crease: "none" }));
  }
  out.push(D([at([mag.x + 2.5, mag.y + 4, BEAM_Z - 4]), at([mag.x + mag.w - 2.5, mag.y + 4, BEAM_Z - 4])], { size: 0.4, tone: "lo" }));

  // Guide barrel, the rod inside it, and the ram that presses the collar on.
  out.push(`<g data-rod="${index}" transform="${k.translateAlong(P, [0, 0, RAM_REST])}">`
    + S(k.cylinder(rx, RAM_Y, 2.6, RAM_H, 14, P, 20), { tone: "mid", crease: "none" })
    + `</g>`);
  out.push(S(k.cylinder(rx, RAM_Y, 3.4, BARREL_Z, BEAM_Z - BARREL_Z, P, 24), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(rx, RAM_Y, 4.8, BARREL_Z, 3.2, P, 24, 0.5), { tone: "mid" }));
  out.push(L(k.sideArc(rx, RAM_Y, 3.4, BEAM_Z - 3, P, 16), { tone: "faint" }));
  out.push(D([at([rx - 3.2, RAM_Y - 3.2, BARREL_Z + 3.2]), at([rx + 3.2, RAM_Y + 3.2, BARREL_Z + 3.2])], { size: 0.4, tone: "lo" }));

  const ram = [];
  ram.push(S(k.slabOf({ x: rx - 6, y: RAM_Y - 6.5, w: 12, d: 13, r: 1.5 }, 0, 2.6, P, 3, 0.4), { tone: "mid" }));
  ram.push(D([at([rx - 3.8, RAM_Y - 4.2, 2.6]), at([rx + 3.8, RAM_Y + 4.2, 2.6])], { size: 0.42, tone: "lo" }));
  ram.push(S(k.cylinder(rx, RAM_Y, RAM_R, 2.6, RAM_H - 2.6, P, 24, 0.6), { tone: "mid" }));
  out.push(`<g data-ram="${index}" transform="${k.translateAlong(P, [0, 0, RAM_REST])}">${ram.join("")}</g>`);
  return out.join("");
}

/* ---------------------------------------------------------- the carriage */

function carriage() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(CAR, 4), CAR_Z, 0.1, P)}" style="filter:blur(4px)"/>`];
  // Nut block reaching back to the leadscrew.
  out.push(S(k.slabOf({ x: -10, y: SCREW_Y - 2, w: 20, d: CAR.y - SCREW_Y + 5, r: 2 }, CAR_Z + 1, 7, P, 3, 0.5), { tone: "mid" }));
  out.push(S(k.slabOf({ x: -12, y: SCREW_Y - 6.5, w: 24, d: 13, r: 2.5 }, SCREW_Z - 6.5, 13, P, 4, 0.6), { tone: "mid" }));
  out.push(D([at([-7.5, SCREW_Y - 6.5, SCREW_Z + 6.5]), at([7.5, SCREW_Y - 6.5, SCREW_Z + 6.5])], { size: 0.45, tone: "lo" }));

  out.push(S(k.slabOf(CAR, CAR_Z, CAR_TOP - CAR_Z, P, 4, 0.6), { tone: "mid" }));
  out.push(L(k.lineOnTop([CAR.x, RAIL_BACK + 2.5], [CAR.x + CAR.w, RAIL_BACK + 2.5], CAR_TOP, P), { tone: "faint" }));
  out.push(L(k.lineOnTop([CAR.x, RAIL_FRONT + 2.5], [CAR.x + CAR.w, RAIL_FRONT + 2.5], CAR_TOP, P), { tone: "faint" }));
  for (const [bx, by] of [[CAR.x + 5, RAIL_BACK], [CAR.x + CAR.w - 13, RAIL_BACK], [CAR.x + 5, RAIL_FRONT], [CAR.x + CAR.w - 13, RAIL_FRONT]]) {
    out.push(S(k.slabOf({ x: bx, y: by - 1.5, w: 8, d: 8, r: 1.5 }, CAR_TOP, 3.4, P, 3, 0.4), { tone: "mid" }));
    out.push(D([at([bx + 4, by + 2.5, CAR_TOP + 3.4])], { size: 0.45, tone: "lo" }));
  }
  out.push(D([-22, -11, 0, 11, 22].map((x) => at([x, CAR.y + CAR.d - 3, CAR_TOP])), { size: 0.4, tone: "lo" }));
  out.push(S(k.slabOf({ x: CAR.x + 2, y: PARCEL_Y - 2, w: CAR.w - 4, d: PARCEL_D + 4, r: 1.5 }, CAR_TOP, BED_H, P, 3), { tone: "lo", crease: "none" }));
  return out.join("");
}

function parcel() {
  const out = [];
  for (const seg of SEGMENTS) {
    const isPay = seg.kind === "payload";
    // A collar wraps the parcel, so it stands proud of the core on every face.
    // That is what makes the headers read as separate bands rather than one block.
    // Proud around the SIDES only, flush on top: a band that wraps the core,
    // not a fin standing above it.
    const grow = isPay ? 0 : 1.8;
    const plan = { x: seg.from, y: PARCEL_Y - grow, w: seg.to - seg.from, d: PARCEL_D + grow * 2, r: 1 };
    const top = PARCEL_H;
    const body = [
      S(k.slabOf(plan, CAR_TOP + BED_H, top, P, 3, 0.5), { tone: "hi", crease: "lo", lit: isPay }),
      L(k.planOutline(k.insetPlan(plan, 1.6), CAR_TOP + BED_H + top, P, 3), { tone: "faint" }),
    ].join("");
    if (isPay) out.push(`<g data-seg="payload">${body}</g>`);
    else out.push(`<g data-seg="${seg.station}" opacity="0" transform="${k.translateAlong(P, [0, 0, 16])}">${body}</g>`);
  }
  return out.join("");
}

/* ------------------------------------------------------- control cabinet */

function cabinet() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BOX, 0, 2, P)}" style="filter:blur(3px)"/>`];
  out.push(S(k.slabOf(BOX, 0, BOX_H, P, 4, 0.9), { tone: "mid" }));
  out.push(L(k.sideSeam(BOX, BOX_H - 10, P, 4), { tone: "faint" }));
  const face = k.insetPlan(BOX, 4);
  out.push(L(k.planOutline(face, BOX_H, P, 4), { tone: "lo" }));
  const win = { x: BOX.x + 6, y: BOX.y + 7, w: BOX.w - 12, d: 21, r: 1.5 };
  out.push(S(k.slabOf(win, BOX_H - 1.2, 1.2, P, 3), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(win, BOX_H, P, 3), { tone: "lo" }));
  out.push(`<g data-display>${k.faceTextSvg(k.topMatrix([win.x + win.w / 2, win.y + 8], BOX_H + 0.1, P, "x"), "L7", { size: 5.6, tone: "hi", anchor: "middle" })}</g>`);
  out.push(`<g data-display2>${k.faceTextSvg(k.topMatrix([win.x + win.w / 2, win.y + 16], BOX_H + 0.1, P, "x"), "DATA", { size: 3.2, tone: "lo", anchor: "middle" })}</g>`);
  [[BOX.x + 10, BOX.y + BOX.d - 9], [BOX.x + BOX.w - 10, BOX.y + BOX.d - 9]].forEach(([cx, cy], i) => {
    out.push(S(k.cylinder(cx, cy, 3.8, BOX_H, 3, P, 24), { tone: "mid" }));
    out.push(L(k.knurl(cx, cy, 3.8, BOX_H, BOX_H + 3, 20, P), { tone: "lo" }));
    out.push(L(k.lineOnTop([cx, cy], [cx + (i ? 2.8 : -2), cy + (i ? 1.5 : 2.8)], BOX_H + 3, P), { tone: "hi" }));
    out.push(D([at([cx, cy, BOX_H + 3])], { size: 0.45, tone: "hi" }));
  });
  out.push(D(k.corners(face, 1.5).map(([x, y]) => at([x, y, BOX_H])), { size: 0.5 }));
  return out.join("");
}

/* -------------------------------------------------------------- assemble */

const sorted = [
  ...PORTAL_X.map((x) => `<g data-item data-key="${k.depthOf([x, POST_BACK, 0], P).toFixed(2)}">${post(x, POST_BACK)}</g>`),
  `<g data-item data-carriage transform="${k.translateAlong(P, [TRAVEL[0], 0, 0])}">${carriage()}${parcel()}</g>`,
  ...PORTAL_X.map((x) => `<g data-item data-key="${k.depthOf([x, POST_FRONT, 0], P).toFixed(2)}">${post(x, POST_FRONT)}</g>`),
];

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "A collar press on a bench. One bridge beam carried on two end portals holds seven rams in a row. A carriage runs under them on two ways, driven by a leadscrew, carrying a payload block. At each station the ram comes down and clamps that layer's collar onto the parcel, so it leaves the bench wrapped in the headers of every layer below it.",
  body: [
    base(),
    ways(),
    `<g data-sorted>${sorted.join("")}</g>`,
    PORTAL_X.map((x) => portalHead(x)).join(""),
    beam(),
    STATION_X.map((_, i) => station(i)).join(""),
    cabinet(),
  ],
});

const live = `
const P = ${JSON.stringify(P)};
const LAYERS = ${JSON.stringify(LAYERS)};
const STATION_X = ${JSON.stringify(STATION_X)};
const SIZES = ${JSON.stringify(LAYERS.map((_, i) => sizeAfter(i)))};
const RAM_REST = ${RAM_REST}, RAM_DOWN = ${RAM_DOWN};
const TRAVEL = ${JSON.stringify(TRAVEL)};
const FRAME_BITS = ${FRAME_BITS};

const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const group = svg.querySelector("[data-sorted]");
const carriage = svg.querySelector("[data-carriage]");
const rams = STATION_X.map((_, i) => svg.querySelector('[data-ram="' + i + '"]'));
const rods = STATION_X.map((_, i) => svg.querySelector('[data-rod="' + i + '"]'));
const segs = STATION_X.map((_, i) => [...svg.querySelectorAll('[data-seg="' + i + '"]')]);
const display = svg.querySelector("[data-display] text") || svg.querySelector("[data-display]");
const display2 = svg.querySelector("[data-display2] text") || svg.querySelector("[data-display2]");
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const items = [...group.children];
const keyOf = (el, cx) => el.hasAttribute("data-carriage") ? depthOf([cx, -4, 0], P) : Number(el.getAttribute("data-key"));

let x = TRAVEL[0], target = x, frame = 0, last = 0, clock = 0, touring = true, visible = false, idle = 0, order = "";

function draw() {
  carriage.setAttribute("transform", translateAlong(P, [x, 0, 0]));
  let active = 0;
  STATION_X.forEach((sx, i) => {
    const press = clamp(1 - Math.abs(x - sx) / 20, 0, 1);
    const ease = press * press * (3 - 2 * press);
    const tr = translateAlong(P, [0, 0, RAM_REST - (RAM_REST - RAM_DOWN) * ease]);
    rams[i].setAttribute("transform", tr);
    rods[i].setAttribute("transform", tr);
    const on = x >= sx - 3;
    segs[i].forEach((el) => {
      el.setAttribute("opacity", on ? "1" : "0");
      el.setAttribute("transform", translateAlong(P, [0, 0, on ? 0 : 16]));
    });
    if (x >= sx - 20) active = i;
  });

  const layer = LAYERS[active];
  const bytes = SIZES[active];
  if (display.textContent !== "L" + layer.n) display.textContent = "L" + layer.n;
  const pdu = layer.n === 1 ? FRAME_BITS + " BITS" : layer.pdu.toUpperCase();
  if (display2.textContent !== pdu) display2.textContent = pdu;
  const text = "L" + layer.n + " " + layer.name + " · " + layer.pdu
    + (layer.head + layer.tail > 0 ? " · +" + (layer.head + layer.tail) + " B" : " · no header")
    + " · " + bytes + " B";
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuenow", String(layer.n));
  stage.setAttribute("aria-valuetext", text);

  const next = items.map((el, i) => [keyOf(el, x), i]).sort((a, b) => a[0] - b[0]);
  const sig = next.map((pair) => pair[1]).join(",");
  if (sig !== order) { order = sig; for (const [, i] of next) group.appendChild(items[i]); }
}

function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  if (touring) {
    clock += dt;
    const cycle = 16, span = TRAVEL[1] - TRAVEL[0], t = (clock % cycle) / cycle;
    target = t < 0.86 ? TRAVEL[0] + span * (t / 0.86) : TRAVEL[1];
    if ((clock % cycle) > cycle - 0.3) target = TRAVEL[0];
  }
  x = still.matches ? target : x + (target - x) * (1 - Math.exp(-dt / 0.2));
  if (Math.abs(target - x) < 0.02) x = target;
  draw();
  frame = visible && !(!touring && x === target) ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const steer = (next) => {
  touring = false;
  target = clamp(next, TRAVEL[0], TRAVEL[1]);
  clearTimeout(idle);
  idle = setTimeout(() => { touring = !still.matches; clock = 0; run(); }, 3600);
  run();
};
new IntersectionObserver((e) => { visible = e[e.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
if (still.matches) touring = false;
stage.addEventListener("pointermove", (event) => {
  const box = svg.getBoundingClientRect();
  const share = clamp(((event.clientX - box.left) / box.width - 0.14) / 0.72, 0, 1);
  steer(TRAVEL[0] + share * (TRAVEL[1] - TRAVEL[0]));
});
stage.addEventListener("keydown", (event) => {
  const here = STATION_X.reduce((best, sx, i) => (Math.abs(sx - target) < Math.abs(STATION_X[best] - target) ? i : best), 0);
  let to = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") to = Math.min(6, here + 1);
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") to = Math.max(0, here - 1);
  if (event.key === "Home") to = 0;
  if (event.key === "End") to = 6;
  if (to === null) return;
  event.preventDefault();
  steer(STATION_X[to]);
});
draw();
`;

const body = k.plateHtml({
  fig: "Fig 1",
  title: "The encapsulation bench",
  hint: "Hover to run the carriage down the line",
  readout: "L7 Application · Data · no header · 100 B",
  keys: [
    { mark: "lit", label: "The payload: 100 bytes of HTTP request, the only thing anyone wanted to send" },
    { mark: "raised", label: "Collars clamped on by each layer — Ethernet sets one at each end" },
    { mark: "line", label: "Depth stop above each ram: its height is that layer's header in bytes" },
  ],
  caption:
    `Seven rams on one bridge beam. The carriage carries a 100-byte HTTP request from station 7 to station 1, and each ram clamps that layer's header onto the parcel, so it leaves as a ${FRAME_BYTES}-byte Ethernet frame — ${FRAME_BITS} bits on the wire. Stations 7, 5 and 1 stand over an empty magazine and a stop at zero: application data, session state and line coding own no header. Only Ethernet sets a collar at both ends, because only Ethernet has a trailer.`,
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="Encapsulation bench: arrow keys move the carriage from station to station" aria-valuemin="1" aria-valuemax="7" aria-valuenow="7">${svg}</div>`,
});

// --auto emits one page that follows the reader's OS theme, so the figure
// stays in step with the site (autoSwitchAppearance = true in params.toml).
const auto = process.argv.includes("--auto");
const page = k.pageHtml({ title: "The encapsulation bench", theme: auto ? "dark" : theme, body, script: kitScript() + live, width: 920 });
const name = auto ? "osi-encapsulation-auto.html" : theme === "light" ? "osi-encapsulation-light.html" : "osi-encapsulation.html";

const SYNC = `<script>(function(){var b=document.body,m=matchMedia("(prefers-color-scheme: light)");`
  + `function s(){ m.matches ? b.setAttribute("data-theme","light") : b.setAttribute("data-theme","dark"); }`
  + `s(); m.addEventListener("change", s);})();</script>`;

writeFileSync(
  join(HERE, name),
  auto
    ? page.replace('<body class="iso" data-theme="dark">', '<body class="iso">').replace("</body>", SYNC + "</body>")
    : page,
);
console.log("wrote", name);
