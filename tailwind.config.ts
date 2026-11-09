import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      borderRadius: {
        none: "0px",
        sm: "0px",
        DEFAULT: "0px",
        md: "0px",
        lg: "0px",
        xl: "0px",
        "2xl": "0px",
        "3xl": "0px",
        full: "0px",
      },
      boxShadow: {
        "hard-sm": "2px 2px 0px 0px #0F172A",
        "hard-md": "4px 4px 0px 0px #0F172A",
        "hard-lg": "6px 6px 0px 0px #0F172A",
      },
      colors: {
        surface: {
          bg: "#F8FAFC",
          card: "#FFFFFF",
          subtle: "#F1F5F9",
          dark: "#0F172A",
        },
        border: {
          hairline: "#E2E8F0",
          hard: "#0F172A",
        },
      },
    },
  },
  plugins: [],
};
export default config;

