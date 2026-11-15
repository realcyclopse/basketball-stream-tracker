/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'court-bg': '#0A0E17',
        'card-bg': '#111827',
        'card-border': '#1f2937',
      },
    },
  },
  plugins: [],
}
