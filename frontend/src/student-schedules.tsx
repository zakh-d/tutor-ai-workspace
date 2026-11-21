import { useContext, useEffect, useState, type FormEvent } from "react";
import { request, type Page, type RecordData } from "./api";
import { formatStatus } from "./overview-data";
import { effectiveStudentTimezone } from "./student-timezones";
import { TeacherTimezone, TimezoneField, ZonedTime } from "./time-fields";
import { isTimeZone, plainDateInZone, wallTimeChoices } from "./zoned-time";

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type Rule = {
  student_id: string;
  title: string;
  weekdays: number[];
  local_start: string;
  timezone: string;
  duration_minutes: number;
  start_date: string;
  end_date: string | null;
};

type Schedule = RecordData & Rule & { generated_through?: string; archived_at?: string };
type Generation = Schedule & {
  generated_lessons: RecordData[];
  skipped_occurrences: { occurrence_date: string; reason: "ambiguous_local_time" | "nonexistent_local_time" }[];
};

export function addCalendarDays(day: string, count: number) {
  const date = new Date(day + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function generationWindow(schedule: Pick<Schedule, "start_date" | "end_date" | "generated_through">) {
  const minimum = schedule.generated_through && schedule.generated_through >= schedule.start_date
    ? addCalendarDays(schedule.generated_through, 1) : schedule.start_date;
  const limit = addCalendarDays(minimum, 92);
  const maximum = schedule.end_date && schedule.end_date < limit ? schedule.end_date : limit;
  return { minimum, maximum };
}

function firstOccurrence(rule: Rule) {
  if (!rule.start_date || !rule.weekdays.length || !rule.local_start || !isTimeZone(rule.timezone)) return;
  const start = new Date(rule.start_date + "T00:00:00Z");
  if (!Number.isFinite(start.getTime())) return;
  const weekday = (start.getUTCDay() + 6) % 7;
  const offset = Math.min(...rule.weekdays.map(day => (day - weekday + 7) % 7));
  const date = addCalendarDays(rule.start_date, offset);
  return rule.end_date && date > rule.end_date ? undefined : date;
}

export function StudentSchedules({ student, openLesson }: { student: RecordData; openLesson: (lesson: RecordData) => void }) {
  const teacherZone = useContext(TeacherTimezone);
  const studentZone = effectiveStudentTimezone(student, teacherZone);
  const [rows, setRows] = useState<Schedule[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [editing, setEditing] = useState<Schedule | "new">();
  const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  async function load(next?: string) {
    const params = new URLSearchParams({ student_id: student.id, archived: String(archived) });
    if (next) params.set("cursor", next);
    return request<{ items: Schedule[]; next_cursor: string | null }>(`/schedules?${params}`);
  }
  useEffect(() => {
    let active = true;
    load().then(page => {
      if (active) {
        setRows(page.items);
        setCursor(page.next_cursor);
      }
    }).catch(error => {
      if (active) setError(error.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [student.id, archived, attempt]);

  function reload() {
    setRows([]);
    setCursor(null);
    setLoading(true);
    setError("");
    setAttempt(attempt => attempt + 1);
  }

  return (
    <section className="review">
      <h3>Recurring lesson schedules</h3>
      {!student.archived_at && !editing && !archived &&
        <button type="button" className="secondary" onClick={() => setEditing("new")}>Add recurring schedule</button>}
      {editing && <ScheduleForm key={editing === "new" ? "new" : editing.id}
        student={student} existing={editing === "new" ? undefined : editing} studentZone={studentZone}
        close={() => setEditing(undefined)} saved={schedule => {
          if (editing === "new") reload();
          else setRows(current => current.map(row => row.id === schedule.id ? schedule : row));
          setEditing(undefined);
        }} />}
      <label className="archive-filter">
        <input type="checkbox" checked={archived} disabled={loading} onChange={event => {
          setArchived(event.target.checked);
          setEditing(undefined);
          reload();
        }} /> Show archived schedules
      </label>
      {error && <p className="error" role="alert">{error} <button type="button" className="text-button" onClick={reload}>Retry</button></p>}
      {loading && <p role="status">Loading schedules…</p>}
      {!loading && !error && !rows.length && <p>No {archived ? "archived" : "active"} recurring schedules.</p>}
      {rows.map(schedule => <ScheduleCard key={schedule.id} schedule={schedule} studentZone={studentZone}
        disabled={Boolean(student.archived_at)} edit={() => setEditing(schedule)} openLesson={openLesson}
        saved={updated => {
          if (Boolean(updated.archived_at) !== archived) setRows(current => current.filter(row => row.id !== updated.id));
          else setRows(current => current.map(row => row.id === updated.id ? updated : row));
          setEditing(current => current && current !== "new" && current.id === updated.id ? undefined : current);
        }} />)}
      {cursor && <button type="button" className="secondary" disabled={loading} onClick={async () => {
        setLoading(true);
        setError("");
        try {
          const page = await load(cursor);
          setRows(current => [...current, ...page.items]);
          setCursor(page.next_cursor);
        } catch (error) {
          setError((error as Error).message);
        } finally {
          setLoading(false);
        }
      }}>Load more schedules</button>}
    </section>
  );
}

function ScheduleForm({ student, existing, studentZone, saved, close }: {
  student: RecordData;
  existing?: Schedule;
  studentZone?: string;
  saved: (schedule: Schedule) => void;
  close: () => void;
}) {
  const teacherZone = useContext(TeacherTimezone);
  const [draft, setDraft] = useState<Rule>(() => ({
    student_id: student.id,
    title: existing?.title ?? "",
    weekdays: existing?.weekdays ?? [],
    local_start: existing?.local_start ?? "",
    timezone: existing?.timezone ?? teacherZone,
    duration_minutes: existing?.duration_minutes ?? 60,
    start_date: existing?.start_date ?? plainDateInZone(new Date(), teacherZone),
    end_date: existing?.end_date ?? null,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const previewDate = firstOccurrence(draft);
  const preview = previewDate ? wallTimeChoices(`${previewDate}T${draft.local_start}`, draft.timezone) : [];
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (!draft.weekdays.length) throw new Error("Choose at least one weekday.");
      if (!isTimeZone(draft.timezone)) throw new Error("Choose a valid IANA timezone.");
      const { data } = await request<{ data: Schedule }>(existing ? `/schedules/${existing.id}` : "/schedules", {
        method: existing ? "PATCH" : "POST", revision: existing?.revision, body: draft,
      });
      saved(data);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="question-editor schedule-form" onSubmit={submit}>
      <h4>{existing ? "Edit recurring schedule" : "New recurring schedule"}</h4>
      <fieldset className="editor-fields" disabled={busy}>
        <label>Lesson title
          <input required maxLength={200} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
        </label>
        <fieldset className="schedule-weekdays">
          <legend>Weekdays</legend>
          {weekdays.map((day, index) => <label key={day} className="archive-filter">
            <input type="checkbox" checked={draft.weekdays.includes(index)} onChange={event => setDraft({
              ...draft, weekdays: event.target.checked ? [...draft.weekdays, index].sort((a, b) => a - b) :
                draft.weekdays.filter(value => value !== index),
            })} /> {day}
          </label>)}
        </fieldset>
        <TimezoneField label="Schedule timezone" value={draft.timezone} onChange={timezone => setDraft({ ...draft, timezone })} required />
        <label>Start time ({draft.timezone || "schedule timezone"})
          <input type="time" required value={draft.local_start} onChange={event => setDraft({ ...draft, local_start: event.target.value })} />
        </label>
        <label>Duration in minutes
          <input type="number" min={1} max={1440} required value={draft.duration_minutes || ""}
            onChange={event => setDraft({ ...draft, duration_minutes: Number(event.target.value) })} />
        </label>
        <label>First date
          <input type="date" required value={draft.start_date} onChange={event => setDraft({ ...draft, start_date: event.target.value })} />
        </label>
        <label>Last date (optional)
          <input type="date" min={draft.start_date} value={draft.end_date ?? ""} onChange={event => setDraft({ ...draft, end_date: event.target.value || null })} />
        </label>
        {previewDate && <p>
          First matching date ({previewDate})
          {preview.length === 1 ? <ZonedTime value={preview[0].instant} studentZone={studentZone} /> :
            <small> The local start time is ambiguous or unavailable. Generation skips this date.</small>}
        </p>}
        {existing?.generated_through && <p>Changes apply to newly generated lessons after {existing.generated_through}.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit">{busy ? "Saving…" : "Save schedule"}</button>
          <button type="button" className="secondary" onClick={close}>Cancel</button>
        </div>
      </fieldset>
    </form>
  );
}

function ScheduleCard({ schedule, studentZone, disabled, edit, openLesson, saved }: {
  schedule: Schedule;
  studentZone?: string;
  disabled: boolean;
  edit: () => void;
  openLesson: (lesson: RecordData) => void;
  saved: (schedule: Schedule) => void;
}) {
  const { minimum, maximum } = generationWindow(schedule);
  const [through, setThrough] = useState("");
  const [generation, setGeneration] = useState<Generation>();
  const [showLessons, setShowLessons] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canGenerate = !schedule.archived_at && !disabled && minimum <= maximum;
  const previewDate = firstOccurrence({ ...schedule, start_date: minimum });
  const preview = previewDate ? wallTimeChoices(`${previewDate}T${schedule.local_start}`, schedule.timezone) : [];


  async function generate(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { data } = await request<{ data: Generation }>(`/schedules/${schedule.id}/generate`, {
        method: "POST", revision: schedule.revision, body: { through_date: through },
      });
      setGeneration(data);
      const { generated_lessons: _lessons, skipped_occurrences: _skipped, ...updated } = data;
      saved(updated);
      setThrough("");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="question-editor schedule-card">
      <h4>{schedule.title}</h4>
      <p>{schedule.weekdays.map(day => weekdays[day]).join(", ")} · {schedule.local_start} ({schedule.timezone}) · {schedule.duration_minutes} min</p>
      <p>From {schedule.start_date}{schedule.end_date ? ` through ${schedule.end_date}` : ""}</p>
      {canGenerate && previewDate && <p>Next matching date ({previewDate})
        {preview.length === 1 ? <ZonedTime value={preview[0].instant} studentZone={studentZone} /> :
          <small> The local start time is ambiguous or unavailable. Generation skips this date.</small>}
      </p>}
      {schedule.generated_through && <p>Generated through {schedule.generated_through}</p>}
      {canGenerate && <form onSubmit={generate}>
        <label>Generate through
          <input type="date" min={minimum} max={maximum} required value={through} disabled={busy}
            onChange={event => setThrough(event.target.value)} />
          <small>{minimum === maximum ? minimum : `${minimum} to ${maximum}`}</small>
        </label>
        <button type="submit" className="secondary" disabled={busy}>Generate lessons</button>
      </form>}
      {generation && <div className="schedule-result">
        <p role="status">{generation.generated_lessons.length} {generation.generated_lessons.length === 1 ? "lesson" : "lessons"} generated.</p>
        {generation.skipped_occurrences.length > 0 && <ul>{generation.skipped_occurrences.map(skip =>
          <li key={skip.occurrence_date}>{skip.occurrence_date} · {skip.reason === "ambiguous_local_time" ?
            "Local start time occurs twice." : "Local start time does not exist."}</li>)}</ul>}
        {!showLessons && generation.generated_lessons.map(lesson =>
          <Occurrence key={lesson.id} lesson={lesson} studentZone={studentZone} openLesson={openLesson} />)}
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        {schedule.generated_through && <button type="button" className="secondary" aria-expanded={showLessons}
          onClick={() => setShowLessons(!showLessons)}>{showLessons ? "Hide generated lessons" : "View generated lessons"}</button>}
        {!disabled && !schedule.archived_at && <button type="button" className="secondary" onClick={edit} disabled={busy}>Edit schedule</button>}
        {!disabled && <button type="button" className="secondary" disabled={busy} onClick={async () => {
          if (!schedule.archived_at && !confirm("Archive this schedule? Existing lessons remain available.")) return;
          setError("");
          setBusy(true);
          try {
            const { data } = await request<{ data: Schedule }>(`/schedules/${schedule.id}/${schedule.archived_at ? "restore" : "archive"}`, {
              method: "POST", revision: schedule.revision, body: {},
            });
            saved(data);
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}>{schedule.archived_at ? "Restore schedule" : "Archive schedule"}</button>}
      </div>
      {showLessons && <ScheduleOccurrences key={schedule.revision} scheduleId={schedule.id} studentZone={studentZone} openLesson={openLesson} />}
    </article>
  );
}

function ScheduleOccurrences({ scheduleId, studentZone, openLesson }: {
  scheduleId: string;
  studentZone?: string;
  openLesson: (lesson: RecordData) => void;
}) {
  const [page, setPage] = useState<Page>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function load(cursor?: string) {
    const params = new URLSearchParams({ schedule_id: scheduleId });
    if (cursor) params.set("cursor", cursor);
    return request<Page>(`/lessons?${params}`);
  }
  useEffect(() => {
    let active = true;
    load().then(result => { if (active) setPage(result); })
      .catch(error => { if (active) setError(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [scheduleId]);

  return <div className="schedule-result">
    {loading && <p role="status">Loading generated lessons…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {page && !page.items.length && <p>No generated lessons available.</p>}
    {page?.items.map(lesson => <Occurrence key={lesson.id} lesson={lesson} studentZone={studentZone} openLesson={openLesson} />)}
    {page?.next_cursor && <button type="button" className="secondary" disabled={loading} onClick={async () => {
      setLoading(true);
      setError("");
      try {
        const next = await load(page.next_cursor!);
        setPage({ items: [...page.items, ...next.items], next_cursor: next.next_cursor });
      } catch (error) {
        setError((error as Error).message);
      } finally {
        setLoading(false);
      }
    }}>Load more lessons</button>}
  </div>;
}

function Occurrence({ lesson, studentZone, openLesson }: {
  lesson: RecordData;
  studentZone?: string;
  openLesson: (lesson: RecordData) => void;
}) {
  return <div className="schedule-occurrence">
    <button type="button" className="text-button" onClick={() => openLesson(lesson)}>{String(lesson.title)}</button>
    <span className="badge">{formatStatus(lesson.status)}</span>
    <ZonedTime value={lesson.calendar_event_id ? lesson.calendar_start : lesson.starts_at} studentZone={studentZone} />
  </div>;
}
