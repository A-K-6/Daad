/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dialer: {
          bg: '#0f1117',
          card: '#181b24',
          border: '#272b36',
          hover: '#222634',
          active: '#2c3244',
          accent: '#10b981',
          danger: '#ef4444',
          warning: '#f59e0b',
        }
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.6', transform: 'scale(1.15)' },
        },
        ringRipple: {
          '0%': { transform: 'scale(0.8)', opacity: '0.8' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        }
      },
      animation: {
        'pulse-glow': 'pulseGlow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'ring-ripple': 'ringRipple 1.5s cubic-bezier(0, 0.2, 0.8, 1) infinite',
      }
    },
  },
  plugins: [],
}
