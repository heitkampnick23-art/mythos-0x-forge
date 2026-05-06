import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        obsidian: {
          900: '#050507',
          800: '#0a0608',
          700: '#0f0a0d',
        },
        ember: {
          gold: '#ffb347',
          mid: '#ff7a1f',
          fire: '#ff5722',
          blood: '#c81d25',
          violet: '#6b2fb3',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      backdropBlur: {
        '3xl': '64px',
      },
      boxShadow: {
        glass: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 48px -12px rgba(0,0,0,0.6)',
        'glass-hot':
          'inset 0 1px 0 rgba(255,180,71,0.18), 0 0 32px -8px rgba(255,87,34,0.45), 0 24px 64px -20px rgba(200,29,37,0.35)',
        'ember-glow': '0 0 24px rgba(255,122,31,0.45), 0 0 64px rgba(200,29,37,0.25)',
      },
      animation: {
        'pulse-slow': 'pulse 3.5s cubic-bezier(0.4,0,0.6,1) infinite',
        'slide-up': 'slideUp 0.6s cubic-bezier(0.16,1,0.3,1) both',
        'fade-in': 'fadeIn 0.5s ease-out both',
        shimmer: 'shimmer 3s linear infinite',
      },
      keyframes: {
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
