import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { describeDue } from "./overview-data";
import { RecordSummary } from "./record-display";
import { generationWindow } from "./student-schedules";
import { effectiveStudentTimezone } from "./student-timezones";
import { DateTimeField, TeacherTimezone, ZonedTime } from "./time-fields";
import { localDateTime, resolveDateTime, wallTimeChoices } from "./zoned-time";

it("round-trips explicit instants using the configured timezone, including fractional-hour offsets", () => {
  expect(wallTimeChoices("2026-11-23T14:00", "Europe/Warsaw")).toEqual([
    { instant: "2026-11-23T14:00:00+01:00", offset: "+01:00" },
  ]);
  const supplied = "2026-11-23T13:00:45.123456Z";
  const zoned = resolveDateTime(supplied, "Asia/Kathmandu");
  expect(zoned).toBe("2026-11-23T18:45:45.123456+05:45");
  expect(Date.parse(zoned!)).toBe(Date.parse(supplied));
  expect(localDateTime(supplied, "Asia/Kathmandu")).toBe("2026-11-23T18:45");
  expect(() => resolveDateTime("2026-02-30T14:00", "Europe/Warsaw")).toThrow();
  expect(resolveDateTime("", "Europe/Warsaw")).toBeNull();
});

it("rejects nonexistent times and requires an explicit DST occurrence", () => {
  expect(wallTimeChoices("2026-03-29T02:30", "Europe/Warsaw")).toEqual([]);
  expect(() => resolveDateTime("2026-03-29T02:30", "Europe/Warsaw")).toThrow("does not exist");
  expect(wallTimeChoices("2026-10-25T02:30", "Europe/Warsaw")).toEqual([
    { instant: "2026-10-25T02:30:00+02:00", offset: "+02:00" },
    { instant: "2026-10-25T02:30:00+01:00", offset: "+01:00" },
  ]);
  expect(() => resolveDateTime("2026-10-25T02:30", "Europe/Warsaw")).toThrow("occurs twice");
  expect(resolveDateTime("2026-10-25T02:30:00+01:00", "Europe/Warsaw")).toBe("2026-10-25T02:30:00+01:00");
});

it("renders offset choices and both labelled clock times", () => {
  const input = (value: string) => renderToStaticMarkup(
    <TeacherTimezone.Provider value="Europe/Warsaw">
      <DateTimeField label="Start" value={value} onChange={() => {}} studentZone="America/New_York" />
    </TeacherTimezone.Provider>,
  );
  expect(input("2026-03-29T02:30")).toContain("This local time does not exist");
  const ambiguous = input("2026-10-25T02:30");
  expect(ambiguous).toContain("UTC+02:00");
  expect(ambiguous).toContain("UTC+01:00");
  expect(ambiguous).not.toContain("Student time");
  const explicit = input("2026-10-25T02:30:00+01:00");
  expect(explicit).toContain("Teacher time (Europe/Warsaw)");
  expect(explicit).toContain("Student time (America/New_York)");
  expect(explicit).toContain('value="2026-10-25T02:30:00+01:00" selected=""');
});

it("preserves Google all-day dates and prefers the Google projection for linked lessons", () => {
  const allDay = renderToStaticMarkup(<ZonedTime value={{ date: "2026-01-01" }} studentZone="America/New_York" />);
  expect(allDay).toContain('dateTime="2026-01-01"');
  expect(allDay).toContain("All day");
  expect(allDay).not.toContain("New_York");
  const lesson = renderToStaticMarkup(<RecordSummary studentZone="America/New_York" record={{
    id: "lesson", revision: 2, calendar_event_id: "event",
    starts_at: "2026-11-23T13:00:00Z", calendar_start: { dateTime: "2026-11-24T13:00:00Z" },
  }} />);
  expect(lesson).toContain("2026-11-24T13:00:00Z");
  expect(lesson).not.toContain("2026-11-23T13:00:00Z");
});

it("uses teacher timezone for due-day comparisons and known students without a timezone", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  expect(describeDue("2026-11-22T23:30:00Z", now, "Europe/Warsaw").text).toBe("Overdue today");
  expect(describeDue("2026-11-22T23:30:00Z", now, "UTC").text).not.toBe("Overdue today");
  expect(effectiveStudentTimezone({ id: "student", revision: 1 }, "Europe/Warsaw")).toBe("Europe/Warsaw");
  expect(effectiveStudentTimezone({ id: "student", revision: 1, timezone: "America/New_York" }, "UTC")).toBe("America/New_York");
  expect(effectiveStudentTimezone(undefined, "UTC")).toBeUndefined();
});

it("restricts schedule generation to an inclusive 93 calendar days and the current rule end", () => {
  expect(generationWindow({ start_date: "2026-03-27", end_date: null })).toEqual({
    minimum: "2026-03-27", maximum: "2026-06-27",
  });
  expect(generationWindow({ start_date: "2026-03-27", end_date: "2026-05-01", generated_through: "2026-04-30" })).toEqual({
    minimum: "2026-05-01", maximum: "2026-05-01",
  });
  expect(generationWindow({ start_date: "2026-05-01", end_date: null, generated_through: "2026-04-01" }).minimum).toBe("2026-05-01");
});

it("shows both named timezones and different dates when a lesson crosses local midnight", () => {
  const markup = renderToStaticMarkup(
    <TeacherTimezone.Provider value="Europe/Warsaw">
      <ZonedTime value="2026-11-23T22:30:00Z" studentZone="Asia/Tokyo" />
    </TeacherTimezone.Provider>,
  );
  expect(markup).toContain("Teacher time (Europe/Warsaw)");
  expect(markup).toContain("Student time (Asia/Tokyo)");
  expect(markup).toContain("Nov 23, 2026");
  expect(markup).toContain("Nov 24, 2026");
  expect(markup.match(/dateTime="2026-11-23T22:30:00Z"/g)).toHaveLength(2);
});
