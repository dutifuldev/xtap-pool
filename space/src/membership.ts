import { z } from "zod";

import type { DatasetMirror } from "./dataset.js";

export const POOL_CONFIG_PATH = "config/pool.json";

const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const poolConfigSchema = z.object({
  version: z.literal(1),
  admins: z.array(z.string()).default([]),
  members: z.array(z.string()).default([]),
  updated_at: z.string(),
  updated_by: z.string().optional(),
});

export type PoolConfig = z.infer<typeof poolConfigSchema>;

export type PoolSnapshot = PoolConfig & {
  bootstrap_admins: readonly string[];
  source: "dataset" | "bootstrap";
  config_error?: string;
};

type PoolMembershipOptions = {
  mirror: DatasetMirror;
  bootstrapMembers: readonly string[];
  bootstrapAdmins: readonly string[];
  now: () => Date;
};

export class PoolMembership {
  private config: PoolConfig;
  private readonly bootstrapAdmins: readonly string[];
  private source: PoolSnapshot["source"];
  private configError: string | undefined;

  private constructor(
    private readonly options: PoolMembershipOptions,
    config: PoolConfig,
    source: PoolSnapshot["source"],
    configError?: string,
  ) {
    this.bootstrapAdmins = normalizeUsers(
      options.bootstrapAdmins.length > 0
        ? options.bootstrapAdmins
        : options.bootstrapMembers.slice(0, 1),
    );
    this.config = normalizeConfig(config);
    this.source = source;
    this.configError = configError;
  }

  static async load(options: PoolMembershipOptions): Promise<PoolMembership> {
    const fallback = bootstrapConfig(options);
    const raw = await options.mirror.readText(POOL_CONFIG_PATH);
    if (raw === undefined) return new PoolMembership(options, fallback, "bootstrap");
    try {
      const parsed = poolConfigSchema.parse(JSON.parse(raw));
      return new PoolMembership(options, parsed, "dataset");
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid pool config";
      return new PoolMembership(options, fallback, "bootstrap", message);
    }
  }

  isMember(username: string): boolean {
    return this.memberSet().has(normalizeUsername(username));
  }

  isAdmin(username: string): boolean {
    return this.adminSet().has(normalizeUsername(username));
  }

  snapshot(): PoolSnapshot {
    const admins = [...this.adminSet()].sort();
    const members = [...new Set([...normalizeUsers(this.config.members), ...admins])].sort();
    const snapshot: PoolSnapshot = {
      version: 1,
      admins,
      members,
      updated_at: this.config.updated_at,
      bootstrap_admins: this.bootstrapAdmins,
      source: this.source,
    };
    if (this.config.updated_by !== undefined) snapshot.updated_by = this.config.updated_by;
    if (this.configError !== undefined) snapshot.config_error = this.configError;
    return snapshot;
  }

  async addMember(actor: string, username: string): Promise<PoolSnapshot> {
    const user = normalizeUsername(username);
    if (this.memberSet().has(user)) return this.snapshot();
    this.config = {
      ...this.config,
      members: [...normalizeUsers(this.config.members), user].sort(),
    };
    await this.commit(actor, `config: add pool member ${user}`);
    return this.snapshot();
  }

  async removeMember(actor: string, username: string): Promise<PoolSnapshot> {
    const user = normalizeUsername(username);
    if (this.adminSet().has(user)) throw new Error(`@${user} is an admin; demote before removing`);
    const nextMembers = normalizeUsers(this.config.members).filter((member) => member !== user);
    if (nextMembers.length === this.config.members.length) return this.snapshot();
    this.config = { ...this.config, members: nextMembers };
    await this.commit(actor, `config: remove pool member ${user}`);
    return this.snapshot();
  }

  async addAdmin(actor: string, username: string): Promise<PoolSnapshot> {
    const user = normalizeUsername(username);
    if (this.adminSet().has(user)) return this.snapshot();
    this.config = {
      ...this.config,
      admins: [...normalizeUsers(this.config.admins), user].sort(),
      members: [...new Set([...normalizeUsers(this.config.members), user])].sort(),
    };
    await this.commit(actor, `config: add pool admin ${user}`);
    return this.snapshot();
  }

  async removeAdmin(actor: string, username: string): Promise<PoolSnapshot> {
    const user = normalizeUsername(username);
    if (this.bootstrapAdmins.includes(user)) {
      throw new Error(`@${user} is a bootstrap admin; change POOL_ADMINS to demote`);
    }
    const nextAdmins = normalizeUsers(this.config.admins).filter((admin) => admin !== user);
    if (nextAdmins.length === this.config.admins.length) return this.snapshot();
    if (new Set([...nextAdmins, ...this.bootstrapAdmins]).size === 0) {
      throw new Error("pool must keep at least one admin");
    }
    this.config = { ...this.config, admins: nextAdmins };
    await this.commit(actor, `config: remove pool admin ${user}`);
    return this.snapshot();
  }

  private adminSet(): Set<string> {
    return new Set([...normalizeUsers(this.config.admins), ...this.bootstrapAdmins]);
  }

  private memberSet(): Set<string> {
    return new Set([...normalizeUsers(this.config.members), ...this.adminSet()]);
  }

  private async commit(actor: string, title: string): Promise<void> {
    this.config = normalizeConfig({
      ...this.config,
      updated_at: this.options.now().toISOString(),
      updated_by: normalizeUsername(actor),
    });
    await this.options.mirror.writeTextAndCommit(
      POOL_CONFIG_PATH,
      `${JSON.stringify(this.config, null, 2)}\n`,
      title,
    );
    this.source = "dataset";
    this.configError = undefined;
  }
}

export function normalizeUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!USERNAME.test(normalized)) throw new Error(`invalid Hugging Face username: ${username}`);
  return normalized;
}

function normalizeUsers(users: readonly string[]): string[] {
  return [...new Set(users.map(normalizeUsername))].sort();
}

function normalizeConfig(config: PoolConfig): PoolConfig {
  const admins = normalizeUsers(config.admins);
  return {
    version: 1,
    admins,
    members: [...new Set([...normalizeUsers(config.members), ...admins])].sort(),
    updated_at: config.updated_at,
    ...(config.updated_by === undefined
      ? {}
      : { updated_by: normalizeUsername(config.updated_by) }),
  };
}

function bootstrapConfig(options: PoolMembershipOptions): PoolConfig {
  const members = normalizeUsers(options.bootstrapMembers);
  const admins = normalizeUsers(
    options.bootstrapAdmins.length > 0
      ? options.bootstrapAdmins
      : options.bootstrapMembers.slice(0, 1),
  );
  return {
    version: 1,
    admins,
    members: [...new Set([...members, ...admins])].sort(),
    updated_at: options.now().toISOString(),
  };
}
