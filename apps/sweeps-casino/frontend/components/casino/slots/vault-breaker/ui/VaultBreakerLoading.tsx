"use client";

// Branded loading state, rebuilt for V2 — the previous version was "a
// black box with a spinner", explicitly called out as unacceptable.
// This is a small cinematic: dark vault artwork backdrop, an animated
// vault wheel slowly turning, a 0-100% progress readout, ambient light —
// and once the game is actually ready it never just cuts to the canvas.
// Instead the vault doors slide open and reveal it underneath. If loading
// was fast (assets already cached, <1s total), the full cinematic is
// skipped in favor of a very short branded flash — never a jarring instant
// swap, but also never an artificially slow reveal.
import { useEffect, useRef, useState } from "react";
import { VaultlineLogo } from "@/components/ui/VaultlineLogo";

const FAST_PATH_THRESHOLD_MS = 1000;

export interface VaultBreakerLoadingProps {
  /** 0-100. Purely presentational — reflects config fetch + Pixi texture build progress. */
  progress: number;
  /** True once the game is actually ready to show (renderer mounted). Triggers the exit transition. */
  ready: boolean;
  /** Called once the exit transition has fully finished — parent unmounts this overlay. */
  onDone: () => void;
}

export function VaultBreakerLoading({ progress, ready, onDone }: VaultBreakerLoadingProps) {
  const mountedAt = useRef<number>(Date.now());
  const [exitPhase, setExitPhase] = useState<"idle" | "flash" | "doors" | "gone">("idle");
  const pct = Math.max(4, Math.min(100, Math.round(progress)));

  useEffect(() => {
    if (!ready || exitPhase !== "idle") return;
    const elapsed = Date.now() - mountedAt.current;
    const fast = elapsed < FAST_PATH_THRESHOLD_MS;
    setExitPhase(fast ? "flash" : "doors");
    const duration = fast ? 260 : 780;
    const t = setTimeout(() => {
      setExitPhase("gone");
      onDone();
    }, duration);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, exitPhase]);

  if (exitPhase === "gone") return null;

  const doorsOpening = exitPhase === "doors";
  const flashing = exitPhase === "flash";

  return (
    <div
      className="absolute inset-0 z-20 overflow-hidden bg-[#070a12]"
      style={{
        opacity: flashing ? 0 : 1,
        transition: flashing ? "opacity 220ms ease-out" : undefined,
      }}
    >
      {/* Cinematic vault-chamber backdrop */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 38%, rgba(45,191,176,0.22) 0%, rgba(212,175,55,0.1) 42%, transparent 72%), linear-gradient(180deg, #0a0e18 0%, #111726 45%, #070a12 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, rgba(212,175,55,0.05) 0px, rgba(212,175,55,0.05) 1px, transparent 1px, transparent 14%)",
        }}
      />

      {/* Vault door leaves — slide apart on the exit transition */}
      <div
        className="absolute inset-y-0 left-0 w-1/2"
        style={{
          background: "linear-gradient(90deg, #3a2a0f 0%, #c99a2f 55%, #7a5c17 100%)",
          borderRight: "3px solid rgba(45,191,176,0.5)",
          transform: doorsOpening ? "translateX(-105%)" : "translateX(0)",
          transition: doorsOpening ? "transform 700ms cubic-bezier(0.22,0.68,0,1.01)" : undefined,
          boxShadow: "inset -20px 0 40px rgba(0,0,0,0.4)",
        }}
      >
        <div className="absolute inset-0 opacity-25" style={{ background: "radial-gradient(circle at 90% 50%, rgba(255,255,255,0.5), transparent 60%)" }} />
      </div>
      <div
        className="absolute inset-y-0 right-0 w-1/2"
        style={{
          background: "linear-gradient(270deg, #3a2a0f 0%, #c99a2f 55%, #7a5c17 100%)",
          borderLeft: "3px solid rgba(45,191,176,0.5)",
          transform: doorsOpening ? "translateX(105%)" : "translateX(0)",
          transition: doorsOpening ? "transform 700ms cubic-bezier(0.22,0.68,0,1.01)" : undefined,
          boxShadow: "inset 20px 0 40px rgba(0,0,0,0.4)",
        }}
      >
        <div className="absolute inset-0 opacity-25" style={{ background: "radial-gradient(circle at 10% 50%, rgba(255,255,255,0.5), transparent 60%)" }} />
      </div>

      {/* Foreground content: logo, wheel, title, progress */}
      <div
        className="relative flex h-full w-full flex-col items-center justify-center gap-5 px-6 text-center"
        style={{
          opacity: doorsOpening ? 0 : 1,
          transition: doorsOpening ? "opacity 260ms ease-out" : undefined,
        }}
      >
        <VaultlineLogo className="h-9 w-9 opacity-90" />

        <VaultWheel />

        <div>
          <p className="text-xl font-extrabold tracking-wide text-text-primary">VAULT BREAKER</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.35em] text-accent-sc/80">Vaultline Studios</p>
        </div>

        <div className="w-56">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent-sc to-accent-gc shadow-[0_0_10px_rgba(45,191,176,0.6)] transition-[width] duration-200 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 font-mono text-[11px] tracking-widest text-text-muted">
            LOADING {pct}%
          </p>
        </div>
      </div>
    </div>
  );
}

/** A slowly-turning mechanical vault wheel — pure inline SVG + CSS animation, no canvas dependency (this overlay must render before Pixi exists). */
function VaultWheel() {
  return (
    <div className="relative h-20 w-20">
      <svg
        viewBox="0 0 100 100"
        className="h-full w-full"
        style={{ animation: "vault-wheel-spin 5.5s linear infinite" }}
      >
        <defs>
          <radialGradient id="vwl-rim" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#f2d98a" />
            <stop offset="55%" stopColor="#b5862c" />
            <stop offset="100%" stopColor="#5c4415" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="44" fill="url(#vwl-rim)" stroke="#2dbfb0" strokeWidth="2" />
        {Array.from({ length: 10 }).map((_, i) => {
          const a = (Math.PI * 2 * i) / 10;
          return <circle key={i} cx={50 + Math.cos(a) * 37} cy={50 + Math.sin(a) * 37} r="2.2" fill="rgba(30,20,5,0.7)" />;
        })}
        <circle cx="50" cy="50" r="28" fill="#3a2a10" stroke="rgba(212,175,55,0.6)" strokeWidth="1.2" />
        {Array.from({ length: 6 }).map((_, i) => {
          const a = (Math.PI / 3) * i;
          return (
            <line
              key={i}
              x1="50"
              y1="50"
              x2={50 + Math.sin(a) * 22}
              y2={50 - Math.cos(a) * 22}
              stroke="#e8c15a"
              strokeWidth="3.4"
              strokeLinecap="round"
            />
          );
        })}
        <circle cx="50" cy="50" r="7" fill="#eafffb" stroke="#0f6b63" strokeWidth="1.5" />
      </svg>
      <div
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{ boxShadow: "0 0 24px rgba(212,175,55,0.35), 0 0 40px rgba(45,191,176,0.15)" }}
      />
      <style jsx>{`
        @keyframes vault-wheel-spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
