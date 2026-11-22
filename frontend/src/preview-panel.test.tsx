import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PreviewPanel } from "./App";
import { overviewPreviewLimit, previewRecords, selectLessonPlans } from "./overview-data";
import type { RecordData } from "./api";

vi.mock("./auth", () => ({ initializeAuth: vi.fn(), keycloak: {}, authRedirectUri: "/" }));

const rows: RecordData[] = Array.from({ length: 30 }, (_, index) => ({
  id: `lesson-${index}`, revision: 1, student_id: `student-${index}`,
  starts_at: `2026-11-23T${String(23 - Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}:00Z`,
}));

function render(limit?: number) {
  return renderToStaticMarkup(<PreviewPanel title="Lesson plans" destination="Lessons"
    preview={{ state: { page: { items: rows, next_cursor: null } }, retry: () => {} }}
    follow={() => {}} emptyTitle="No lessons" emptyAction={() => {}} emptyActionLabel="Plan"
    limit={limit}>{record => <span>{record.id}</span>}</PreviewPanel>);
}

it("renders all nonempty lesson rows when no limit is supplied", () => {
  const markup = render();
  expect(markup.match(/<li>/g)).toHaveLength(rows.length);
  expect(markup).toContain("lesson-29");
});

it("renders only the same bounded subset used for student lookups", () => {
  const sorted = selectLessonPlans(rows, "All", new Date("2026-11-23T12:00Z"), "UTC");
  const visible = previewRecords(sorted, overviewPreviewLimit);
  expect(visible).toHaveLength(5);
  expect(visible[0].id).toBe("lesson-28");
  expect(new Set(visible.map(record => record.student_id)).size).toBe(5);
  const markup = render(overviewPreviewLimit);
  expect(markup.match(/<li>/g)).toHaveLength(visible.length);
  expect(markup).toContain("Preview · showing 5 records");
  expect(markup).not.toContain("lesson-5</span>");
});
