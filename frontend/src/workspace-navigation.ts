const sectionSlugs = {
  Overview: "overview",
  Students: "students",
  Lessons: "lessons",
  Calendar: "calendar",
  Tasks: "tasks",
  Materials: "materials",
  Homework: "homework",
  Assignments: "assignments",
  Flashcards: "flashcards",
  Activity: "activity",
  Connections: "connections",
} as const;

export type WorkspaceSection = keyof typeof sectionSlugs;

export function readSection(search: string): WorkspaceSection {
  const slug = new URLSearchParams(search).get("section");
  const entries = Object.entries(sectionSlugs) as [WorkspaceSection, string][];
  return entries.find(([, value]) => value === slug)?.[0] ?? "Overview";
}

export function sectionHref(section: WorkspaceSection) {
  return section === "Overview" ? "/" : `/?section=${sectionSlugs[section]}`;
}

