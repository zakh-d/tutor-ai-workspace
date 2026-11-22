const localPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const instantPattern = /(?:Z|[+-]\d{2}:\d{2})$/i;
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function localFormatter(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function isTimeZone(value: string) {
  if (!value || /^[+-]/.test(value)) return false;
  try {
    localFormatter(value);
    return true;
  } catch {
    return false;
  }
}

function zonedParts(instant: number, timeZone: string) {
  const parts = Object.fromEntries(localFormatter(timeZone).formatToParts(instant).map(({type, value}) => [type, value]));
  return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function localDateTime(value: unknown, timeZone: string) {
  if (typeof value !== "string") return "";
  if (!instantPattern.test(value)) return value;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? zonedParts(instant, timeZone).slice(0, 16) : "";
}

function offsetAt(instant: number, timeZone: string) {
  return Date.parse(zonedParts(instant, timeZone) + "Z") - Math.floor(instant / 1000) * 1000;
}

function offsetLabel(offset: number) {
  const minutes = Math.abs(offset) / 60000;
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  return (offset < 0 ? "-" : "+") + hours + ":" + String(minutes % 60).padStart(2, "0");
}

type TimeChoice = { instant: string; offset: string };

export function wallTimeChoices(local: string, timeZone: string): TimeChoice[] {
  if (!localPattern.test(local) || !isTimeZone(timeZone)) return [];
  const wall = local.length === 16 ? local + ":00" : local;
  const asUtc = Date.parse(wall + "Z");
  if (!Number.isFinite(asUtc) || zonedParts(asUtc, "UTC") !== wall) return [];
  // Sampling both sides of the requested wall time discovers the offsets around a DST transition.
  const offsets = new Set([-36, -24, -12, 0, 12, 24, 36].map(hours => offsetAt(asUtc + hours * 3600000, timeZone)));
  return [...offsets].sort((a, b) => b - a)
    .filter(offset => offset % 60000 === 0 && zonedParts(asUtc - offset, timeZone) === wall)
    .map(offset => ({ instant: wall + offsetLabel(offset), offset: offsetLabel(offset) }));
}

export function resolveDateTime(value: string, timeZone: string): string | null {
  if (!value) return null;
  if (!isTimeZone(timeZone)) throw new Error("Choose a valid IANA timezone.");
  if (instantPattern.test(value) && Number.isFinite(Date.parse(value))) {
    const instant = Date.parse(value);
    const offset = offsetAt(instant, timeZone);
    if (offset % 60000 !== 0) throw new Error("This historical timezone offset cannot be represented in the date and time field.");
    const wall = zonedParts(instant, timeZone);
    const fraction = value.match(/\.\d+(?=Z|[+-]\d{2}:\d{2}$)/i)?.[0] ?? "";
    return wall + fraction + offsetLabel(offset);
  }
  const choices = wallTimeChoices(value, timeZone);
  if (!choices.length) throw new Error(`This local time does not exist in ${timeZone}. Choose another time.`);
  if (choices.length > 1) throw new Error(`This local time occurs twice in ${timeZone}. Select its UTC offset.`);
  return choices[0].instant;
}

export function endTimeError(start: string, end: string, zone: string) {
  try {
    const startsAt = resolveDateTime(start, zone);
    const endsAt = resolveDateTime(end, zone);
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) return "The end must follow the start.";
  } catch {
    // The individual fields report invalid or ambiguous times.
  }
}

export function formatZonedDate(value: string, timeZone: string, locale?: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    year: "numeric", month: "short", day: "numeric",
  }).format(new Date(value));
}

export function shiftDate(day: string, count: number) {
  const date = new Date(day + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function displayTimeValue(value: unknown): string {
  if (value && typeof value === "object") {
    const calendarValue = value as { dateTime?: unknown; date?: unknown };
    return displayTimeValue(calendarValue.dateTime ?? calendarValue.date);
  }
  return typeof value === "string" && (dateOnlyPattern.test(value) ||
    (instantPattern.test(value) && Number.isFinite(Date.parse(value)))) ? value : "";
}

export function isDateOnly(value: string) {
  return dateOnlyPattern.test(value);
}

export function plainDateInZone(value: Date, zone: string) {
  return zonedParts(value.getTime(), zone).slice(0, 10);
}
