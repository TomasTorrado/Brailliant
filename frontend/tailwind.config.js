/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Atkinson Hyperlegible"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        bg: 'var(--color-bg)',
        cardBg: 'var(--color-card)',
        text: 'var(--color-text)',
        subtext: 'var(--color-subtext)',
        border: 'var(--color-border)',
        shadow: 'var(--color-shadow)',
        primary: 'var(--color-primary)',
        purple: 'var(--color-purple)',
        teal: 'var(--color-teal)',
        yellow: 'var(--color-yellow)',
        toggleBg: 'var(--color-toggle-bg)',
        dotEmpty: 'var(--color-dot-empty)',
      },
      borderWidth: {
        3: '3px',
      },
      boxShadow: {
        'brutal-sm': '2px 2px 0 var(--color-shadow)',
        brutal: '4px 4px 0 var(--color-shadow)',
        'brutal-lg': '6px 6px 0 var(--color-shadow)',
      },
    },
  },
  plugins: [],
}

