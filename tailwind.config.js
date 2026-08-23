/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Only resolve to the real typefaces inside app/next/layout.tsx's
        // .next-theme scope (where next/font sets these CSS vars) — the
        // var() fallback keeps Scout's existing font-mono usage unchanged.
        display: ['var(--font-display, "Bricolage Grotesque")', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono, ui-monospace)', 'SFMono-Regular', 'Menlo', 'Consolas', '"Liberation Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
