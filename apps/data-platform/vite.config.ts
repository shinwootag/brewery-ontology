import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  // COURSE_NOW lives in the repo-root .env (two levels up), not the app dir,
  // so load it explicitly and expose it to the client build.
  const rootEnv = loadEnv(mode, resolve(process.cwd(), "../.."), "");
  const courseNow = rootEnv.COURSE_NOW ?? process.env.COURSE_NOW ?? "";

  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_COURSE_NOW": JSON.stringify(courseNow),
    },
    server: {
      proxy: {
        "/api": "http://localhost:3456",
      },
    },
  };
});
