import { describe, expect, it } from "vitest";
import { canEditAssignment, firstUnansweredQuestion, requireAssignmentIdentity, requiresAnswer } from "./public-assignment";

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

it("allows incomplete required answers when saving a draft and identifies the first missing answer on submission", () => {
  const optional = { id: "optional", required: false };
  const written = { id: "written", required: true };
  const single = { id: "single", required: true };
  const multiple = { id: "multiple", required: true };
  const file = { id: "file", required: true };
  const questions = [optional, written, single, multiple, file];
  expect(firstUnansweredQuestion(questions, {}, false)).toBe(-1);
  expect(firstUnansweredQuestion(questions, { written: "  " }, true)).toBe(1);
  expect(firstUnansweredQuestion(questions, { written: "Answer" }, true)).toBe(2);
  const choices = { written: "Answer", single: "a", multiple: [] };
  expect(firstUnansweredQuestion(questions, choices, true)).toBe(3);
  expect(firstUnansweredQuestion(questions, { ...choices, multiple: ["a"], file: [] }, true)).toBe(4);
  expect(firstUnansweredQuestion(questions, { ...choices, multiple: ["a"], file: ["upload"] }, true)).toBe(-1);
  expect(requiresAnswer(optional, {})).toBe(false);
});
