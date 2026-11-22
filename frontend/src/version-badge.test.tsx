import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { VersionBadge } from "./version-badge";

afterEach(() => vi.unstubAllEnvs());

it("displays the release supplied by the build", () => {
  vi.stubEnv("VITE_APP_VERSION", "v1.2.3");
  expect(renderToStaticMarkup(<VersionBadge />)).toContain('aria-label="Application version v1.2.3">v1.2.3</span>');
});

it("identifies unversioned local builds as development", () => {
  vi.stubEnv("VITE_APP_VERSION", "");
  expect(renderToStaticMarkup(<VersionBadge />)).toContain('Application version dev');
});
