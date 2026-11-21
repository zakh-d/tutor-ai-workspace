import { describe, expect, it } from "vitest";
import { canEditAssignment, requireAssignmentIdentity } from "./public-assignment";

describe("public assignment session safety", () => {
  it("rejects another assignment returned by a stale browser session before displaying it", () => {
    expect(() => requireAssignmentIdentity("requested-assignment", "cookie-assignment"))
      .toThrow("Reopen your tutor’s link");
  });

  it("accepts the requested assignment when resuming without a link fragment", () => {
    expect(() => requireAssignmentIdentity("requested-assignment", "requested-assignment"))
      .not.toThrow();
  });

  it("allows answers and submit controls only for an open draft", () => {
    expect(canEditAssignment("open", "draft")).toBe(true);
    expect(canEditAssignment("closed", "draft")).toBe(false);
    expect(canEditAssignment("open", "submitted")).toBe(false);
    expect(canEditAssignment("closed", "submitted")).toBe(false);
    expect(canEditAssignment("unknown", "draft")).toBe(false);
  });
});
