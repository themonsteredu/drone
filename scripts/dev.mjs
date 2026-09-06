import { spawn } from "node:child_process";

// Accept the preview supervisor's Vite-style flags while retaining Next.js.
const args = process.argv.slice(2).filter((arg) => arg !== "--strictPort")
  .map((arg) => arg === "--host" ? "--hostname" : arg);
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", ...args], {
  stdio: "inherit",
  env: process.env,
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
