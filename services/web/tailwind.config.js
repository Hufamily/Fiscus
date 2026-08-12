/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ink-on-paper ledger palette
        paper: "#faf7f2",        // warm page background
        surface: "#fffdf9",      // card surface
        ink: "#1c1917",          // near-black warm text
        faint: "#78716c",        // secondary text (warm gray)
        hairline: "#e7e0d8",     // borders
        moss: { DEFAULT: "#3f6212", dark: "#365314", soft: "#f1f5e9" }, // primary accent
        bronze: "#a16207",       // secondary accent (agent / memory)
        // keep old names working during transition
        brand: { DEFAULT: "#3f6212", dark: "#365314" },
      },
      fontFamily: {
        display: ["Fraunces", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(28,25,23,0.04), 0 4px 16px rgba(28,25,23,0.04)",
      },
    },
  },
  plugins: [],
};
