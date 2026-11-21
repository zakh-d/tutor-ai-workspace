import { request, type Page, type RecordData } from "./api";
import { plainDateInZone } from "./zoned-time";

const statusNames: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
};

export function formatStatus(status: unknown) {
  if (typeof status !== "string" || !status) return "";
  return statusNames[status] ?? status.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function dateValue(value: unknown): Date | undefined {
  if (typeof value !== "string") return;
  const date = new Date(value);
  if (Number.isFinite(date.getTime())) return date;
}

export function describeDue(value: unknown, now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const due = dateValue(value);
  if (!due) return { text: "No due date", overdue: false };
  const overdue = due < now;
  const relative = plainDateInZone(due, timeZone) === plainDateInZone(now, timeZone)
    ? "today"
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone }).format(due);
  return { text: `${overdue ? "Overdue" : "Due"} ${relative}`, overdue };
}

export function selectOpenTasks(pages: Page[]): Page {
  const sorted = pages.flatMap((page) => page.items)
    .filter((task) => !task.archived_at && (task.status === "todo" || task.status === "in_progress"))
    .sort((a: RecordData, b: RecordData) => {
      const left = dateValue(a.due_at)?.getTime() ?? Infinity;
      const right = dateValue(b.due_at)?.getTime() ?? Infinity;
      if (left === right) return a.id.localeCompare(b.id);
      return left < right ? -1 : 1;
    });
  return {
    items: sorted,
    next_cursor: pages.find((page) => page.next_cursor)?.next_cursor ?? null,
  };
}

export function loadLessonPlans() {
  return request<Page>("/lessons?archived=false&status=planned&limit=5");
}

export async function loadOpenTasks() {
  const pages = await Promise.all(
    ["todo", "in_progress"].map((status) =>
      request<Page>(`/tasks?archived=false&status=${status}&limit=100`),
    ),
  );
  return selectOpenTasks(pages);
}
