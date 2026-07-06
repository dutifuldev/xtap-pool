import { join } from "node:path";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createHubClient, DatasetMirror } from "./dataset.js";
import { ingestBatch, Mutex } from "./ingest.js";
import { PoolMembership } from "./membership.js";
import { TweetStore } from "./store.js";

const config = loadConfig(process.env);
const store = new TweetStore();
const hub = createHubClient(config.datasetRepo, config.hfToken);
const mirror = new DatasetMirror(hub, join(config.dataDir, "mirror"));
const mutex = new Mutex();
const membership = await PoolMembership.load({
  mirror,
  bootstrapMembers: config.allowedUsers,
  bootstrapAdmins: config.poolAdmins,
  now: () => new Date(),
});

const app = createApp({
  config,
  store,
  membership,
  ingest: (username, payload) =>
    mutex.run(() => ingestBatch({ store, mirror, now: () => new Date() }, username, payload)),
});

// Explorer static assets; API and OAuth routes are registered first and win.
app.use("*", serveStatic({ root: config.staticRoot }));
app.use("*", serveStatic({ root: config.staticRoot, path: "index.html" }));

console.log(`[xtap-pool] rebuilding index from ${config.datasetRepo} ...`);
const rebuilt = await mirror.rebuild(store);
const pool = membership.snapshot();
console.log(
  `[xtap-pool] indexed ${String(rebuilt.tweets)} tweets from ${String(rebuilt.files)} files; ` +
    `${String(pool.members.length)} pool members, ${String(pool.admins.length)} admins`,
);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[xtap-pool] listening on :${String(info.port)}`);
});
