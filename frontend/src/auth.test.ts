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

it("uses the deployment Keycloak build configuration with a same-origin callback", async () => {
  vi.resetModules();
  vi.stubEnv("VITE_KEYCLOAK_URL", "https://auth.zahk.tech");
  vi.stubEnv("VITE_KEYCLOAK_REALM", "tutor");
  vi.stubEnv("VITE_KEYCLOAK_CLIENT_ID", "tutor-web");
  vi.stubGlobal("location", { origin: "https://tutor.zahk.tech" });
  try {
    const { authConfig, authRedirectUri } = await import("./auth");
    expect(authConfig).toEqual({ url: "https://auth.zahk.tech", realm: "tutor", clientId: "tutor-web" });
    expect(authRedirectUri).toBe("https://tutor.zahk.tech/");
  } finally {
    vi.unstubAllEnvs();
  }
});
