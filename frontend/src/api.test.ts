import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request, setTokenProvider } from "./api";
afterEach(() => vi.unstubAllGlobals());
describe("HTTP contract", () => {
  it("sends auth, mutation preconditions and a stable replay key", async () => {
    setTokenProvider(async () => "access");
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ revision: 3 }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetcher);
    await request("/tasks/id", {
      method: "PATCH",
      body: { status: "done" },
      revision: 2,
      key: "same-key",
    });
    const options = fetcher.mock.calls[0][1];
    expect(options.headers).toMatchObject({
      Authorization: "Bearer access",
      "If-Match": '"2"',
      "Idempotency-Key": "same-key",
    });
    expect(JSON.parse(options.body)).toEqual({ status: "done" });
  });
  it("keeps assignment calls separate from tutor bearer credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    await request("/attempt", {
      public: true,
      method: "PATCH",
      csrf: "csrf",
      revision: 1,
      key: "key",
      body: { answers: [] },
    });
    expect(fetcher.mock.calls[0][0]).toBe("/public/v1/attempt");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(fetcher.mock.calls[0][1].headers["X-CSRF-Token"]).toBe("csrf");
  });
  it("retains machine-readable revision conflict", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "revision_conflict", message: "Draft changed" },
          }),
          { status: 409 },
        ),
      ),
    );
    await expect(request("/attempt", { public: true })).rejects.toMatchObject({
      status: 409,
      code: "revision_conflict",
      message: "Draft changed",
    } satisfies Partial<ApiError>);
  });
});
it("reuses the idempotency key after an uncertain transport failure", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("network failed"))
    .mockResolvedValueOnce(new Response("{}"));
  vi.stubGlobal("fetch", fetcher);
  const options = {
    public: true,
    method: "PATCH",
    revision: 5,
    body: { answers: [{ question_id: "q", value: "draft" }] },
  };
  await expect(request("/attempt", options)).rejects.toThrow("network failed");
  await request("/attempt", options);
  expect(fetcher.mock.calls[0][1].headers["Idempotency-Key"]).toEqual(
    fetcher.mock.calls[1][1].headers["Idempotency-Key"],
  );
});
