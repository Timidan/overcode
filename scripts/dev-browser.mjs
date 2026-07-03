import react from "@vitejs/plugin-react";
import { createServer } from "vite";
import { startBridge } from "./dev-browser-bridge.mjs";

function readPort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

const host = process.env.OVERCODE_DEV_HOST || "127.0.0.1";
const port = readPort(process.env.OVERCODE_DEV_PORT, 5173);

const bridge = await startBridge();
const server = await createServer({
  root: process.cwd(),
  configFile: false,
  plugins: [react()],
  server: {
    host,
    port,
    strictPort: false,
  },
});

await server.listen();
server.printUrls();
console.log(`Overcode browser bridge: http://127.0.0.1:${bridge.port}`);

async function shutdown() {
  await server.close();
  await bridge.close();
}

process.once("SIGINT", () => {
  shutdown().finally(() => process.exit(0));
});

process.once("SIGTERM", () => {
  shutdown().finally(() => process.exit(0));
});
