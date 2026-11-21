import { createContext, useContext, useId } from "react";
import { displayTimeValue, formatZonedInstant, isDateOnly, isTimeZone, localDateTime, wallTimeChoices } from "./zoned-time";

export const TeacherTimezone = createContext("UTC");

const timezoneNames = ["UTC", ...(Intl.supportedValuesOf?.("timeZone") ?? [])];

export function TimezoneField({ label, value, onChange, placeholder, required = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const options = useId();
  return (
    <label>
      {label}
      <input list={options} value={value} onChange={event => onChange(event.target.value)}
        placeholder={placeholder} required={required} spellCheck={false} />
      <datalist id={options}>
        {timezoneNames.map(zone => <option key={zone} value={zone} />)}
      </datalist>
      {value && !isTimeZone(value) && <small>Choose an IANA timezone, such as Europe/Warsaw.</small>}
    </label>
  );
}

export function ZonedTime({ value, studentZone, studentOnly = false }: {
  value: unknown;
  studentZone?: string;
  studentOnly?: boolean;
}) {
  const teacherZone = useContext(TeacherTimezone);
  const instant = displayTimeValue(value);
  if (!instant) return null;
  if (isDateOnly(instant)) return <time dateTime={instant}>{instant} · All day</time>;
  const zone = studentOnly ? (studentZone || Intl.DateTimeFormat().resolvedOptions().timeZone) : teacherZone;
  return (
    <span className="zoned-time">
      <time dateTime={instant}>{studentOnly ? "Your time" : "Teacher time"} ({zone}): {formatZonedInstant(instant, zone)}</time>
      {!studentOnly && studentZone &&
        <time dateTime={instant}>Student time ({studentZone}): {formatZonedInstant(instant, studentZone)}</time>}
    </span>
  );
}

export function DateTimeField({ label, value, onChange, inputZone, studentZone, required = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputZone?: string;
  studentZone?: string;
  required?: boolean;
}) {
  const teacherZone = useContext(TeacherTimezone);
  const zone = inputZone ?? teacherZone;
  const validZone = isTimeZone(zone);
  const local = validZone ? localDateTime(value, zone) : "";
  const savedInstant = displayTimeValue(value);
  const choices = wallTimeChoices(local, zone);
  const selectedChoice = choices.find(choice => Math.floor(Date.parse(choice.instant) / 60000) === Math.floor(Date.parse(savedInstant) / 60000));
  const preview = savedInstant || (choices.length === 1 ? choices[0].instant : "");
  return (
    <div className="time-field">
      <label>
        {label} ({zone === teacherZone ? "teacher time, " : ""}{zone})
        <input type="datetime-local" value={local} onChange={event => onChange(event.target.value)}
          required={required} disabled={!validZone} />
      </label>
      {choices.length > 1 && (
        <label>
          UTC offset for {label.toLowerCase()}
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
      {!!local && !savedInstant && !choices.length &&
        <small className="error">This local time does not exist. Choose another time.</small>}
      {preview && <small><ZonedTime value={preview} studentZone={studentZone} /></small>}
    </div>
  );
}
