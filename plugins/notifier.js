import { basename, join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { spawn, exec } from "child_process";

const CONFIG_DIR = join(homedir(), ".config", "opencode");

const DEBOUNCE = 1000;
const lastSound = {};
const lastNotify = {};
const subagentSessions = new Set();
const sessionTitles = new Map();

const config = {
  sound: true,
  notification: false,
  showProjectName: true,
  notificationSystem: "ghostty",
  events: {
    permission: { sound: true, notification: true },
    complete: { sound: true, notification: true },
    subagent_complete: { sound: false, notification: false },
    error: { sound: true, notification: true },
    question: { sound: true, notification: true },
    user_cancelled: { sound: false, notification: false },
    plan_exit: { sound: true, notification: true },
    session_started: { sound: true, notification: false },
    user_message: { sound: true, notification: false },
    client_connected: { sound: true, notification: false },
  },
  messages: {
    permission: "Session needs permission: {sessionTitle}",
    complete: "Session has finished: {sessionTitle}",
    subagent_complete: "Subagent task completed: {sessionTitle}",
    error: "Session encountered an error: {sessionTitle}",
    question: "Session has a question: {sessionTitle}",
    user_cancelled: "Session was cancelled by user: {sessionTitle}",
    plan_exit: "Plan ready for review: {sessionTitle}",
    session_started: "Session started: {sessionTitle}",
    user_message: "User sent a message: {sessionTitle}",
    client_connected: "OpenCode connected",
  },
  sounds: {
    permission: join(CONFIG_DIR, "assets/sounds/permission.flac"),
    complete: join(CONFIG_DIR, "assets/sounds/complete.flac"),
    subagent_complete: join(CONFIG_DIR, "assets/sounds/subagent_complete.flac"),
    error: join(CONFIG_DIR, "assets/sounds/error.flac"),
    question: join(CONFIG_DIR, "assets/sounds/question.flac"),
    user_cancelled: join(CONFIG_DIR, "assets/sounds/user_canceled.flac"),
    plan_exit: join(CONFIG_DIR, "assets/sounds/question.flac"),
    session_started: join(CONFIG_DIR, "assets/sounds/session_started.flac"),
    user_message: join(CONFIG_DIR, "assets/sounds/user_message.flac"),
    client_connected: join(CONFIG_DIR, "assets/sounds/client_connected.flac"),
  },
  volumes: {
    permission: 1,
    complete: 1,
    subagent_complete: 1,
    error: 1,
    question: 1,
    user_cancelled: 1,
    plan_exit: 1,
    session_started: 1,
    user_message: 1,
    client_connected: 1,
  },
};

function sanitizeGhosttyField(value) {
  return value.replace(/[;\x07\x1b\n\r]/g, "");
}

function formatGhosttySequence(title, message) {
  const t = sanitizeGhosttyField(title);
  const m = sanitizeGhosttyField(message);
  const payload = `\x1B]9;${t}: ${m}\x07`;
  if (process.env.TMUX) {
    return `\x1BPtmux;\x1B${payload}\x1B\\`;
  }
  return payload;
}

function notify(title, message) {
  const now = Date.now();
  if (lastNotify[message] && now - lastNotify[message] < DEBOUNCE) return;
  lastNotify[message] = now;

  if (config.notificationSystem === "ghostty") {
    process.stdout.write(formatGhosttySequence(title, message));
    return;
  }

  const escapedMessage = message.replace(/"/g, '\\"');
  const escapedTitle = title.replace(/"/g, '\\"');
  exec(`osascript -e 'display notification "${escapedMessage}" with title "${escapedTitle}"'`);
}

function play(eventType) {
  const now = Date.now();
  if (lastSound[eventType] && now - lastSound[eventType] < DEBOUNCE) return;
  lastSound[eventType] = now;

  const customPath = config.sounds[eventType];
  const soundPath = customPath && existsSync(customPath) ? customPath : null;
  if (!soundPath) return;

  let volume = config.volumes[eventType];
  if (typeof volume !== "number" || !Number.isFinite(volume)) volume = 1;
  if (volume < 0) volume = 0;
  if (volume > 1) volume = 1;

  spawn("afplay", ["-v", `${volume}`, soundPath], { stdio: "ignore" }).on("error", () => {});
}

function extractAgentName(title) {
  if (!title) return "";
  const m = String(title).match(/\s*\(@([^\s)]+)\s+subagent\)\s*$/);
  return m ? m[1] : "";
}

function interpolateMessage(template, sessionTitle, projectName, agentName) {
  return template
    .replaceAll("{sessionTitle}", sessionTitle || "")
    .replaceAll("{projectName}", projectName || "")
    .replaceAll("{agentName}", agentName || "")
    .replace(/\s*[:\-|]\s*$/, "")
    .trim()
    .replace(/\s{2,}/g, " ");
}

function fire(eventType, projectName, sessionTitle) {
  const ec = config.events[eventType];
  if (!ec) return;

  const agentName = extractAgentName(sessionTitle);
  const message = interpolateMessage(
    config.messages[eventType],
    config.showSessionTitle ? sessionTitle : "",
    projectName,
    agentName,
  );

  if (ec.notification) {
    const title = config.showProjectName && projectName ? `OpenCode (${projectName})` : "OpenCode";
    notify(title, message);
  }

  if (ec.sound) {
    play(eventType);
  }
}

function sid(event) {
  return event.properties?.sessionID || null;
}

export const NotifierPlugin = ({ directory }) => {
  const projectName = directory ? basename(directory) : null;

  setTimeout(() => {
    fire("client_connected", projectName, null);
  }, 100);

  return {
    event: async ({ event }) => {
      if (event.type === "session.created") {
        const info = event.properties?.info;
        if (info?.id && info?.title) sessionTitles.set(info.id, info.title);
        if (info?.parentID && info?.id) {
          subagentSessions.add(info.id);
        } else if (info?.id) {
          fire("session_started", projectName, info.title);
        }
        return;
      }

      if (event.type === "session.deleted") {
        const id = event.properties?.info?.id;
        if (id) {
          subagentSessions.delete(id);
          sessionTitles.delete(id);
        }
        return;
      }

      if (event.type === "session.idle") {
        const id = sid(event);
        if (id) {
          const isSub = subagentSessions.has(id);
          fire(
            isSub ? "subagent_complete" : "complete",
            projectName,
            sessionTitles.get(id) || null,
          );
        } else {
          fire("complete", projectName, null);
        }
        return;
      }

      if (event.type === "session.error") {
        const id = sid(event);
        const errName = event.properties?.error?.name;
        const et = errName === "MessageAbortedError" ? "user_cancelled" : "error";
        fire(et, projectName, id ? sessionTitles.get(id) || null : null);
        return;
      }

      if (event.type === "permission.asked") {
        const id = sid(event);
        fire("permission", projectName, id ? sessionTitles.get(id) || null : null);
        return;
      }

      if (event.type === "message.updated") {
        const info = event.properties?.info;
        if (info?.role === "user") {
          const id = info?.sessionID;
          if (!id || !subagentSessions.has(id)) {
            fire("user_message", projectName, id ? sessionTitles.get(id) || null : null);
          }
        }
        return;
      }
    },

    "permission.ask": async () => {
      fire("permission", projectName, null);
    },

    "tool.execute.before": async (input) => {
      if (input.tool === "question") {
        fire("question", projectName, null);
      }
      if (input.tool === "plan_exit") {
        fire("plan_exit", projectName, null);
      }
    },
  };
};

export default NotifierPlugin;
