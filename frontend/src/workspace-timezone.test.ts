import { afterEach, expect, it, vi } from "vitest";
import { loadWorkspace } from "./workspace-timezone";

afterEach(() => vi.unstubAllGlobals());

const workspace = { id: "workspace", revision: 1, timezone: "UTC", timezone_configured: false };

it("sets the browser timezone once using the current workspace revision", async () => {
  const saved = { ...workspace, revision: 2, timezone: "Europe/Warsaw", timezone_configured: true };
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ data: workspace }))
    .mockResolvedValueOnce(Response.json({ data: saved }));
  vi.stubGlobal("fetch", fetcher);
  await expect(loadWorkspace("Europe/Warsaw")).resolves.toEqual(saved);
  expect(fetcher.mock.calls[1]).toEqual(["/api/v1/workspace", expect.objectContaining({
    method: "PATCH",
    headers: expect.objectContaining({ "If-Match": '"1"', "Idempotency-Key": expect.any(String) }),
    body: JSON.stringify({ timezone: "Europe/Warsaw" }),
  })]);
});

it("preserves explicit UTC and older responses without provenance", async () => {
  const explicit = { ...workspace, timezone_configured: true };
  const legacy = { ...workspace, timezone_configured: undefined };
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ data: explicit }))
    .mockResolvedValueOnce(Response.json({ data: legacy }));
  vi.stubGlobal("fetch", fetcher);
  await expect(loadWorkspace("Europe/Warsaw")).resolves.toEqual(explicit);
  await expect(loadWorkspace("America/New_York")).resolves.toEqual(legacy);
  expect(fetcher.mock.calls.map(([, options]) => options.method)).toEqual(["GET", "GET"]);
});

it("re-reads after a concurrent edit and retains the winning timezone", async () => {
  const winner = { ...workspace, revision: 2, timezone_configured: true, timezone: "Asia/Tokyo" };
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ data: workspace }))
    .mockResolvedValueOnce(Response.json({ error: { code: "revision_conflict" } }, { status: 409 }))
    .mockResolvedValueOnce(Response.json({ data: winner }));
  vi.stubGlobal("fetch", fetcher);
  await expect(loadWorkspace("Europe/Warsaw")).resolves.toEqual(winner);
  expect(fetcher.mock.calls.map(([, options]) => options.method)).toEqual(["GET", "PATCH", "GET"]);
});

it("surfaces a failed initialization and replays the uncertain write on retry", async () => {
  const saved = { ...workspace, timezone_configured: true, revision: 2 };
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ data: workspace }))
    .mockRejectedValueOnce(new TypeError("connection interrupted"))
    .mockResolvedValueOnce(Response.json({ data: workspace }))
    .mockResolvedValueOnce(Response.json({ data: saved }));
  vi.stubGlobal("fetch", fetcher);
  await expect(loadWorkspace("UTC")).rejects.toThrow("connection interrupted");
  await expect(loadWorkspace("UTC")).resolves.toEqual(saved);
  expect(fetcher.mock.calls[1][1].headers["Idempotency-Key"]).toBe(fetcher.mock.calls[3][1].headers["Idempotency-Key"]);
  expect(fetcher.mock.calls[3][1].body).toBe(JSON.stringify({ timezone: "UTC" }));
});
