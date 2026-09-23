import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  // Resolve relative to this file, so builds work regardless of the working directory
  content: {
    relative: true,
    files: [
      './app/**/*.{js,ts,jsx,tsx,mdx}',
      './components/**/*.{js,ts,jsx,tsx,mdx}',
      './lib/**/*.{js,ts,jsx,tsx,mdx}',
    ],
  },
  theme: {
    extend: {
      colors: {
        background: '#09090b',
        surface: {
          DEFAULT: '#18181b',
          subtle: '#121215',
          muted: '#27272a',
        },
        border: {
          DEFAULT: '#27272a',
          subtle: '#1f1f23',
          strong: '#3f3f46',
        },
        foreground: {
          DEFAULT: '#fafafa',
          muted: '#a1a1aa',
          dim: '#71717a',
        },
        tier: {
          prime: '#10b981',
          nearprime: '#38bdf8',
          moderate: '#f59e0b',
          subprime: '#ef4444',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      boxShadow: {
        hairline: '0 0 0 1px rgba(255, 255, 255, 0.08)',
        fintech: '0 1px 3px 0 rgba(0, 0, 0, 0.4), 0 1px 2px -1px rgba(0, 0, 0, 0.4)',
      },
    },
  },
  plugins: [],
};

export default config;
