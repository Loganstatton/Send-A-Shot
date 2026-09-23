"use client";

// Branded loading state — REBUILD (V4). Keeps the V3 concept (a turning
// vault wheel + a 0-100% progress readout, never a bare spinner on black)
// but the visual flourish is simplified to match this pass's flat-
// placeholder-art honesty (spec point 30): flat panel colors instead of
// multi-stop "painted metal" gradients on the door leaves, no light-sweep
// highlight trying to simulate a lit surface. Once the game is actually
// ready it never just cuts to the canvas — the two flat door panels slide
// apart. If loading was fast (assets already cached, <1s total), the full
// transition is skipped in favor of a very short fade — never a jarring
// instant swap, but also never an artificially slow reveal.
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
      {/* Flat, calm backdrop — no painted/lit-surface simulation (spec point 30/policy). */}
      <div className="pointer-events-none absolute inset-0 bg-[#0a0d14]" />

      {/* Door leaves — flat single-tone panels, slide apart on the exit transition. No gradient trying to simulate painted metal. */}
      <div
        className="absolute inset-y-0 left-0 w-1/2 border-r border-accent-sc/30 bg-[#171b26]"
        style={{
          transform: doorsOpening ? "translateX(-105%)" : "translateX(0)",
          transition: doorsOpening ? "transform 700ms cubic-bezier(0.22,0.68,0,1.01)" : undefined,
        }}
      />
      <div
        className="absolute inset-y-0 right-0 w-1/2 border-l border-accent-sc/30 bg-[#171b26]"
        style={{
          transform: doorsOpening ? "translateX(105%)" : "translateX(0)",
          transition: doorsOpening ? "transform 700ms cubic-bezier(0.22,0.68,0,1.01)" : undefined,
        }}
      />

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

/** A slowly-turning mechanical vault wheel — pure inline SVG + CSS animation, flat fills only (no gradients simulating lit metal — matches this pass's flat-placeholder honesty). No canvas dependency (this overlay must render before Pixi exists). */
function VaultWheel() {
  return (
    <div className="relative h-20 w-20">
      <svg
        viewBox="0 0 100 100"
        className="h-full w-full"
        style={{ animation: "vault-wheel-spin 5.5s linear infinite" }}
      >
        <circle cx="50" cy="50" r="44" fill="#b5862c" stroke="#2dbfb0" strokeWidth="2" />
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
