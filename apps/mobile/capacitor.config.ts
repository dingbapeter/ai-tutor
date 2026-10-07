import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Dingba's app shell. It loads the live website inside a native app, so
 * every store build stays in step with the web app automatically: a
 * website deploy is an app update, with no review wait.
 *
 * Why this passes store review as a real app and not "just a website":
 * the shell declares and uses native microphone (hold-to-talk, conversation
 * mode), camera (homework photos), and home-screen presence with an offline
 * shell, and carries its own icons, splash and permission prompts.
 *
 * appId is the permanent identity in both stores; never change it after the
 * first release. The founder holds the signing keys; no AI does (RUNBOOK).
 */
const config: CapacitorConfig = {
  appId: "ai.dingba.app",
  appName: "Dingba",
  // A minimal local shell; the real app is served from server.url.
  webDir: "shell",
  server: {
    url: "https://dingba.ai",
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: "automatic",
  },
};

export default config;
