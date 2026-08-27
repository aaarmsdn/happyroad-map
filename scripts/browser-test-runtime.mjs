import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const chromePaths = [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].filter(Boolean);

export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

export async function waitFor(check, timeout = 15000) {
  const expires = Date.now() + timeout;
  let lastError;
  while (Date.now() < expires) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Browser test timed out.", { cause: lastError });
}

export async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  const rejectPending = reason => {
    const error = reason instanceof Error ? reason : new Error("CDP socket closed.");
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  socket.addEventListener("close", rejectPending);
  socket.addEventListener("error", rejectPending);
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (!message.id) {
      for (const listener of listeners.get(message.method) || []) listener(message.params);
      return;
    }
    if (!pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  });
  return {
    close: () => socket.close(),
    on(method, listener) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(listener);
    },
    notify(method, params = {}, sessionId) {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ id: ++nextId, method, params, ...(sessionId ? { sessionId } : {}) }));
    },
    call(method, params = {}, sessionId) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP call timed out: ${method}`));
        }, 5000);
        pending.set(id, {
          resolve: value => { clearTimeout(timeout); resolve(value); },
          reject: error => { clearTimeout(timeout); reject(error); }
        });
        try {
          socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        } catch (error) {
          pending.get(id)?.reject(error);
          pending.delete(id);
        }
      });
    }
  };
}

export async function stopProcess(child, tree = false) {
  if (child.exitCode !== null) return;
  if (tree && process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    await Promise.race([once(killer, "exit"), new Promise(resolve => setTimeout(resolve, 1000))]);
  } else child.kill();
  await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1000))]);
}

async function profileProcessIds(profile) {
  if (process.platform !== "win32") return [];
  const command = "$p=$env:HAPPYROAD_PROFILE; Get-CimInstance Win32_Process | Where-Object { @('chrome.exe','msedge.exe') -contains $_.Name -and $_.CommandLine -and $_.CommandLine.Replace('\\\"','').Contains(\"--user-data-dir=$p\") } | ForEach-Object { $_.ProcessId }";
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { env: { ...process.env, HAPPYROAD_PROFILE: profile } });
  return stdout.split(/\r?\n/).map(line => Number(line.trim())).filter(pid => Number.isInteger(pid) && pid > 0);
}

export async function stopProfileProcesses(profile) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pids = await profileProcessIds(profile);
    if (!pids.length) return;
    await Promise.allSettled(pids.map(pid => execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"])));
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const remaining = await profileProcessIds(profile);
  if (remaining.length) throw new Error(`Chrome test processes remain: ${remaining.join(", ")}`);
}
