'use client';
import { useEffect, useRef } from 'react';

// A Pokémon-card-style holographic tilt wrapper — 3D perspective rotation
// plus a rainbow foil sheen, both driven 1:1 by pointer/touch position, for
// the one card in the app meant to feel like a physical collectible (the
// Founding Believer receipt). Pointer Events (not separate mouse/touch
// handlers) matches the drag pattern PriceChart already uses for the same
// mouse+touch-unification reason.
//
// Style updates happen via direct ref writes in the pointer handlers, NOT
// React state — a tilt effect needs to track every pointermove at up to
// display refresh rate, and routing that through setState would mean a
// full React re-render per frame. The imperative writes here are the
// entire reason this stays smooth.
//
// Two independent transform layers, deliberately on two different DOM
// nodes: an outer .holo-card-idle plays a slow CSS @keyframes sway so the
// card looks alive the moment it's on screen, not just when touched; the
// inner .holo-card-tilt (this component's own ref writes) takes over for
// direct pointer control. Putting both on the SAME element would fail —
// a running CSS animation's value for a property beats an inline style
// set from JS for that same property, so the idle sway would silently
// override every pointermove write. Splitting them onto parent/child
// avoids that fight entirely; their transforms just compose normally.
export default function HoloCard({ children, className }: { children: React.ReactNode; className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const idleRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const shineRef = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLDivElement>(null);
  const reducedMotionRef = useRef(false);
  const activeRef = useRef(false);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  function setTransition(on: boolean) {
    const tilt = tiltRef.current;
    const shine = shineRef.current;
    const glare = glareRef.current;
    // Snappy (near-instant) while actively tracking the pointer so the tilt
    // never feels laggy; a soft spring-back only on release. All three
    // layers move in lockstep so the foil never lags behind the tilt.
    const t = on ? 'transform 450ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 450ms ease' : 'transform 60ms linear';
    if (tilt) tilt.style.transition = t;
    if (shine) shine.style.transition = on ? 'opacity 450ms ease, background-position 450ms ease' : 'opacity 120ms ease';
    if (glare) glare.style.transition = on ? 'opacity 450ms ease' : 'opacity 120ms ease';
  }

  function update(clientX: number, clientY: number) {
    const wrap = wrapRef.current;
    const tilt = tiltRef.current;
    const shine = shineRef.current;
    const glare = glareRef.current;
    if (!wrap || !tilt) return;
    const rect = wrap.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));

    // Reduced motion: keep the shine (a color/opacity effect, not a motion
    // one) but drop the actual 3D rotation — a tilting card is exactly the
    // kind of parallax motion `prefers-reduced-motion` exists to opt out of.
    const maxTilt = reducedMotionRef.current ? 0 : 12;
    const rotateY = (x - 0.5) * 2 * maxTilt;
    const rotateX = (0.5 - y) * 2 * maxTilt;
    const scale = activeRef.current ? 1.025 : 1;
    tilt.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(${scale}, ${scale}, ${scale})`;

    if (shine) {
      shine.style.backgroundPosition = `${x * 100}% ${y * 100}%`;
      shine.style.opacity = activeRef.current ? '0.85' : '0';
    }
    if (glare) {
      glare.style.background = `radial-gradient(circle at ${x * 100}% ${y * 100}%, oklch(100% 0 0 / 0.55), transparent 45%)`;
      glare.style.opacity = activeRef.current ? '1' : '0';
    }
  }

  function reset() {
    activeRef.current = false;
    setTransition(false);
    idleRef.current?.classList.remove('holo-card-idle-paused');
    const tilt = tiltRef.current;
    const shine = shineRef.current;
    const glare = glareRef.current;
    if (tilt) tilt.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
    if (shine) shine.style.opacity = '0';
    if (glare) glare.style.opacity = '0';
  }

  return (
    <div
      ref={wrapRef}
      className={`holo-card-wrap ${className ?? ''}`}
      onPointerDown={(e) => {
        activeRef.current = true;
        idleRef.current?.classList.add('holo-card-idle-paused');
        setTransition(true);
        update(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => { if (activeRef.current) update(e.clientX, e.clientY); }}
      onPointerUp={reset}
      onPointerCancel={reset}
      onPointerLeave={reset}
    >
      <div ref={idleRef} className="holo-card-idle">
        <div ref={tiltRef} className="holo-card-tilt">
          {children}
          <div className="holo-card-idle-shine" aria-hidden="true" />
          <div ref={shineRef} className="holo-card-shine" aria-hidden="true" />
          <div ref={glareRef} className="holo-card-glare" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
