/** @type {import('tailwindcss').Config} */
// content : les fichiers scannés par Tailwind pour ne générer que les classes
// réellement utilisées (build CSS minimal).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
