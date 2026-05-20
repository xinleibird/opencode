import { homedir, platform } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface SoundPack {
  sounds: Record<string, string>;
}

interface SoundConfig {
  enabled: boolean;
  volume: number;
  active_pack: string;
  packs: Record<string, SoundPack>;
}

function getSoundDir(): string {
  return join(homedir(), ".config", "opencode", "sounds");
}

function getSoundConfigPath(): string {
  return join(getSoundDir(), "config.json");
}

function loadSoundConfig(): SoundConfig | null {
  const configPath = getSoundConfigPath();

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content);
    return {
      enabled: parsed.enabled ?? true,
      volume: normalizeVolume(parsed.volume ?? 1),
      active_pack: parsed.active_pack ?? "default",
      packs: parsed.packs ?? {},
    };
  } catch {
    return null;
  }
}

function getSoundPath(soundKey: string, config: SoundConfig | null): string | null {
  if (!config) return null;

  if (!config.enabled) {
    return null;
  }

  const pack = config.packs[config.active_pack];
  if (!pack) {
    return null;
  }

  const soundFile = pack.sounds[soundKey];
  if (!soundFile) {
    return null;
  }

  const userSoundPath = join(getSoundDir(), config.active_pack, soundFile);
  if (existsSync(userSoundPath)) {
    return userSoundPath;
  }

  const pluginSoundPath = join(__dirname, "sounds", soundFile);
  if (existsSync(pluginSoundPath)) {
    return pluginSoundPath;
  }

  return null;
}

function normalizeVolume(volume: unknown): number {
  if (typeof volume !== "number" || !Number.isFinite(volume)) return 1;
  if (volume < 0) return 0;
  if (volume > 1) return 1;
  return volume;
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: "ignore",
      detached: false,
    });

    proc.on("error", (err: Error) => reject(err));
    proc.on("close", (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(`exit ${code}`));
    });
    setTimeout(() => reject(new Error("timeout")), 5000);
  });
}

async function playOnLinux(soundPath: string, volume: number): Promise<void> {
  const percentVolume = Math.round(volume * 100);
  const pulseVolume = Math.round(volume * 65536);

  const players = [
    { cmd: "paplay", args: [`--volume=${pulseVolume}`, soundPath] },
    { cmd: "aplay", args: [soundPath] },
    { cmd: "mpv", args: ["--no-video", "--no-terminal", `--volume=${percentVolume}`, soundPath] },
    {
      cmd: "ffplay",
      args: [
        "-nodisp",
        "-autoexit",
        "-loglevel",
        "quiet",
        "-volume",
        `${percentVolume}`,
        soundPath,
      ],
    },
  ];

  for (const player of players) {
    try {
      await runCommand(player.cmd, player.args);
      return;
    } catch {
      continue;
    }
  }
}

async function playOnMac(soundPath: string, volume: number): Promise<void> {
  await runCommand("afplay", ["-v", `${volume}`, soundPath]);
}

async function playOnWindows(soundPath: string): Promise<void> {
  const escapedPath = soundPath.replace(/'/g, "''");
  const script = `Add-Type -AssemblyName System.Core; $player = New-Object Media.SoundPlayer '${escapedPath}'; $player.Load(); $player.PlaySync()`;
  await runCommand("powershell", ["-c", script]);
}

async function playSound(soundPath: string | null, volume: number = 1): Promise<void> {
  if (!soundPath) return;

  const normalizedVolume = normalizeVolume(volume);
  const os = platform();

  try {
    switch (os) {
      case "darwin":
        await playOnMac(soundPath, normalizedVolume);
        break;
      case "linux":
        await playOnLinux(soundPath, normalizedVolume);
        break;
      case "win32":
        await playOnWindows(soundPath);
        break;
      default:
        break;
    }
  } catch {
    // silent fail
  }
}

async function play(soundKey: string, volume?: number): Promise<void> {
  const config = loadSoundConfig();
  if (!config) return;
  const path = getSoundPath(soundKey, config);
  if (!path) return;
  await playSound(path, volume ?? config.volume);
}

interface SoundPluginEvent {
  type: string;
  properties?: {
    info?: { role?: string };
    status?: { type?: string };
  };
}

interface SoundPluginHook {
  event: (context: { event: SoundPluginEvent }) => Promise<void>;
}

export const SoundPlugin = (): SoundPluginHook => {
  return {
    event: async ({ event }) => {
      try {
        if (event.type === "message.updated") {
          const info = event.properties?.info;
          if (info?.role === "user") {
            await play("tick");
          }
          return;
        }

        if (event.type === "permission.asked") {
          await play("permission");
          return;
        }
        if (event.type === "question.asked") {
          await play("permission");
          return;
        }

        if (event.type === "session.idle") {
          await play("complete");
          return;
        }

        if (event.type === "session.status") {
          const status = event.properties?.status?.type;
          if (status === "idle") {
            await play("stop");
          }
          return;
        }

        if (event.type === "session.error") {
          await play("notification");
          return;
        }
        if (event.type === "session.created") {
          await play("start");
          return;
        }
      } catch {
        // silent fail
      }
    },
  };
};

export default SoundPlugin;
