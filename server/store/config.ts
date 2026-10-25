import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CONFIG_VERSION, ConfigZ, defaultConfig, type Config } from "../../lib/profile";
import { migrateLegacy, type LegacyEnv } from "./migrate";

// config.json holds the household profile (versioned, validated). secrets.json holds tokens and keys (0600).
// Nothing is ever reset silently: a file that can't be read, doesn't validate, or comes from a newer version
// stops the server with a message that says which file and why. The file is left untouched.

export class ConfigError extends Error {}

export const SecretsZ = z.object({
  plexToken: z.string().min(1).max(200).optional(),
  espnWatchApiKey: z.string().min(1).max(200).optional(),
  sessionKey: z.string().optional(), // written by early 0.2 builds and never used; ignored, dropped on next save
}).strict().transform(({ sessionKey: _unused, ...rest }) => rest);
export type Secrets = z.output<typeof SecretsZ>;

async function readJson(file: string): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new ConfigError(`Can't read ${file}: ${(e as Error).message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new ConfigError(`${file} isn't valid JSON (${(e as Error).message}). Fix it or restore ${file}.bak.`);
  }
}

/** Write via a temp file + rename so a crash can't leave half a file. Keeps the previous version as .bak. */
export async function writeJsonAtomic(file: string, data: unknown, keepBackup = true): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  if (keepBackup) await copyFile(file, `${file}.bak`).catch(() => {});
  await rename(tmp, file);
}

function issues(e: z.ZodError): string {
  return e.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

export class ConfigStore {
  private current!: Config;
  private secrets!: Secrets;
  private listeners = new Set<(c: Config) => void>();
  private writing: Promise<void> = Promise.resolve();
  /** Set when load() migrated an older install; main.ts logs it. */
  migratedFrom: string | null = null;

  constructor(private dir: string) {}

  get configFile() {
    return join(this.dir, "config.json");
  }
  get secretsFile() {
    return join(this.dir, "secrets.json");
  }

  async load(legacyEnv: LegacyEnv = {}): Promise<Config> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    this.secrets = await this.loadSecrets();

    const raw = await readJson(this.configFile);
    if (raw === undefined) {
      // First start, or an install from before config.json existed (settings.json + env file).
      const legacySettings = await readJson(join(this.dir, "settings.json")).catch(() => undefined);
      const migrated = migrateLegacy(legacySettings, legacyEnv);
      if (migrated) {
        this.current = ConfigZ.parse(migrated.config);
        if (migrated.secrets.plexToken) this.secrets.plexToken = migrated.secrets.plexToken;
        if (migrated.secrets.espnWatchApiKey) this.secrets.espnWatchApiKey = migrated.secrets.espnWatchApiKey;
        await writeJsonAtomic(this.secretsFile, this.secrets, false);
        this.migratedFrom = migrated.from;
      } else {
        this.current = defaultConfig(Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York");
      }
      await writeJsonAtomic(this.configFile, this.current, false);
      return this.current;
    }

    const version = (raw as { version?: unknown })?.version;
    if (typeof version === "number" && version > CONFIG_VERSION) {
      throw new ConfigError(`${this.configFile} is from a newer Sports Remote (config version ${version}; this one reads ${CONFIG_VERSION}). Upgrade, or restore ${this.configFile}.bak.`);
    }
    const parsed = ConfigZ.safeParse(raw);
    if (!parsed.success) throw new ConfigError(`${this.configFile} doesn't validate: ${issues(parsed.error)}. Fix it or restore ${this.configFile}.bak.`);
    this.current = parsed.data;
    return this.current;
  }

  private async loadSecrets(): Promise<Secrets> {
    const raw = await readJson(this.secretsFile);
    if (raw === undefined) {
      const fresh: Secrets = {};
      await writeJsonAtomic(this.secretsFile, fresh, false);
      return fresh;
    }
    const parsed = SecretsZ.safeParse(raw);
    if (!parsed.success) throw new ConfigError(`${this.secretsFile} doesn't validate: ${issues(parsed.error)}.`);
    return parsed.data;
  }

  get(): Config {
    return this.current;
  }

  getSecrets(): Readonly<Secrets> {
    return this.secrets;
  }

  onChange(fn: (c: Config) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Apply a change, validate the whole result, then write. Writes are serialized. Throws ZodError on bad input. */
  async update(change: (draft: Config) => Config | void): Promise<Config> {
    const draft = structuredClone(this.current);
    const next = ConfigZ.parse(change(draft) ?? draft);
    const write = this.writing.then(() => writeJsonAtomic(this.configFile, next));
    this.writing = write.catch(() => {});
    await write;
    this.current = next;
    for (const fn of this.listeners) fn(next);
    return next;
  }

  async updateSecrets(change: Partial<Secrets>): Promise<void> {
    const merged: Record<string, unknown> = { ...this.secrets, ...change };
    for (const [k, v] of Object.entries(change)) if (v === undefined) delete merged[k];
    const next = SecretsZ.parse(merged);
    await writeJsonAtomic(this.secretsFile, next, false);
    this.secrets = next;
  }
}
