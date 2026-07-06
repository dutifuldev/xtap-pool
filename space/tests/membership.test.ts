import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatasetMirror } from "../src/dataset.js";
import { PoolMembership } from "../src/membership.js";
import { TweetStore } from "../src/store.js";
import { FakeHub } from "./helpers.js";

const NOW = new Date("2026-07-06T12:00:00.000Z");

let dir: string;
let hub: FakeHub;
let mirror: DatasetMirror;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xtap-pool-membership-"));
  hub = new FakeHub();
  mirror = new DatasetMirror(hub, dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("PoolMembership", () => {
  it("bootstraps members and first-user admin when no config exists", async () => {
    const membership = await PoolMembership.load({
      mirror,
      bootstrapMembers: ["osolmaz", "alice"],
      bootstrapAdmins: [],
      now: () => NOW,
    });
    expect(membership.snapshot()).toMatchObject({
      members: ["alice", "osolmaz"],
      admins: ["osolmaz"],
      source: "bootstrap",
    });
    expect(membership.isMember("alice")).toBe(true);
    expect(membership.isAdmin("alice")).toBe(false);
  });

  it("loads dataset config without treating bootstrap members as permanent members", async () => {
    hub.files.set(
      "config/pool.json",
      JSON.stringify({
        version: 1,
        admins: ["carol"],
        members: ["carol"],
        updated_at: NOW.toISOString(),
      }),
    );
    const membership = await PoolMembership.load({
      mirror,
      bootstrapMembers: ["osolmaz", "alice"],
      bootstrapAdmins: ["osolmaz"],
      now: () => NOW,
    });
    expect(membership.snapshot()).toMatchObject({
      members: ["carol", "osolmaz"],
      admins: ["carol", "osolmaz"],
      source: "dataset",
    });
    expect(membership.isMember("alice")).toBe(false);
  });

  it("commits member changes to config/pool.json", async () => {
    const membership = await PoolMembership.load({
      mirror,
      bootstrapMembers: ["osolmaz"],
      bootstrapAdmins: ["osolmaz"],
      now: () => NOW,
    });
    await membership.addMember("osolmaz", "Alice");
    const raw = hub.files.get("config/pool.json");
    expect(raw).toBeDefined();
    expect(JSON.parse(raw ?? "{}")).toMatchObject({
      members: ["alice", "osolmaz"],
      updated_by: "osolmaz",
    });
    expect(hub.commits[0]?.title).toBe("config: add pool member alice");
  });

  it("falls back to bootstrap admins when config is invalid", async () => {
    hub.files.set("config/pool.json", "not json");
    const membership = await PoolMembership.load({
      mirror,
      bootstrapMembers: ["osolmaz"],
      bootstrapAdmins: ["osolmaz"],
      now: () => NOW,
    });
    expect(membership.snapshot().source).toBe("bootstrap");
    expect(membership.snapshot().config_error).toBeDefined();
    expect(membership.isAdmin("osolmaz")).toBe(true);
  });
});

describe("DatasetMirror metadata files", () => {
  it("does not include config files in data rebuilds", async () => {
    hub.files.set("config/pool.json", "{}");
    const store = new TweetStore();
    try {
      await expect(mirror.rebuild(store)).resolves.toEqual({ files: 0, tweets: 0 });
    } finally {
      store.close();
    }
  });
});
