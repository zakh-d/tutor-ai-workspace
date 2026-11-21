import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ init: vi.fn().mockResolvedValue(false) }));
vi.mock("keycloak-js", () => ({ default: class { init = mocks.init; } }));
afterEach(() => vi.unstubAllGlobals());
it("uses the exact registered root callback including its trailing slash", async () => {
  vi.stubGlobal("location", { origin: "https://app.localhost" });
  const { authRedirectUri, initializeAuth } = await import("./auth");
  expect(authRedirectUri).toBe("https://app.localhost/");
  await initializeAuth();
  expect(mocks.init).toHaveBeenCalledWith(expect.objectContaining({ redirectUri: authRedirectUri, pkceMethod: "S256", onLoad: "check-sso" }));
});

it("checks the existing Keycloak session with the same exact callback when resuming", async () => {
  vi.resetModules();
  vi.stubGlobal("location", { origin: "https://app.localhost" });
  const { authRedirectUri, initializeAuth } = await import("./auth");
  await initializeAuth();
  expect(mocks.init).toHaveBeenLastCalledWith(expect.objectContaining({
    redirectUri: authRedirectUri,
    onLoad: "check-sso",
    pkceMethod: "S256",
  }));
});

it("shares initialization across concurrent callers", async () => {
  vi.resetModules();
  mocks.init.mockClear();
  vi.stubGlobal("location", { origin: "https://app.localhost" });
  const { initializeAuth } = await import("./auth");
  await Promise.all([initializeAuth(), initializeAuth()]);
  expect(mocks.init).toHaveBeenCalledTimes(1);
});
