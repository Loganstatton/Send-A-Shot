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
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        "glow-gc": "0 0 24px 0 rgb(var(--color-accent-gc) / 0.35)",
        "glow-sc": "0 0 24px 0 rgb(var(--color-accent-sc) / 0.35)",
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
      },
    },
  },
  plugins: [],
};

export default config;
