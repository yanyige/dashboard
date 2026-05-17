#!/usr/bin/env node
import { resolve } from "node:path";
import { createWebServer } from "../src/web-server.mjs";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const root = resolve(process.env.CCC_ROOT ?? "data/workspace");

const server = createWebServer({ root });

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(`dashboard listening on http://${host}:${actualPort}`);
  console.log(`data root: ${root}`);
});
