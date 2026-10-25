import { describe, expect, it } from "vitest";
import { loadConfig } from "../server/config";

describe("loadConfig (bootstrap environment)", () => {
  it("starts with no environment at all", () => {
    expect(loadConfig({})).toMatchObject({
      port: 8787, bind: "0.0.0.0", adbBin: "adb", trustedProxies: [], allowedHosts: [], publicUrl: null, sessionDays: 30,
      dataDir: "/var/lib/sports-remote", ignored: [],
    });
  });
  it("validates port, trusted proxies, session lifetime and public URL", () => {
    expect(() => loadConfig({ PORT: "70000" })).toThrow(/PORT/);
    expect(() => loadConfig({ TRUSTED_PROXIES: "10.0.0.0/33" })).toThrow(/TRUSTED_PROXIES/);
    expect(() => loadConfig({ TRUSTED_PROXIES: "proxy.lan" })).toThrow(/TRUSTED_PROXIES/);
    expect(loadConfig({ TRUSTED_PROXIES: "loopback, 172.16.0.0/12,::1" }).trustedProxies).toEqual(["loopback", "172.16.0.0/12", "::1"]);
    expect(() => loadConfig({ SESSION_DAYS: "0" })).toThrow(/SESSION_DAYS/);
    expect(() => loadConfig({ PUBLIC_URL: "games.example.com" })).toThrow(/PUBLIC_URL/);
    expect(loadConfig({ PUBLIC_URL: "https://games.example.com/" }).publicUrl).toBe("https://games.example.com");
  });
  it("passes v1 variables to the config store's one-time import", () => {
    expect(loadConfig({ FIRETV_HOST: "192.168.1.50", PLEX_TOKEN: "t" }).legacy).toMatchObject({ FIRETV_HOST: "192.168.1.50", PLEX_TOKEN: "t" });
  });
  it("remote key methods", () => {
    expect(loadConfig({}).keyBackends).toEqual(["evdev", "cmd", "input"]);
    expect(loadConfig({ KEY_METHODS: "cmd,input" }).keyBackends).toEqual(["cmd", "input"]);
    expect(loadConfig({ KEY_METHODS: "oneshot" }).keyBackends).toEqual([]);
    expect(() => loadConfig({ KEY_METHODS: "sendevent" })).toThrow(/KEY_METHODS/);
  });
  it("notes old auth variables that no longer do anything", () => {
    expect(loadConfig({ APP_PASSCODE: "1234", LAN_BIND: "192.168.1.25" }).ignored).toEqual(["APP_PASSCODE", "LAN_BIND"]);
  });
});
