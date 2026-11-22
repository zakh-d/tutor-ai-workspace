import { request, type Page, type RecordData } from "./api";
import { shiftDate, displayTimeValue, isDateOnly, plainDateInZone, wallTimeChoices } from "./zoned-time";

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

export function lessonStart(lesson: RecordData) {
  return lesson.calendar_event_id ? lesson.calendar_start : lesson.starts_at;
}

export const lessonDays = ["Today", "Tomorrow", "All"] as const;
export type LessonDay = (typeof lessonDays)[number];

export function selectLessonPlans(lessons: RecordData[], day: LessonDay, now: Date, teacherZone: string) {
  const today = plainDateInZone(now, teacherZone);
  const selectedDate = day === "Tomorrow" ? shiftDate(today, 1) : today;
  return lessons.map(lesson => {
    const value = displayTimeValue(lessonStart(lesson));
    const dateOnly = isDateOnly(value);
    const instant = dateOnly
      ? Date.parse(wallTimeChoices(value + "T00:00", teacherZone)[0]?.instant ?? value)
      : Date.parse(value);
    const date = dateOnly ? value : Number.isFinite(instant) ? plainDateInZone(new Date(instant), teacherZone) : "";
    return { lesson, instant: Number.isFinite(instant) ? instant : Infinity, date };
  })
    .filter(row => day === "All" || row.date === selectedDate)
    .sort((a, b) => a.instant === b.instant ? a.lesson.id.localeCompare(b.lesson.id) : a.instant - b.instant)
    .map(row => row.lesson);
}

export async function loadLessonPlans(): Promise<Page> {
  const lessons = new Map<string, RecordData>();
  const params = new URLSearchParams({ archived: "false", status: "planned", limit: "100" });
  let cursor: string | null;
  do {
    const page = await request<Page>(`/lessons?${params}`);
    for (const lesson of page.items) lessons.set(lesson.id, lesson);
    cursor = page.next_cursor;
    if (cursor) params.set("cursor", cursor);
  } while (cursor);
  return { items: [...lessons.values()], next_cursor: null };
}

export async function loadOpenTasks() {
  const pages = await Promise.all(
    ["todo", "in_progress"].map((status) =>
      request<Page>(`/tasks?archived=false&status=${status}&limit=100`),
    ),
  );
  return selectOpenTasks(pages);
}

export const overviewPreviewLimit = 5;

export function previewRecords<T>(records: T[], limit?: number): T[] {
  return limit === undefined ? records : records.slice(0, limit);
}
