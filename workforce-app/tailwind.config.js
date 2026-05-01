/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#0F1F3D', gold: '#F59E0B', cloud: '#F4F6FA',
        ink: '#0F172A', slate: '#64748B', rule: '#CBD5E1',
        accent: '#7C3AED', 'accent-dark': '#5B21B6', 'accent-light': '#EDE9FE',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] },
      boxShadow: { card: '0 1px 3px rgba(0,0,0,0.08)', hover: '0 4px 12px rgba(0,0,0,0.12)', modal: '0 8px 32px rgba(0,0,0,0.16)' },
    },
  },
  plugins: [],
}
