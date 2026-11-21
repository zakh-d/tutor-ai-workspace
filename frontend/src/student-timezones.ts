import { useContext, useEffect, useState } from "react";
import { request, type RecordData } from "./api";
import { TeacherTimezone } from "./time-fields";
import { isTimeZone } from "./zoned-time";

function reference(record: Record<string, unknown>) {
  if (typeof record.student_id === "string" && record.student_id) return `students/${record.student_id}`;
  if (typeof record.lesson_id === "string" && record.lesson_id) return `lessons/${record.lesson_id}`;
  return "";
}

async function loadStudent(key: string) {
  const { data } = await request<{ data: RecordData }>(`/${key}`);
  if (key.startsWith("students/")) return data;
  if (typeof data.student_id !== "string") return undefined;
  return (await request<{ data: RecordData }>(`/students/${data.student_id}`)).data;
}

export function useStudentTimezones(records: Record<string, unknown>[]) {
  const teacherZone = useContext(TeacherTimezone);
  const keys = [...new Set(records.map(reference).filter(Boolean))].sort().join(",");
  const [result, setResult] = useState(new Map<string, RecordData | undefined>());
  useEffect(() => {
    if (!keys) return;
    let active = true;
    Promise.allSettled(keys.split(",").map(async key => [key, await loadStudent(key)] as const))
      .then(results => {
        if (active) setResult(new Map(results.flatMap(result => result.status === "fulfilled" ? [result.value] : [])));
      });
    return () => { active = false; };
  }, [keys]);
  return {
    student: (record: Record<string, unknown>) => result.get(reference(record)),
    timezone: (record: Record<string, unknown>) => effectiveStudentTimezone(result.get(reference(record)), teacherZone),
  };
}

export function effectiveStudentTimezone(student: RecordData | undefined, teacherZone: string): string | undefined {
  if (!student) return undefined;
  return typeof student.timezone === "string" && isTimeZone(student.timezone) ? student.timezone : teacherZone;
}
