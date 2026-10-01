'use client';
// src/components/track/DeliveryScene.tsx
// The /track footer: a delivery truck drives from the press (left) to the
// client's warehouse (right end) and parks in front of it with the back of
// its cargo box lined up against the receiving gate. The bay light comes on
// and the label rolls go out of the back, through the gate, onto a pallet
// inside; then the truck drives off the right edge. On the landing page it
// loops as the portal's signature; on a job page its position is the job's
// real pipeline progress (see DeliverySceneContext).
//
// Everything is sized off the truck: --truck-w sets the truck's width per
// breakpoint, and the press and warehouse are fixed multiples of it. The
// warehouse SVG is drawn in the truck's own units (1 unit = 1 truck viewBox
// unit), so the gate always sits at the parked truck's back and its opening
// stays just taller than the cargo box at every size.

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
import { useDeliveryScene } from './DeliverySceneContext';
import { useBranding } from '@/components/brand/BrandingProvider';

registerGsap();

const ROAD_H = 20;
/** The truck's wheels sit 2px into the road; the warehouse shares its baseline. */
const TRUCK_BOTTOM = ROAD_H - 2;
const LABEL_COUNT = 3;

// Truck SVG (viewBox 0 0 160 68), facing right: its back is the left end.
const TRUCK_VB_W = 160;
const TRUCK_VB_H = 68;
const PORT_X = 3;
const PORT_Y = 40;
const CARGO_CX = 51;
const CARGO_CY = 28;

// Press SVG (viewBox 0 -34 140 124; the building's own box is 0 0 140 90).
const PRESS_VB_W = 140;
const PRESS_VB_H = 90;
const CHARGER_CX = 128;
const CHARGER_TOP = 72;
const DOOR_CX = 88;

// Warehouse SVG (viewBox 0 0 300 150), in truck units: its bottom (150)
// lines up with the truck's (68), so warehouse y = truck y + 82 — the cargo
// box spans y 88–132.
const WH_VB_W = 300;
const WH_VB_H = 150;
const GATE_L = 50;       // receiving gate opening, left edge
const GATE_R = 118;      // …right edge: the parked truck's back sits here
const GATE_TOP = 82;     // underside of the rolled-up shutter, just above the cargo roof (88)
const ROLL_U = 12;       // label roll size
// Rolls stacked on the pallet just inside the gate: left edge and bottom, in units.
const PALLET_ROLLS = [{ x: 58, y: 141 }, { x: 71, y: 141 }, { x: 64.5, y: 129 }];
const LAMP_DIM = 0.18;

const WALL = '#143A2E';
const WALL_DARK = '#0F2D23';
const EDGE = 'rgba(255,255,255,.28)';
const MONO = { fontFamily: 'var(--font-mono), ui-monospace, monospace' };

type Layout = {
  width: number; truckW: number;
  dockLeft: number; dockW: number;
  pressLeft: number; pressW: number;
};

export function DeliveryScene() {
  const branding = useBranding();
  const scene = useDeliveryScene();
  const state = scene?.state ?? null;

  const root = useRef<HTMLDivElement>(null);
  const truck = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const press = useRef<HTMLDivElement>(null);
  const readoutEl = useRef<HTMLParagraphElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);

  useLayoutEffect(() => {
    const el = root.current;
    const dockEl = dock.current;
    const truckEl = truck.current;
    const pressEl = press.current;
    if (!el || !dockEl || !truckEl || !pressEl) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const d = dockEl.getBoundingClientRect();
      const pr = pressEl.getBoundingClientRect();
      setLayout({
        width: r.width,
        truckW: truckEl.offsetWidth,
        dockLeft: d.left - r.left,
        dockW: d.width,
        pressLeft: pr.left - r.left,
        pressW: pr.width,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ts = layout ? layout.truckW / TRUCK_VB_W : 1;  // truck px per unit
  const ws = layout ? layout.dockW / WH_VB_W : 1;      // warehouse px per unit (≈ ts)
  const whLeft = layout?.dockLeft ?? 0;
  const whX = (u: number) => whLeft + u * ws;
  const whBottom = (u: number) => TRUCK_BOTTOM + (WH_VB_H - u) * ws;
  const rollPx = ROLL_U * ws;

  // Press geometry (where the truck charges and loads).
  const pressScale = layout ? layout.pressW / PRESS_VB_W : 1;
  const chargerX = layout ? layout.pressLeft + CHARGER_CX * pressScale : 0;
  const chargerTop = layout ? ROAD_H + (PRESS_VB_H - CHARGER_TOP) * pressScale : ROAD_H;
  const doorX = layout ? layout.pressLeft + DOOR_CX * pressScale - rollPx / 2 : 0;
  const loadX = chargerX + 12;
  const portX = loadX + PORT_X * ts;
  const portY = TRUCK_BOTTOM + (TRUCK_VB_H - PORT_Y) * ts;
  const cargoX = loadX + CARGO_CX * ts - rollPx / 2;
  const cargoY = TRUCK_BOTTOM + (TRUCK_VB_H - CARGO_CY) * ts - rollPx / 2;
  const cableW = Math.max(1, portX - chargerX);
  const cableH = Math.max(chargerTop, portY) - ROAD_H + 2;

  // Parked at the warehouse: the truck's back (its x 0) against the gate's
  // right edge, the body standing in front of the wall beside it.
  const parkX = Math.max(loadX + 8, whX(GATE_R));
  const rollLeft = (i: number) => whX(PALLET_ROLLS[i].x);
  const rollBottom = (i: number) => whBottom(PALLET_ROLLS[i].y);
  // Rolls come out of the cargo box's back door, at mid height.
  const unloadLeft = parkX + 3 * ts - rollPx / 2;
  const unloadBottom = whBottom(116);

  const percent = state ? Math.max(0, Math.min(100, state.percent)) : null;
  const delivered = Boolean(state?.delivered);
  const paused = Boolean(state?.paused);
  const idleReadout = `${branding.shortName} → your dock`;

  useGSAP(
    () => {
      const truckEl = truck.current;
      const rootEl = root.current;
      if (!truckEl || !rootEl || !layout) return;

      const q = <T extends Element>(sel: string, el: Element = rootEl) => el.querySelectorAll<T>(sel);
      const wheels = q<SVGGElement>('.wheel', truckEl);
      const body = truckEl.querySelector<HTMLElement>('.truck-body');
      const hazards = q<SVGElement>('.hazard', truckEl);
      const bars = q<SVGElement>('.ev-bar', truckEl);
      const bolt = truckEl.querySelector<SVGElement>('.ev-bolt');
      const labels = q<HTMLElement>('.delivered-label');
      const loading = q<HTMLElement>('.loading-label');
      const cable = rootEl.querySelector<HTMLElement>('.charge-cable');
      const lamp = q<SVGElement>('.dock-lamp, .bay-glow');
      const flow = rootEl.querySelector<SVGPathElement>('.charge-flow');
      const say = (text: string) => () => { if (readoutEl.current) readoutEl.current.textContent = text; };

      const startX = -layout.truckW - 24;
      const exitX = layout.width + 40;
      // Job page: the road from the press charger to the gate is the progress bar.
      const jobX = (pct: number) => loadX + (parkX - loadX) * (pct / 100);
      const litBars = (pct: number) => Math.min(LABEL_COUNT, Math.floor((pct / 100) * LABEL_COUNT + 0.001));

      const labelFrom = (i: number) => ({
        x: unloadLeft - rollLeft(i),
        y: -(unloadBottom - rollBottom(i)),
        scale: 0.7,
        opacity: 0,
      });

      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set(hazards, { opacity: paused ? 1 : 0 });
        gsap.set(loading, { opacity: 0 });
        if (percent === null || delivered) {
          // Parked at the gate, unloaded, light on.
          gsap.set(truckEl, { x: parkX });
          gsap.set(cable, { opacity: 0 });
          gsap.set(bars, { opacity: 1 });
          gsap.set(lamp, { opacity: 1 });
          gsap.set(labels, { x: 0, y: 0, scale: 1, opacity: 1 });
        } else {
          gsap.set(truckEl, { x: jobX(percent) });
          gsap.set(lamp, { opacity: LAMP_DIM });
          gsap.set(cable, { opacity: percent === 0 ? 1 : 0 });
          bars.forEach((b, i) => gsap.set(b, { opacity: i < litBars(percent) ? 1 : 0.2 }));
          gsap.set(labels, { opacity: 0 });
        }
      });

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        // The ambient loop on /track cruises; the job page arrives briskly. Wheel spin matches road speed.
        const ambient = percent === null;
        const spin = gsap.to(wheels, {
          rotation: 360, duration: ambient ? 1.5 : 0.55, ease: 'none', repeat: -1, transformOrigin: '50% 50%', paused: true,
        });
        const bob = body
          ? gsap.to(body, { y: -1.2, duration: 0.16, ease: 'sine.inOut', yoyo: true, repeat: -1, paused: true })
          : null;
        const rays = q<SVGElement>('.sun-ray');
        const sunlight = rays.length
          ? gsap.to(rays, { strokeDashoffset: -28, duration: 2.8, ease: 'none', repeat: -1 })
          : null;
        const solar = q<SVGElement>('.solar-glow');
        const solarPulse = solar.length
          ? gsap.to(solar, { opacity: 0.85, duration: 2.6, ease: 'sine.inOut', yoyo: true, repeat: -1 })
          : null;
        const current = flow
          ? gsap.to(flow, { strokeDashoffset: -24, duration: 0.8, ease: 'none', repeat: -1, paused: true })
          : null;
        const drive = () => { spin.play(); bob?.play(); };
        const park = () => { spin.pause(); bob?.pause(); if (body) gsap.to(body, { y: 0, duration: 0.2 }); };

        const tl = gsap.timeline({ repeat: ambient ? -1 : 0, repeatDelay: 1.8 });
        tl.set(truckEl, { x: startX });
        tl.set(hazards, { opacity: 0 });
        tl.set([loading, cable], { opacity: 0 });
        tl.set(lamp, { opacity: LAMP_DIM });
        tl.set(bars, { opacity: ambient ? 0.2 : 1 });
        labels.forEach((l, i) => tl.set(l, labelFrom(i)));

        // Bay light on, then the rolls go out of the back door, through the
        // gate, onto the pallet inside — one at a time.
        const unload = () => {
          tl.to(lamp, { opacity: 1, duration: 0.4, ease: 'power1.out' }, '>0.4');
          labels.forEach((l, i) => {
            tl.to(l, { opacity: 1, scale: 1, duration: 0.3, ease: 'power1.out' }, i === 0 ? '>0.3' : '>0.25')
              .to(l, { x: 0, y: 0, duration: 1.1, ease: 'power1.inOut' }, '>');
          });
        };

        if (ambient) {
          // 1. Pull up beside the press, rear to the charger.
          tl.call(say(idleReadout))
            .call(drive)
            .to(truckEl, { x: loadX, duration: 4.5, ease: 'power1.out' })
            .call(park);

          // 2. Plug in: cable on, current flowing, battery filling bar by bar…
          tl.call(say('Charging · loading at the press'), undefined, '+=0.3')
            .to(cable, { opacity: 1, duration: 0.4 })
            .call(() => current?.play());
          tl.to(bars, { opacity: 1, duration: 0.6, stagger: 2.3, ease: 'power1.out' }, '>0.2');
          if (bolt) tl.to(bolt, { opacity: 0.35, duration: 0.4, yoyo: true, repeat: 15, ease: 'sine.inOut' }, '<');

          // …while rolls come out of the door and go into the cargo box.
          loading.forEach((l, i) => {
            const at = i === 0 ? '<0.3' : '<0.9';
            tl.fromTo(
              l,
              { x: 0, y: 0, scale: 0.7, opacity: 0 },
              { opacity: 1, scale: 1, duration: 0.3, ease: 'power1.out' },
              at
            )
              .to(l, { x: cargoX - doorX, y: -(cargoY - (ROAD_H + 2)), duration: 1.1, ease: 'power1.inOut' }, '>')
              .to(l, { scale: 0.35, opacity: 0, duration: 0.3, ease: 'power1.in' }, '>-0.05');
          });

          // 3. Unplug and drive to the client's gate.
          tl.call(() => current?.pause(), undefined, '>0.5')
            .to(cable, { opacity: 0, duration: 0.35 })
            .call(say('En route · your dock'))
            .call(drive, undefined, '+=0.4')
            .to(truckEl, { x: parkX, duration: 9, ease: 'power1.inOut' })
            .call(park);

          // 4. Unload through the gate.
          tl.call(say('Unloading at your gate'), undefined, '+=0.3');
          unload();
          tl.call(say('Delivered'), undefined, '>0.3');

          // 5. Drive off the right edge; the bay goes dark behind it.
          tl.call(drive, undefined, '+=2.2')
            .to(truckEl, { x: exitX, duration: 5.5, ease: 'power1.in' })
            .call(park)
            .to(labels, { opacity: 0, y: -6, duration: 0.5, stagger: 0.08 }, '-=0.3')
            .to(lamp, { opacity: LAMP_DIM, duration: 0.5 }, '<');
        } else {
          // Job page: drive in to where the job actually is. Fresh POs sit plugged in at
          // the press; each completed stage moves the truck further down the road and
          // lights the battery; Dispatched parks it at the gate and unloads.
          const targetX = delivered ? parkX : jobX(percent);
          const lit = delivered ? LABEL_COUNT : litBars(percent);
          tl.set(bars, { opacity: 0.2 });
          tl.call(drive)
            .to(truckEl, { x: targetX, duration: 2 + 2.5 * ((targetX - startX) / (parkX - startX)), ease: 'power2.out' })
            .call(park);
          bars.forEach((b, i) => {
            if (i < lit) tl.to(b, { opacity: 1, duration: 0.35, ease: 'power1.out' }, i === 0 ? '>0.1' : '>-0.1');
          });
          if (!delivered && percent === 0) {
            tl.to(cable, { opacity: 1, duration: 0.4 }, '<').call(() => current?.play());
          }
          if (delivered) unload();
          if (paused) {
            tl.to(hazards, { opacity: 1, duration: 0.5, ease: 'steps(1)', yoyo: true, repeat: -1 }, '>');
          }
        }

        return () => {
          spin.kill(); bob?.kill(); sunlight?.kill(); solarPulse?.kill(); current?.kill(); tl.kill();
          say(idleReadout)();
        };
      });

      return () => mm.revert();
    },
    { dependencies: [layout, percent, delivered, paused], scope: root }
  );

  const readout = state
    ? delivered
      ? 'Delivered'
      : paused
        ? `On hold · ${percent}%`
        : `${state.label} · ${percent}%`
    : idleReadout;

  return (
    <div className="w-full">
      <p
        ref={readoutEl}
        aria-live="polite"
        className="text-center font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--glass-muted)] mb-1"
      >
        {readout}
      </p>

      {/* --truck-w drives every size in the scene. The press is a little
          narrower relative to the truck on small screens, so the truck can
          charge at the press without standing in front of the warehouse. */}
      <div
        ref={root}
        aria-hidden
        className="relative h-40 sm:h-56 lg:h-72 overflow-hidden select-none [--truck-w:88px] sm:[--truck-w:150px] lg:[--truck-w:180px]"
      >
        {/* Press (origin) */}
        <div
          ref={press}
          className="absolute left-2 sm:left-3 bottom-5 w-[calc(var(--truck-w)*1.3)] sm:w-[calc(var(--truck-w)*1.45)] lg:w-[calc(var(--truck-w)*1.6)] text-[var(--glass-ink)]"
        >
          <PressSilhouette />
        </div>

        {/* Client warehouse (destination), gate at its left, wall for the truck to stand against */}
        <div
          ref={dock}
          className="absolute right-2 sm:right-3 w-[calc(var(--truck-w)*1.875)]"
          style={{ bottom: TRUCK_BOTTOM }}
        >
          <Warehouse />
        </div>

        {/* Road */}
        <div className="absolute inset-x-0 bottom-0 border-t border-white/25 bg-black/25" style={{ height: ROAD_H }}>
          <div
            className="absolute inset-x-0 top-1/2 h-px"
            style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,.28) 0 18px, transparent 18px 34px)' }}
          />
        </div>

        {/* Charging cable: charger head → truck's rear port (only while parked at the press) */}
        <div
          className="charge-cable absolute text-[var(--glass-ink)]"
          style={{ left: chargerX, bottom: ROAD_H - 2, width: cableW, height: cableH, opacity: 0 }}
        >
          <svg viewBox={`0 0 ${cableW} ${cableH}`} className="block w-full h-full overflow-visible" preserveAspectRatio="none">
            <path
              d={`M0 ${cableH - (chargerTop - ROAD_H) - 2} Q ${cableW / 2} ${cableH + 2} ${cableW} ${cableH - (portY - ROAD_H) - 2}`}
              fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".7"
            />
            <path
              className="charge-flow"
              d={`M0 ${cableH - (chargerTop - ROAD_H) - 2} Q ${cableW / 2} ${cableH + 2} ${cableW} ${cableH - (portY - ROAD_H) - 2}`}
              fill="none" stroke="#7CF0BE" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="4 8"
            />
          </svg>
        </div>

        {/* Label rolls being loaded out of the press door */}
        {Array.from({ length: LABEL_COUNT }).map((_, i) => (
          <div
            key={`load-${i}`}
            className="loading-label absolute text-[var(--glass-ink)]"
            style={{ left: doorX, bottom: ROAD_H + 2, width: rollPx, height: rollPx, opacity: 0 }}
          >
            <LabelRoll />
          </div>
        ))}

        {/* Label rolls unloaded onto the pallet inside the gate */}
        {PALLET_ROLLS.map((_, i) => (
          <div
            key={i}
            className="delivered-label absolute text-[var(--glass-ink)]"
            style={{ left: rollLeft(i), bottom: rollBottom(i), width: rollPx, height: rollPx, opacity: 0 }}
          >
            <LabelRoll />
          </div>
        ))}

        {/* Truck */}
        <div
          ref={truck}
          className="absolute left-0 w-[var(--truck-w)] will-change-transform"
          style={{ bottom: TRUCK_BOTTOM, transform: 'translateX(-400px)' }}
        >
          <div className="truck-body">
            <TruckGlyph />
          </div>
          <div className="absolute inset-x-3 -bottom-1 h-2 rounded-full bg-black/40 blur-sm" />
        </div>
      </div>
    </div>
  );
}

function TruckGlyph() {
  const branding = useBranding();
  const windowClip = useId();
  return (
    <svg viewBox="0 0 160 68" className="block w-full h-auto overflow-visible">
      <defs>
        <clipPath id={windowClip}>
          <path d="M104 22 H122 Q128 22 132 29 L137 38 H104 Z" />
        </clipPath>
      </defs>
      {/* cargo box */}
      <rect x="2" y="6" width="98" height="44" rx="4" fill="rgba(255,255,255,.10)" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2" y="30" width="98" height="6" fill="#10553F" opacity=".95" />
      {/* EV livery: charged battery + a line that points back at the solar roof */}
      <g stroke="#7CF0BE" strokeWidth="1" strokeLinejoin="round">
        <rect x="8" y="13.5" width="17" height="9" rx="1.8" fill="rgba(124,240,190,.12)" />
        <rect x="25" y="16.2" width="1.8" height="3.6" rx=".5" fill="#7CF0BE" stroke="none" />
        <g fill="#7CF0BE" stroke="none">
          <rect className="ev-bar" x="9.8" y="15.3" width="3" height="5.4" rx=".5" />
          <rect className="ev-bar" x="13.6" y="15.3" width="3" height="5.4" rx=".5" />
          <rect className="ev-bar" x="17.4" y="15.3" width="3" height="5.4" rx=".5" />
          <path className="ev-bolt" d="M22.6 14.9 L20.6 18.3 H22.1 L21.6 21 L23.8 17.6 H22.3 Z" />
        </g>
      </g>
      <text x="30" y="19.2" fontSize="5.2" fontWeight="600" letterSpacing=".8" fill="#7CF0BE" style={MONO}>
        100% ELECTRIC
      </text>
      <text x="30" y="26" fontSize="3.4" letterSpacing=".3" fill="currentColor" opacity=".75" style={MONO}>
        CHARGED ON OUR SOLAR ROOF
      </text>
      <text x="51" y="45" textAnchor="middle" fontSize="6.5" letterSpacing="1.4" fill="currentColor" opacity=".8" style={MONO}>
        {branding.shortName}
      </text>
      {/* cab */}
      <path d="M100 18 H124 Q132 18 137 27 L146 42 V50 H100 Z" fill="rgba(255,255,255,.14)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M104 22 H122 Q128 22 132 29 L137 38 H104 Z" fill="rgba(234,255,245,.18)" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      {/* driver, seated behind the windscreen */}
      <g className="driver" clipPath={`url(#${windowClip})`} fill="rgba(255,255,255,.16)" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round">
        <path d="M109 40 Q109 32.5 116.5 32.5 Q124 32.5 124 40 Z" />
        <circle cx="116.5" cy="27.5" r="3.4" />
        <path d="M119 33.5 Q124 32 128 34" fill="none" strokeLinecap="round" />
        <path d="M127 37 L130.5 30.5" fill="none" strokeLinecap="round" opacity=".8" />
      </g>
      {/* EV badge on the cab door */}
      <rect x="106" y="41" width="11" height="6.5" rx="3.25" fill="rgba(124,240,190,.16)" stroke="#7CF0BE" strokeWidth=".8" opacity=".95" />
      <path d="M112.2 41.8 L109.6 44.8 H111.4 L110.8 47.2 L113.4 44.1 H111.6 Z" fill="#7CF0BE" />
      {/* rear charge port */}
      <rect x="0.5" y="37.5" width="4" height="5" rx="1" fill="#0A1F18" stroke="#7CF0BE" strokeWidth=".8" />
      <circle cx="2.5" cy="40" r=".9" fill="#7CF0BE" />
      {/* chassis + bumper */}
      <rect x="0" y="50" width="150" height="4" rx="1" fill="currentColor" opacity=".9" />
      <rect x="146" y="43" width="6" height="9" rx="1.5" fill="currentColor" opacity=".9" />
      <circle cx="147.5" cy="46.5" r="1.8" fill="#7CF0BE" />
      {/* hazard lamps (On Hold only) */}
      <rect className="hazard" x="3" y="53" width="5" height="3" rx="0.5" fill="#F59E0B" opacity="0" />
      <rect className="hazard" x="140" y="53" width="5" height="3" rx="0.5" fill="#F59E0B" opacity="0" />
      {/* wheels */}
      <Wheel cx={28} />
      <Wheel cx={122} />
    </svg>
  );
}

function Wheel({ cx }: { cx: number }) {
  const cy = 58;
  return (
    <g className="wheel">
      <circle cx={cx} cy={cy} r="9" fill="#0A1F18" stroke="currentColor" strokeWidth="2" />
      <path d={`M${cx} ${cy - 9} V${cy + 9} M${cx - 9} ${cy} H${cx + 9}`} stroke="currentColor" strokeWidth="1.2" opacity=".55" />
      <circle cx={cx} cy={cy} r="3" fill="currentColor" />
    </g>
  );
}

const ROOF_SLOPES = [4, 28, 52, 76];
const SUN_X = 52;
const SUN_Y = -16;

function PressSilhouette() {
  const branding = useBranding();
  const glow = useId();
  return (
    <svg viewBox="0 -34 140 124" className="block w-full h-auto overflow-visible">
      <defs>
        <filter id={glow} x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="1.8" />
        </filter>
      </defs>
      {/* sun overhead */}
      <g stroke="#7CF0BE" strokeWidth="1" strokeLinecap="round" opacity=".9">
        <circle cx={SUN_X} cy={SUN_Y} r="5.5" fill="rgba(124,240,190,.35)" filter={`url(#${glow})`} />
        <circle cx={SUN_X} cy={SUN_Y} r="5.5" fill="rgba(124,240,190,.35)" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <path key={a} d={`M${SUN_X} ${SUN_Y - 8} V${SUN_Y - 11}`} transform={`rotate(${a} ${SUN_X} ${SUN_Y})`} />
        ))}
      </g>
      {/* sunlight streaming onto the panels */}
      <g fill="none" stroke="#7CF0BE" strokeWidth="1" strokeLinecap="round" strokeDasharray="3 11" opacity=".55">
        {ROOF_SLOPES.map((x) => (
          <path key={x} className="sun-ray" d={`M${SUN_X} ${SUN_Y + 7} L${x + 12} 31`} />
        ))}
      </g>
      <g fill="rgba(255,255,255,.07)" stroke={EDGE} strokeWidth="1" strokeLinejoin="round">
        <path d="M4 89 V40 L28 26 V40 L52 26 V40 L76 26 V40 L100 26 V89 Z" />
        <rect x="78" y="62" width="20" height="27" rx="1" />
        <path d="M78 75 H98" opacity=".6" />
      </g>
      {/* solar array on each sawtooth slope: soft glow underneath, panels on top */}
      <g className="solar-glow" fill="#7CF0BE" opacity=".4" filter={`url(#${glow})`}>
        {ROOF_SLOPES.map((x) => (
          <path key={x} d={`M${x + 2} 36 L${x + 22} 24.5 L${x + 22} 29 L${x + 2} 40.5 Z`} />
        ))}
      </g>
      <g fill="rgba(124,240,190,.42)" stroke="#7CF0BE" strokeWidth=".9" strokeLinejoin="round">
        {ROOF_SLOPES.map((x) => (
          <g key={x}>
            <path d={`M${x + 2} 36 L${x + 22} 24.5 L${x + 22} 29 L${x + 2} 40.5 Z`} />
            <path d={`M${x + 7} 33.1 L${x + 7} 37.6 M${x + 12} 30.25 L${x + 12} 34.75 M${x + 17} 27.4 L${x + 17} 31.9`} opacity=".8" />
          </g>
        ))}
      </g>
      {/* EV charger by the loading door */}
      <g fill="rgba(255,255,255,.07)" stroke={EDGE} strokeWidth="1" strokeLinejoin="round">
        <rect x="124" y="72" width="8" height="17" rx="1" />
        <rect x="126" y="75" width="4" height="3" fill="rgba(124,240,190,.45)" stroke="none" />
        <path d="M132 76 Q138 76 138 82 V89" fill="none" />
      </g>
      <path d="M128.3 79.5 L126.6 82.6 H128.1 L127.6 85 L129.6 81.8 H128.1 Z" fill="#7CF0BE" />
      <g fill="rgba(234,255,245,.30)">
        <rect x="46" y="48" width="8" height="6" />
        <rect x="60" y="48" width="8" height="6" />
        <rect x="74" y="48" width="8" height="6" />
        <rect x="88" y="48" width="6" height="6" />
      </g>
      <text x="41" y="72" textAnchor="middle" fontSize="5.6" fontWeight="600" letterSpacing="1" fill="rgba(234,255,245,.7)" style={MONO}>
        {branding.shortName}
      </text>
      <text x="42" y="81" textAnchor="middle" fontSize="4.6" letterSpacing=".8" fill="#7CF0BE" opacity=".9" style={MONO}>
        SOLAR · EV FLEET
      </text>
    </svg>
  );
}

/** The client's warehouse. The receiving gate is at its left end; the
 *  parked truck stands in front of the wall to the gate's right, so the
 *  stretch of wall behind the truck is left plain. */
function Warehouse() {
  return (
    <svg viewBox={`0 0 ${WH_VB_W} ${WH_VB_H}`} className="block w-full h-auto overflow-visible">
      {/* rooftop plant */}
      <g fill={WALL_DARK} stroke={EDGE} strokeWidth="1" strokeLinejoin="round">
        <rect x="226" y="18" width="30" height="12" rx="1" />
        <rect x="262" y="22" width="16" height="8" rx="1" />
      </g>
      <path d="M232 22 H250 M232 26 H250" stroke={EDGE} strokeWidth=".7" />
      {/* parapet + walls */}
      <rect x="36" y="30" width="268" height="6" fill={WALL_DARK} stroke={EDGE} strokeWidth="1" />
      <rect x="40" y="36" width="260" height="114" fill={WALL} stroke={EDGE} strokeWidth="1" />
      {/* cladding seams */}
      <g stroke="rgba(255,255,255,.06)" strokeWidth=".8">
        {Array.from({ length: 14 }).map((_, i) => (
          <path key={i} d={`M${136 + i * 12} 36 V150`} />
        ))}
      </g>
      {/* clerestory windows, above where the truck stands */}
      <g fill="rgba(234,255,245,.24)">
        {[136, 160, 184, 208, 232, 256, 280].map((x) => <rect key={x} x={x} y="46" width="14" height="7" rx=".5" />)}
      </g>
      {/* receiving sign over the gate */}
      <rect x="52" y="56" width="64" height="15" rx="2" fill={WALL_DARK} stroke={EDGE} strokeWidth="1" />
      <text x="84" y="66.4" textAnchor="middle" fontSize="7" letterSpacing="1.6" fill="rgba(234,255,245,.75)" style={MONO}>
        RECEIVING
      </text>
      {/* the gate: dark interior, shutter rolled up just above the cargo roof */}
      <rect x={GATE_L} y={GATE_TOP} width={GATE_R - GATE_L} height={WH_VB_H - GATE_TOP} fill="#06140F" stroke={EDGE} strokeWidth="1" />
      <path d={`M${GATE_L} 134 H${GATE_R} M${GATE_L + 12} ${GATE_TOP} V134 M${GATE_R - 12} ${GATE_TOP} V134`} stroke="rgba(255,255,255,.07)" strokeWidth=".8" />
      <rect x={GATE_L - 1} y={GATE_TOP - 6} width={GATE_R - GATE_L + 2} height="6" fill={WALL_DARK} stroke={EDGE} strokeWidth="1" />
      <path d={`M${GATE_L} ${GATE_TOP - 3} H${GATE_R}`} stroke="rgba(255,255,255,.14)" strokeWidth=".8" />
      {/* bay light and its pool — dim until the rolls arrive */}
      <path className="bay-glow" d={`M80 ${GATE_TOP + 5} H88 L108 148 H60 Z`} fill="rgba(124,240,190,.12)" opacity="0" />
      <rect x="79" y={GATE_TOP + 2} width="10" height="2.5" rx="1" fill={WALL_DARK} stroke={EDGE} strokeWidth=".6" />
      <circle className="dock-lamp" cx="84" cy={GATE_TOP + 6} r="2.2" fill="#7CF0BE" opacity={LAMP_DIM} />
      {/* floor guide + the pallet the rolls land on */}
      <path d={`M${GATE_L + 3} 147 H${GATE_R - 3}`} stroke="#7CF0BE" strokeWidth="1" strokeDasharray="4 4" opacity=".45" />
      <g fill={WALL_DARK} stroke="rgba(255,255,255,.45)" strokeWidth=".8">
        <rect x="56" y="141" width="30" height="2.5" />
        <rect x="57" y="143.5" width="4" height="4.5" />
        <rect x="69" y="143.5" width="4" height="4.5" />
        <rect x="81" y="143.5" width="4" height="4.5" />
      </g>
      {/* dock bumper the truck's back stops against */}
      <rect x={GATE_R} y="130" width="3" height="8" rx=".6" fill="#0A1F18" stroke={EDGE} strokeWidth=".6" />
      {/* staff door at the far end, past the truck's nose */}
      <rect x="278" y="118" width="16" height="32" rx="1" fill={WALL_DARK} stroke={EDGE} strokeWidth="1" />
      <rect x="281" y="122" width="10" height="7" fill="rgba(234,255,245,.2)" />
      <circle cx="291" cy="136" r="1" fill={EDGE} />
    </svg>
  );
}

function LabelRoll() {
  return (
    <svg viewBox="0 0 16 16" className="block w-full h-full">
      <circle cx="8" cy="8" r="7" fill="rgba(255,255,255,.14)" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="2.2" fill="currentColor" />
      <path d="M8 1 A7 7 0 0 1 15 8" fill="none" stroke="#10553F" strokeWidth="2.2" />
    </svg>
  );
}
