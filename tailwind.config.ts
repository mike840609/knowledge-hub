import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#102a43",
        paper: "#f7f9fb",
        accent: "#0f766e",
      },
    },
  },
  plugins: [],
};

export default config;
