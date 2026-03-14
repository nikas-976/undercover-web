/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#020817',
          900: '#050a15',
          800: '#0a1428',
          700: '#0f1f3d',
          600: '#162952',
        },
        cyan: {
          glow: '#00f5d4',
        },
        amber: {
          glow: '#f59e0b',
        }
      },
      fontFamily: {
        display: ['Syne', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
        body: ['DM Sans', 'sans-serif'],
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'scanline': 'scanline 8s linear infinite',
        'flicker': 'flicker 0.15s infinite',
        'slide-up': 'slide-up 0.4s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
        'shake': 'shake 0.5s ease-in-out',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 8px #00f5d4, 0 0 20px rgba(0,245,212,0.3)' },
          '50%': { boxShadow: '0 0 16px #00f5d4, 0 0 40px rgba(0,245,212,0.5)' },
        },
        'scanline': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        'flicker': {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.8 },
        },
        'slide-up': {
          from: { transform: 'translateY(20px)', opacity: 0 },
          to: { transform: 'translateY(0)', opacity: 1 },
        },
        'fade-in': {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
        'shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-8px)' },
          '40%': { transform: 'translateX(8px)' },
          '60%': { transform: 'translateX(-4px)' },
          '80%': { transform: 'translateX(4px)' },
        }
      }
    },
  },
  plugins: [],
}
