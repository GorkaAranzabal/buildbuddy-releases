/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx,html}'],
  theme: {
    extend: {
      colors: {
        overlay: {
          bg: 'rgba(255, 255, 255, 0.01)',
          border: 'rgba(255, 255, 255, 0.15)',
          surface: 'rgba(255, 255, 255, 0.03)',
          accent: '#3b82f6',
          success: '#22c55e',
          warning: '#f59e0b',
          error: '#ef4444',
        },
        glass: {
          bg: 'rgba(255, 255, 255, 0.01)',
          lighter: 'rgba(255, 255, 255, 0.05)',
          border: 'rgba(255, 255, 255, 0.15)',
          borderHover: 'rgba(255, 255, 255, 0.25)',
          input: 'rgba(255, 255, 255, 0.05)',
          panel: 'rgba(255, 255, 255, 0.03)',
        },
      },
      backdropBlur: {
        overlay: '60px',
        glass: '40px',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
    },
  },
  plugins: [],
};
