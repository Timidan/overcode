import react from "@vitejs/plugin-react";
import { createServer } from "vite";
import { startBridge } from "./dev-browser-bridge.mjs";

const bridge = await startBridge();
const server = await createServer({
  root: process.cwd(),
  configFile: false,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
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
