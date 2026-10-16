import * as THREE from 'three';

/**
 * Procedural low-poly aircraft. Body frame matches the flight model:
 * nose toward -Z, +Y up, +X right wing, origin at the centre of gravity.
 * Control surfaces, propeller and retractable gear are animated from state.
 */

const STYLES = {
  trainer: {
    profile: [[-4.25, 0], [-4.1, 0.18], [-3.85, 0.45], [-3.5, 0.6], [-2.6, 0.66], [-1.2, 0.7], [0.2, 0.62], [1.6, 0.42], [3.0, 0.24], [3.75, 0.14]],
    bodyScale: [0.95, 1.15],
    wing: { y: 0.98, z: -1.15, span: 11, chord: 1.55, tipChord: 1.35, thick: 0.17, dihedral: 1.5 },
    tail: { z: 3.35, span: 3.6, chord: 0.95, finH: 1.55, finChord: 1.25 },
    struts: true,
    canopy: 'cabin',
    gear: { type: 'fixed', track: 1.25, mainZ: -0.55, noseZ: -3.25, wheelR: 0.3, pants: true },
    props: 2,
  },
  aerobatic: {
    profile: [[-3.75, 0], [-3.6, 0.17], [-3.35, 0.42], [-2.9, 0.52], [-1.8, 0.56], [-0.4, 0.54], [0.8, 0.44], [2.2, 0.27], [3.1, 0.13]],
    bodyScale: [0.88, 1.1],
    wing: { y: -0.32, z: -1.15, span: 7.5, chord: 1.65, tipChord: 1.1, thick: 0.2, dihedral: 0.3 },
    tail: { z: 2.75, span: 2.9, chord: 0.9, finH: 1.25, finChord: 1.15 },
    struts: false,
    canopy: 'bubble',
    gear: { type: 'retract', track: 1.55, mainZ: -0.9, noseZ: -2.9, wheelR: 0.26, pants: false },
    props: 3,
  },
  bush: {
    profile: [[-4.75, 0], [-4.6, 0.22], [-4.3, 0.58], [-3.8, 0.75], [-2.6, 0.85], [-0.9, 0.88], [0.6, 0.78], [2.2, 0.5], [3.7, 0.27], [4.5, 0.15]],
    bodyScale: [1.0, 1.18],
    wing: { y: 1.22, z: -1.25, span: 14.5, chord: 1.95, tipChord: 1.8, thick: 0.2, dihedral: 1.2 },
    tail: { z: 4.0, span: 4.4, chord: 1.15, finH: 1.85, finChord: 1.5 },
    struts: true,
    canopy: 'cabin',
    gear: { type: 'fixed', track: 1.6, mainZ: -0.7, noseZ: -3.8, wheelR: 0.46, pants: false },
    props: 3,
  },
};

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15, ...opts });
}

function fuselage(profile, scale) {
  // Lathe around Y, then lay along Z (nose to -Z).
  const pts = profile.map(([z, r]) => new THREE.Vector2(r, z));
  const geo = new THREE.LatheGeometry(pts, 16);
  geo.rotateX(Math.PI / 2); // lathe Y-axis -> Z-axis; profile z grows to +Z
  geo.scale(scale[0], scale[1], 1);
  geo.computeVertexNormals();
  return geo;
}

/** Tapered wing panel spanning +X from the root, hinge-ready. */
function wingPanel(span, rootChord, tipChord, thick, sweep = 0) {
  const g = new THREE.BoxGeometry(span, thick, rootChord, 6, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + span / 2; // 0..span
    const t = x / span;
    const chord = rootChord + (tipChord - rootChord) * t;
    p.setZ(i, (p.getZ(i) / rootChord) * chord + sweep * t);
    p.setY(i, p.getY(i) * (1 - 0.35 * t));
    p.setX(i, x);
  }
  g.computeVertexNormals();
  return g;
}

function finGeometry(h, chord) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(chord, 0);
  s.lineTo(chord * 0.92, h);
  s.lineTo(chord * 0.45, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: false });
  g.translate(0, 0, -0.05);
  g.rotateY(-Math.PI / 2); // shape x -> world +Z
  return g;
}

export function createAircraftModel(type) {
  const st = STYLES[type.id];
  const root = new THREE.Group();
  root.name = 'aircraft ' + type.id;
  const body = mat(type.color);
  const accent = mat(type.accent, { roughness: 0.4 });
  const dark = mat(0x22252b, { roughness: 0.6, metalness: 0.3 });
  const tire = mat(0x111111, { roughness: 0.9, metalness: 0 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0d1a26,
    roughness: 0.05,
    metalness: 0.6,
    transparent: true,
    opacity: 0.62,
  });
  const chrome = mat(0xc9ced6, { roughness: 0.2, metalness: 0.9 });
  const parts = { ailerons: [], elevator: null, rudder: null, prop: null, propDisc: null, gearPivots: [], wheels: [], navLights: [] };

  const add = (geo, m, parent = root) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // Fuselage + livery stripe.
  add(fuselage(st.profile, st.bodyScale), body).userData.exteriorOnly = true;
  // Partial lathe sector slightly outside the skin forms a side stripe.
  const stripeGeo = new THREE.LatheGeometry(
    st.profile.map(([z, r]) => new THREE.Vector2(r * 1.01, z)),
    16,
    Math.PI * 0.42,
    Math.PI * 0.16,
  );
  stripeGeo.rotateX(Math.PI / 2);
  stripeGeo.scale(st.bodyScale[0], st.bodyScale[1], 1);
  const stripe = add(stripeGeo, accent);
  const stripe2 = stripe.clone();
  stripe2.scale.x = -1;
  root.add(stripe2);
  stripe.userData.exteriorOnly = stripe2.userData.exteriorOnly = true;

  // Wings: two panels with dihedral, ailerons on the outer trailing edge.
  const W = st.wing;
  const half = W.span / 2;
  for (const side of [1, -1]) {
    const wingGroup = new THREE.Group();
    wingGroup.position.set(0, W.y, W.z);
    wingGroup.rotation.z = side * (W.dihedral * Math.PI) / 180;
    wingGroup.scale.x = side;
    root.add(wingGroup);
    const panelSpan = half - 0.15;
    const fixedChord = W.chord * 0.78;
    const panel = add(wingPanel(panelSpan, fixedChord, W.tipChord * 0.78, W.thick), body, wingGroup);
    panel.position.set(0.15, 0, -W.chord * 0.11);
    // Tip in accent colour.
    const tip = add(new THREE.BoxGeometry(0.35, W.thick * 0.7, W.tipChord * 0.8), accent, wingGroup);
    tip.position.set(half - 0.05, 0, -W.chord * 0.11);
    // Inboard flap (static) and outboard aileron (hinged).
    const flap = add(new THREE.BoxGeometry(half * 0.5, W.thick * 0.5, W.chord * 0.22), body, wingGroup);
    flap.position.set(0.15 + half * 0.25, 0, W.chord * 0.39);
    const hinge = new THREE.Group();
    hinge.position.set(0.15 + half * 0.72, 0, W.chord * 0.28);
    wingGroup.add(hinge);
    const ail = add(new THREE.BoxGeometry(half * 0.42, W.thick * 0.5, W.chord * 0.22), accent, hinge);
    ail.position.z = W.chord * 0.11;
    parts.ailerons.push({ pivot: hinge, side });
    parts.flaps = parts.flaps || [];
    parts.flaps.push(flap);
    // Nav light at the tip.
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: side > 0 ? 0x40ff70 : 0xff3030 }),
    );
    light.position.set(half + 0.12, 0, -W.chord * 0.3);
    wingGroup.add(light);
    parts.navLights.push(light);
    if (st.struts) {
      const len = Math.hypot(half * 0.55, W.y + 0.45);
      const strut = add(new THREE.CylinderGeometry(0.045, 0.045, len, 6), dark, root);
      strut.position.set(side * half * 0.28, (W.y - 0.45) / 2, W.z + 0.05);
      strut.rotation.z = side * Math.atan2(half * 0.55, W.y + 0.45);
      strut.userData.exteriorOnly = true;
    }
  }

  // Tail: stabiliser + hinged elevator, fin + hinged rudder.
  const Tl = st.tail;
  const stab = add(new THREE.BoxGeometry(Tl.span, 0.09, Tl.chord * 0.62), body);
  stab.position.set(0, 0.12, Tl.z);
  const elevHinge = new THREE.Group();
  elevHinge.position.set(0, 0.12, Tl.z + Tl.chord * 0.31);
  root.add(elevHinge);
  const elev = add(new THREE.BoxGeometry(Tl.span * 0.94, 0.07, Tl.chord * 0.4), accent, elevHinge);
  elev.position.z = Tl.chord * 0.2;
  parts.elevator = elevHinge;
  const fin = add(finGeometry(Tl.finH, Tl.finChord * 0.65), body);
  fin.position.set(0, 0.15, Tl.z - Tl.finChord * 0.4);
  const rudHinge = new THREE.Group();
  rudHinge.position.set(0, 0.15, Tl.z - Tl.finChord * 0.4 + Tl.finChord * 0.62);
  root.add(rudHinge);
  const rud = add(new THREE.BoxGeometry(0.08, Tl.finH * 0.92, Tl.finChord * 0.38), accent, rudHinge);
  rud.position.set(0, Tl.finH * 0.47, Tl.finChord * 0.19);
  parts.rudder = rudHinge;
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  beacon.position.set(0, 0.15 + Tl.finH, Tl.z + Tl.finChord * 0.15);
  root.add(beacon);
  parts.strobe = beacon;

  // Canopy / cabin glazing.
  const nose = st.profile[0][0];
  if (st.canopy === 'bubble') {
    const can = add(new THREE.SphereGeometry(0.62, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass);
    can.scale.set(0.85, 0.85, 2.0);
    can.position.set(0, 0.42, -0.9);
    can.castShadow = false;
    can.userData.exteriorOnly = true;
  } else {
    const r = st.profile[5][1] * st.bodyScale[0];
    const wind = add(new THREE.BoxGeometry(r * 1.6, 0.55, 0.9), glass);
    wind.position.set(0, st.wing.y - 0.42, st.wing.z - st.wing.chord * 0.55);
    wind.rotation.x = -0.75;
    wind.castShadow = false;
    wind.userData.exteriorOnly = true;
    for (const side of [1, -1]) {
      const win = add(new THREE.BoxGeometry(0.04, 0.5, 1.6), glass);
      win.position.set(side * r * 0.97, st.wing.y - 0.55, st.wing.z + 0.15);
      win.castShadow = false;
      win.userData.exteriorOnly = true;
    }
  }

  // Propeller: spinner, blades and a blur disc shown at high RPM.
  const prop = new THREE.Group();
  prop.position.set(0, 0, nose - 0.05);
  root.add(prop);
  const spinner = add(new THREE.ConeGeometry(0.2, 0.5, 14), chrome, prop);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -0.05;
  const blades = new THREE.Group();
  prop.add(blades);
  const bladeLen = type.id === 'bush' ? 1.25 : 0.95;
  for (let i = 0; i < st.props; i++) {
    const b = add(new THREE.BoxGeometry(0.13, bladeLen, 0.035), dark, blades);
    b.geometry.translate(0, bladeLen / 2, 0);
    b.rotation.z = (i / st.props) * Math.PI * 2;
    b.rotation.y = 0.25;
  }
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(bladeLen, 32),
    new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
  );
  disc.position.z = 0.02;
  prop.add(disc);
  parts.prop = blades;
  parts.propDisc = disc;

  // Landing gear.
  const G = st.gear;
  const gearH = type.gearHeight;
  const wheel = (r, w) => new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2);
  const legs = [
    { x: G.track, z: G.mainZ },
    { x: -G.track, z: G.mainZ },
    { x: 0, z: G.noseZ },
  ];
  for (const leg of legs) {
    const pivot = new THREE.Group();
    const topY = -0.35;
    pivot.position.set(leg.x * (G.type === 'retract' ? 0.9 : 1), topY, leg.z);
    root.add(pivot);
    const len = gearH + topY - G.wheelR;
    const strut = add(new THREE.CylinderGeometry(0.05, 0.05, Math.abs(len) + 0.2, 6), chrome, pivot);
    strut.position.y = -(Math.abs(len) + 0.2) / 2 + 0.1;
    const w = add(wheel(G.wheelR, type.id === 'bush' ? 0.32 : 0.16), tire, pivot);
    w.position.y = -(gearH + topY - G.wheelR) - 0;
    w.position.y = -(gearH - Math.abs(topY)) + G.wheelR;
    parts.wheels.push(w);
    if (G.pants) {
      const pant = add(new THREE.SphereGeometry(G.wheelR * 1.25, 12, 8), body, pivot);
      pant.scale.set(0.55, 0.85, 1.8);
      pant.position.copy(w.position);
      pant.position.y += 0.05;
    }
    parts.gearPivots.push({ pivot, side: Math.sign(leg.x), nose: leg.x === 0 });
  }

  root.userData.parts = parts;
  root.userData.exterior = [];
  root.traverse((o) => o.userData.exteriorOnly && root.userData.exterior.push(o));
  root.userData.type = type;
  return root;
}

/**
 * Animate a model from flight state and (smoothed) control inputs.
 * @param {THREE.Group} model
 */
export function animateAircraft(model, state, controls, dt, time) {
  const p = model.userData.parts;
  const T = model.userData.type;
  const maxDefl = 0.4;
  for (const a of p.ailerons) a.pivot.rotation.x = -controls.roll * maxDefl * a.side * 0.8;
  if (p.elevator) p.elevator.rotation.x = controls.pitch * maxDefl;
  if (p.rudder) p.rudder.rotation.y = -controls.yaw * maxDefl;
  if (p.flaps) for (const f of p.flaps) f.rotation.x = state.flaps * 0.5;

  // Propeller: real rotation at low RPM, blur disc at high RPM.
  const rpm = state.crashed ? 0 : 400 + state.throttle * 2200 + state.airspeed * 8;
  const omega = (rpm / 60) * Math.PI * 2;
  p.prop.rotation.z += Math.min(omega * dt, 1.1); // cap to avoid stroboscopic freeze
  const blur = THREE.MathUtils.clamp((rpm - 900) / 1200, 0, 1);
  p.propDisc.material.opacity = 0.05 + blur * 0.2;
  // Above ~1300 rpm the eye only sees the disc, not individual blades.
  p.prop.visible = blur < 0.35;

  // Gear retraction: legs fold inward into the wing / nose.
  if (T.retractableGear) {
    const ext = state.gearPos;
    for (const g of p.gearPivots) {
      if (g.nose) g.pivot.rotation.x = (1 - ext) * (Math.PI / 2);
      else g.pivot.rotation.z = g.side * (1 - ext) * (Math.PI / 2);
      g.pivot.visible = ext > 0.02;
    }
  }
  // Wheels spin with ground speed.
  if (state.onGround) for (const w of p.wheels) w.rotation.x -= (state.groundSpeed * dt) / 0.3;

  // Strobe + nav lights blink.
  if (p.strobe) p.strobe.visible = time % 1.2 < 0.08;
}
