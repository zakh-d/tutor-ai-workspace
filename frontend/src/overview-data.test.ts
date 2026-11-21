import { expect, it } from "vitest";
import { describeDue, formatStatus, selectOpenTasks } from "./overview-data";
import type { RecordData } from "./api";

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
