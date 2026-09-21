import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--color-bg) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        "surface-raised": "rgb(var(--color-surface-raised) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        "text-primary": "rgb(var(--color-text-primary) / <alpha-value>)",
        "text-muted": "rgb(var(--color-text-muted) / <alpha-value>)",
        "accent-gc": "rgb(var(--color-accent-gc) / <alpha-value>)",
        "accent-gc-soft": "rgb(var(--color-accent-gc-soft) / <alpha-value>)",
        "accent-sc": "rgb(var(--color-accent-sc) / <alpha-value>)",
        "accent-sc-soft": "rgb(var(--color-accent-sc-soft) / <alpha-value>)",
        success: "rgb(var(--color-success) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
        // VIP tier metals — Starter through Elite. Use with bg-tier-metal
        // (styles/globals.css) for the gradient sheen, or these flat tokens
        // for borders/badges/text (e.g. text-tier-gold, border-tier-diamond/40).
        "tier-starter": "rgb(var(--color-tier-starter) / <alpha-value>)",
        "tier-bronze": "rgb(var(--color-tier-bronze) / <alpha-value>)",
        "tier-silver": "rgb(var(--color-tier-silver) / <alpha-value>)",
        "tier-gold": "rgb(var(--color-tier-gold) / <alpha-value>)",
        "tier-platinum": "rgb(var(--color-tier-platinum) / <alpha-value>)",
        "tier-diamond": "rgb(var(--color-tier-diamond) / <alpha-value>)",
        "tier-elite": "rgb(var(--color-tier-elite) / <alpha-value>)",
        "tier-elite-hi": "rgb(var(--color-tier-elite-hi) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        "glow-gc": "0 0 24px 0 rgb(var(--color-accent-gc) / 0.35)",
        "glow-sc": "0 0 24px 0 rgb(var(--color-accent-sc) / 0.35)",
        // Larger, softer versions for hero-scale elements (jackpot display,
        // active-currency pill, featured hero CTA) — still restrained, just
        // sized for a bigger surface than the original card-level glow.
        "glow-gc-lg": "0 0 48px 4px rgb(var(--color-accent-gc) / 0.30)",
        "glow-sc-lg": "0 0 48px 4px rgb(var(--color-accent-sc) / 0.30)",
        // Card lift-on-hover shadow (desktop game-card hover per the
        // Casino Visual Redesign spec): a soft ambient shadow, not a hard
        // drop shadow, so the card reads as physically lifted off the felt.
        "card-lift": "0 18px 40px -12px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(var(--color-border) / 0.6)",
      },
      // Restrained, fast microinteraction easings. "premium" is a snappy
      // ease-out-expo feel for anything that appears (cards, menus,
      // toasts); "snappy" is a quicker in-out for state toggles (tabs,
      // currency switch, favorite button).
      transitionTimingFunction: {
        premium: "cubic-bezier(0.16, 1, 0.3, 1)",
        snappy: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-500px 0" },
          "100%": { backgroundPosition: "500px 0" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Card entering a grid/carousel (game cards, promo cards).
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Modals, badges, and anything that should "pop" into place.
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        // Favorite button, daily-bonus/claim confirmation: a quick,
        // restrained bounce rather than a full spring.
        pop: {
          "0%": { transform: "scale(1)" },
          "40%": { transform: "scale(1.18)" },
          "100%": { transform: "scale(1)" },
        },
        // Balance ticking up after a claim/win — a soft glow flash, not a
        // full-color change, so it reads as "reward" not "alert".
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgb(var(--color-accent-gc) / 0)" },
          "30%": { boxShadow: "0 0 20px 4px rgb(var(--color-accent-gc) / 0.45)" },
        },
        // Bottom sheets / slide-out menu on mobile.
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Notification/toast arrival.
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translateX(16px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        // Inline form-validation feedback.
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-4px)" },
          "40%": { transform: "translateX(4px)" },
          "60%": { transform: "translateX(-3px)" },
          "80%": { transform: "translateX(3px)" },
        },
        // Slow ambient breathing glow for the jackpot total / hero accents
        // — a living-but-calm presence, not an alert.
        "jackpot-pulse": {
          "0%, 100%": { textShadow: "0 0 18px rgb(var(--color-accent-gc) / 0.55), 0 0 42px rgb(var(--color-accent-gc) / 0.22)" },
          "50%": { textShadow: "0 0 26px rgb(var(--color-accent-gc) / 0.75), 0 0 58px rgb(var(--color-accent-gc) / 0.35)" },
        },
        // Very slow positional drift for large ambient background gradients
        // (hero banners, page-level bg-casino-ambient) — imperceptible as
        // motion, felt as atmosphere.
        "ambient-drift": {
          "0%, 100%": { backgroundPosition: "0% 0%" },
          "50%": { backgroundPosition: "3% 2%" },
        },
        // New row/card arriving in the Live Wins ticker.
        "win-enter": {
          "0%": { opacity: "0", transform: "translateY(-10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s linear infinite",
        "fade-in": "fade-in 0.2s ease-out",
        "fade-in-up": "fade-in-up 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "scale-in": "scale-in 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
        pop: "pop 0.32s cubic-bezier(0.34, 1.56, 0.64, 1)",
        "pulse-glow": "pulse-glow 0.9s ease-out",
        "slide-up": "slide-up 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in-right": "slide-in-right 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
        shake: "shake 0.35s ease-in-out",
        "jackpot-pulse": "jackpot-pulse 3.5s ease-in-out infinite",
        "ambient-drift": "ambient-drift 18s ease-in-out infinite",
        "win-enter": "win-enter 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
