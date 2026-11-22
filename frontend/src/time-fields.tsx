import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { displayTimeValue, formatZonedDate, isDateOnly, isTimeZone, localDateTime, wallTimeChoices } from "./zoned-time";

export const TeacherTimezone = createContext("UTC");

const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const timezoneNames = [...new Set(["UTC", browserTimezone, ...(Intl.supportedValuesOf?.("timeZone") ?? [])])]
  .filter(isTimeZone);
const normalizeZone = (value: string) => value.toLowerCase().replace(/[ _]+/g, "_");
const validClockPattern = "(?:[01][0-9]|2[0-3]):[0-5][0-9]";

export function RequiredMark() {
  return <span className="required-mark" aria-hidden="true"> *</span>;
}

export function timezoneChoices(query: string, current: string) {
  const search = normalizeZone(query.trim());
  const matches = timezoneNames.filter(zone => normalizeZone(zone).includes(search));
  const candidate = query.trim();
  const canonical = isTimeZone(candidate) ? Intl.DateTimeFormat("en-GB", { timeZone: candidate }).resolvedOptions().timeZone : "";
  return [...new Set([current, canonical, ...matches])].filter(Boolean);
}

export function TimezoneField({ label, value, onChange, placeholder, required = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const id = useId();
  const select = useRef<HTMLSelectElement>(null);
  const [query, setQuery] = useState("");
  const matches = timezoneChoices(query, "");
  const options = [...new Set([value, ...matches])].filter(Boolean);
  return (
    <div className="timezone-field">
      <label className="timezone-search">
        <span>Search {label.toLowerCase()}</span>
        <input type="search" value={query} placeholder="City or IANA timezone" autoComplete="off"
          spellCheck={false} onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              select.current?.focus();
            }
          }} />
      </label>
      <label htmlFor={id}><span>{label}{required && <RequiredMark />}</span></label>
      <select ref={select} id={id} value={value} onChange={event => { onChange(event.target.value); setQuery(""); }}
        required={required} aria-describedby={id + "-results"}>
        <option value="">{placeholder ?? "Choose a timezone"}</option>
        {options.map(zone => <option key={zone} value={zone}>{zone}</option>)}
      </select>
      <small id={id + "-results"} role="status">
        {query.trim() && (matches.length > 0
          ? "Choose a matching timezone." : "No matching timezones. Try another city or use a full IANA timezone.")}
      </small>
    </div>
  );
}

export function ZonedTime({ value, studentZone, studentOnly = false, locale }: {
  value: unknown;
  studentZone?: string;
  studentOnly?: boolean;
  locale?: string;
}) {
  const teacherZone = useContext(TeacherTimezone);
  const instant = displayTimeValue(value);
  if (!instant) return null;
  if (isDateOnly(instant)) return <time dateTime={instant}>{instant} · All day</time>;
  const zone = studentOnly ? studentZone || browserTimezone : teacherZone;
  const primaryDate = localDateTime(instant, zone).slice(0, 10);
  const time = (name: string, timeZone: string, showDate: boolean) => (
    <time dateTime={instant}>
      {name} · {showDate && <>{formatZonedDate(instant, timeZone, locale)} · </>}
      {localDateTime(instant, timeZone).slice(11)} <span className="time-zone-name">{timeZone}</span>
    </time>
  );
  return (
    <span className="zoned-time">
      {time(studentOnly ? "Your time" : "Teacher", zone, true)}
      {!studentOnly && studentZone && time("Student", studentZone, localDateTime(instant, studentZone).slice(0, 10) !== primaryDate)}
    </span>
  );
}

export function TimeInput({ value, onChange, required, disabled, describedBy, error }: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  describedBy?: string;
  error?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.setCustomValidity(error ?? ""), [error]);
  return <input ref={input} type="text" pattern={validClockPattern} placeholder="HH:MM" maxLength={5}
    title="24-hour time in HH:MM format, for example 18:30" autoComplete="off" value={value}
    onChange={event => onChange(event.target.value)} disabled={disabled} required={required}
    aria-invalid={error ? true : undefined} aria-describedby={describedBy} />;
}

export function DateTimeField({ label, value, onChange, inputZone, studentZone, required = false, rangeError }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputZone?: string;
  studentZone?: string;
  required?: boolean;
  rangeError?: string;
}) {
  const teacherZone = useContext(TeacherTimezone);
  const hint = useId();
  const zone = inputZone ?? teacherZone;
  const validZone = isTimeZone(zone);
  const local = validZone ? localDateTime(value, zone) : "";
  const [day = "", clock = ""] = local.split("T", 2);
  const savedInstant = displayTimeValue(value);
  const choices = wallTimeChoices(local, zone);
  const selectedChoice = choices.find(choice => Math.floor(Date.parse(choice.instant) / 60000) === Math.floor(Date.parse(savedInstant) / 60000));
  const preview = savedInstant || (choices.length === 1 ? choices[0].instant : "");
  const error = rangeError || (day && clock.match(new RegExp(`^${validClockPattern}$`)) && !savedInstant && !choices.length
    ? "This local time does not exist. Choose another time." : "");
  const update = (date: string, time: string) => onChange(date || time ? `${date}T${time}` : "");
  return (
    <fieldset className="time-field" disabled={!validZone}>
      <legend>{label} <span className="time-zone-name">{zone}</span></legend>
      <div className="time-inputs">
        <label>
          <span>Date{(required || Boolean(clock)) && <RequiredMark />}</span>
          <input type="date" value={day} onChange={event => update(event.target.value, clock)}
            required={required || Boolean(clock)} aria-describedby={hint} />
        </label>
        <label>
          <span>Time (24-hour){(required || Boolean(day)) && <RequiredMark />}</span>
          <TimeInput value={clock} onChange={time => update(day, time)} required={required || Boolean(day)}
            error={error} describedBy={hint} />
        </label>
      </div>
      {choices.length > 1 && (
        <label>
          <span>UTC offset for {label.toLowerCase()}<RequiredMark /></span>
          <select value={selectedChoice?.instant ?? ""}
            onChange={event => onChange(event.target.value || local)} required>
            <option value="">Choose which occurrence</option>
            {choices.map(choice => (
              <option key={choice.instant} value={choice.instant}>
                UTC{choice.offset}
              </option>
            ))}
          </select>
        </label>
      )}
      <small id={hint} className={error ? "error" : undefined}>
        {error || (!validZone && "Choose a timezone to enter a date and time.")}
      </small>
      {preview && <small><ZonedTime value={preview} studentZone={studentZone} /></small>}
    </fieldset>
  );
}
