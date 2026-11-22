import { afterEach, expect, it, vi } from "vitest";
import { describeDue, formatStatus, loadLessonPlans, selectLessonPlans, selectOpenTasks } from "./overview-data";
import type { RecordData } from "./api";

afterEach(() => vi.unstubAllGlobals());
function task(id: string, status: string, due_at?: string): RecordData {
  return { id, revision: 1, status, due_at };
}

it("sorts open tasks by due instant across status pages and keeps undated tasks last", () => {
  const result = selectOpenTasks([
    {
      items: [
        task("no-due", "todo"),
        task("future", "todo", "2026-11-23T12:00:00Z"),
        { ...task("archived", "todo", "2026-11-20T12:00:00Z"), archived_at: "2026-11-19T12:00:00Z" },
      ],
      next_cursor: null,
    },
    {
      items: [
        task("soon", "in_progress", "2026-11-22T12:00:00Z"),
        task("overdue", "in_progress", "2026-11-21T12:00:00Z"),
        task("done", "done", "2026-11-20T12:00:00Z"),
      ],
      next_cursor: "more-tasks",
    },
  ]);

  expect(result.items.map(({ id }) => id)).toEqual(["overdue", "soon", "future", "no-due"]);
  expect(result.next_cursor).toBe("more-tasks");
});

it("labels elapsed due instants even on the same day", () => {
  const now = new Date(2026, 10, 21, 12);
  expect(describeDue(new Date(2026, 10, 21, 9).toISOString(), now)).toEqual({
    text: "Overdue today",
    overdue: true,
  });
  expect(describeDue(new Date(2026, 10, 21, 15).toISOString(), now).text).toBe("Due today");
  expect(describeDue(undefined, now).text).toBe("No due date");
  expect(formatStatus("in_progress")).toBe("In progress");
});

it("sorts planned lessons by actual instants and leaves unscheduled plans last", () => {
  const lessons = [
    { id: "unscheduled", revision: 1 },
    { id: "native", revision: 1, starts_at: "2026-11-23T00:10:00+01:00" },
    { id: "all-day", revision: 1, calendar_event_id: "all-day", calendar_start: { date: "2026-11-23" } },
    { id: "google", revision: 1, starts_at: "2026-10-01T12:00:00Z", calendar_event_id: "event",
      calendar_start: { dateTime: "2026-11-23T00:30:00Z" } },
    { id: "same-teacher-day", revision: 1, starts_at: "2026-11-22T23:45:00Z" },
  ];
  const now = new Date("2026-11-22T23:30:00Z");
  expect(selectLessonPlans(lessons, "All", now, "Europe/Warsaw").map(({ id }) => id))
    .toEqual(["all-day", "native", "same-teacher-day", "google", "unscheduled"]);
  expect(selectLessonPlans(lessons, "Today", now, "Europe/Warsaw").map(({ id }) => id))
    .toEqual(["all-day", "native", "same-teacher-day", "google"]);
  expect(selectLessonPlans(lessons, "Today", now, "UTC").map(({ id }) => id))
    .toEqual(["native", "same-teacher-day"]);
});

it("uses the next teacher calendar date across a spring transition", () => {
  const lessons = [
    { id: "tomorrow", revision: 1, starts_at: "2026-03-29T21:45Z" },
    { id: "day-after", revision: 1, starts_at: "2026-03-29T22:15Z" },
  ];
  expect(selectLessonPlans(lessons, "Tomorrow", new Date("2026-03-28T22:45Z"), "Europe/Warsaw")
    .map(({ id }) => id)).toEqual(["tomorrow"]);
});

it("follows all API pages before selecting today's lessons", async () => {
  const first = { id: "first", revision: 1, starts_at: "2026-11-24T12:00:00Z" };
  const second = { id: "second", revision: 1, starts_at: "2026-11-23T12:00:00Z" };
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ items: [first], next_cursor: "more+" }))
    .mockResolvedValueOnce(Response.json({ items: [second], next_cursor: null }));
  vi.stubGlobal("fetch", fetcher);
  const page = await loadLessonPlans();
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    "/api/v1/lessons?archived=false&status=planned&limit=100",
    "/api/v1/lessons?archived=false&status=planned&limit=100&cursor=more%2B",
  ]);
  expect(selectLessonPlans(page.items, "Today", new Date("2026-11-23T12:00:00Z"), "UTC")).toEqual([second]);
});
