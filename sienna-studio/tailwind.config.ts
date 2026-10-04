import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#0b0b0f', 900: '#121218', 800: '#1b1b24', 700: '#262633', 600: '#3a3a4a', 400: '#8a8aa0', 200: '#d4d4e0' },
        accent: { DEFAULT: '#e8836b', soft: '#f3b5a5', deep: '#c2604a' },
      },
      spacing: { safe: 'env(safe-area-inset-bottom)' },
    },
  },
  plugins: [],
} satisfies Config;
