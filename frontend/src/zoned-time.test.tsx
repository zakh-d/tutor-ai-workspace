import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { describeDue } from "./overview-data";
import { RecordSummary } from "./record-display";
import { generationWindow } from "./student-schedules";
import { effectiveStudentTimezone } from "./student-timezones";
import { DateTimeField, TeacherTimezone, TimezoneField, ZonedTime, timezoneChoices } from "./time-fields";
import { endTimeError, localDateTime, resolveDateTime, wallTimeChoices } from "./zoned-time";

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
  expect(ambiguous).not.toContain("Student ·");
  const explicit = input("2026-10-25T02:30:00+01:00");
  expect(explicit).toContain("Teacher · ");
  expect(explicit).toContain("Europe/Warsaw");
  expect(explicit).toContain("Student · ");
  expect(explicit).toContain("America/New_York");
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
      <ZonedTime value="2026-11-23T22:30:00Z" studentZone="Asia/Tokyo" locale="en-US" />
    </TeacherTimezone.Provider>,
  );
  expect(markup).toContain("Teacher · Nov 23, 2026 · 23:30");
  expect(markup).toContain("Europe/Warsaw");
  expect(markup).toContain("Student · Nov 24, 2026 · 07:30");
  expect(markup).toContain("Asia/Tokyo");
  expect(markup).toContain("Nov 23, 2026");
  expect(markup).toContain("Nov 24, 2026");
  expect(markup.match(/dateTime="2026-11-23T22:30:00Z"/g)).toHaveLength(2);
});


it("uses 24-hour time including midnight and prints the shared date once", () => {
  const markup = renderToStaticMarkup(
    <TeacherTimezone.Provider value="UTC">
      <ZonedTime value="2026-11-23T00:05:00Z" studentZone="Asia/Tokyo" locale="en-US" />
    </TeacherTimezone.Provider>,
  );
  expect(markup).toContain("Teacher · Nov 23, 2026 · 00:05");
  expect(markup).toContain("Student · 09:05");
  expect(markup.match(/Nov 23, 2026/g)).toHaveLength(1);
  expect(markup).not.toMatch(/GMT|AM|PM/);
});

it("supports city search, canonical choices, and saved IANA aliases with a native selector", () => {
  expect(timezoneChoices("new york", "")).toEqual(["America/New_York"]);
  expect(timezoneChoices("europe/warsaw", "US/Eastern")).toEqual(["US/Eastern", "Europe/Warsaw"]);
  expect(timezoneChoices("PST", "")).toEqual(["America/Los_Angeles"]);
  expect(timezoneChoices("nowhere here", "")).toEqual([]);
  const markup = renderToStaticMarkup(<TimezoneField label="Teacher timezone"
    value="US/Eastern" onChange={() => {}} required />);
  expect(markup).toContain("Search teacher timezone");
  expect(markup).toContain("<select");
  expect(markup).toContain('value="US/Eastern" selected=""');
  expect(markup).toContain('required=""');
  expect(markup).toContain('class="required-mark"');
  expect(markup).not.toContain("datalist");
});

it("exposes required, 24-hour, and invalid timing fields to the browser", () => {
  const markup = renderToStaticMarkup(<DateTimeField required label="Start" value="2026-03-29T02:30"
    inputZone="Europe/Warsaw" onChange={() => {}} />);
  expect(markup.match(/required=""/g)).toHaveLength(2);
  expect(markup.match(/class="required-mark"/g)).toHaveLength(2);
  expect(markup).toContain('placeholder="HH:MM"');
  expect(markup).toContain('aria-invalid="true"');
  expect(markup).toContain("This local time does not exist");
  expect(endTimeError("2026-10-25T02:30:00+02:00", "2026-10-25T02:15:00+01:00", "Europe/Warsaw")).toBeUndefined();
  expect(endTimeError("2026-10-25T02:30:00+01:00", "2026-10-25T02:30:00+02:00", "Europe/Warsaw")).toBe("The end must follow the start.");
});
