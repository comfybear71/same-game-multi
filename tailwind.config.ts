import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Neutral dark surface palette, mobile-first.
        surface: {
          DEFAULT: "#0b0f17",
          card: "#131a26",
          border: "#1f2a3a",
        },
        accent: {
          DEFAULT: "#38bdf8",
          win: "#22c55e",
          loss: "#ef4444",
          pending: "#f59e0b",
        },
      },
    },
  },
  plugins: [],
};

export default config;
