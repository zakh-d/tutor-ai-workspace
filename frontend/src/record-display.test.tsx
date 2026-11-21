import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentPreview, RecordSummary, SubmissionAnswers, answerText, readableValue } from "./record-display";

it("shows useful record content while omitting empty values and transport metadata", () => {
  const html = renderToStaticMarkup(<RecordSummary record={{id: "private-uuid", revision: 4, created_at: "2026-01-01", updated_at: "2026-02-01", notes: null, description: "Practice fractions", contact: {email: "student@example.test"}, status: "in_progress"}} />);
  expect(html).toContain("Practice fractions");
  expect(html).toContain("student@example.test");
  expect(html).toContain("In progress");
  for (const hidden of ["private-uuid", "null", "Created", "Updated", "2026-01", "{", "revision"]) expect(html).not.toContain(hidden);
});
it("renders questions, choices, grading guidance and cards as teaching content", () => {
  const html = renderToStaticMarkup(<ContentPreview record={{id: "template", revision: 1, questions: [{id: "q", prompt: "Which fraction is one half?", type: "single_choice", points: 5, options: [{id: "o", text: "2/4"}], correct_option_id: "o"}], cards: [{term: "Half", definition: "One of two equal parts"}]}} />);
  expect(html).toContain("Which fraction is one half?");
  expect(html).toContain("2/4 (correct answer)");
  expect(html).toContain("One of two equal parts");
  expect(html).not.toContain("correct_option_id");
});
it("pairs the selected answer and available points with its prompt and readable choice", () => {
  const content = {questions: [{id: "q", prompt: "Choose a colour", type: "single_choice", points: 7, options: [{id: "blue-id", text: "Blue"}]}]};
  const html = renderToStaticMarkup(<SubmissionAnswers content={content} questionId="q" attempt={{id: "a", revision: 1, status: "submitted", answers: [{question_id: "q", value: "blue-id"}]}} />);
  expect(html).toContain("Choose a colour");
  expect(html).toContain("Available points: 7");
  expect(html).toContain("Blue");
  expect(html).not.toContain("blue-id");
  expect(html).not.toContain("question_id");
});
it("handles missing and structured values without displaying null or JSON", () => {
  expect(answerText(undefined)).toBe("No answer provided");
  expect(readableValue({message: "Conversion failed", internal_id: "secret"})).toBe("Conversion failed");
  expect(readableValue({internal_id: "secret"})).toBe("");
  expect(readableValue([null, "First", "Second"])).toBe("First, Second");
});
