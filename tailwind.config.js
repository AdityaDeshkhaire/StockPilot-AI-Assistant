/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#1F3A5F', light: '#2C5282', dark: '#152a45' },
        ai: { bg: '#F6F2FF', text: '#5B3E96', border: '#D9CCF5' },
      },
    },
  },
  plugins: [],
};
