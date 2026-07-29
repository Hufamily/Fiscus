/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        brand: { DEFAULT: "#0d9488", dark: "#0f766e" },
      },
    },
  },
  plugins: [],
};
