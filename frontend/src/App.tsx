import { useEffect, useState, type FormEvent } from "react";
import {
  BookOpen,
  Users,
  CalendarDays,
  CheckSquare,
  Files,
  GraduationCap,
  Layers,
  History,
  ArrowUpRight,
  Plus,
  Search,
  LogOut,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { request, type RecordData, type Page } from "./api";
import { initializeAuth, keycloak, authRedirectUri } from "./auth";
import { canEditAssignment, requireAssignmentIdentity } from "./public-assignment";
const sections = [
  ["Overview", BookOpen],
  ["Students", Users],
  ["Lessons", GraduationCap],
  ["Materials", Files],
  ["Tasks", CheckSquare],
  ["Homework", BookOpen],
  ["Assignments", CheckSquare],
  ["Calendar", CalendarDays],
  ["Flashcards", Layers],
  ["Activity", History],
  ["Connections", Sparkles],
] as const;
const routes: Record<string, string> = {
  Students: "students",
  Lessons: "lessons",
  Materials: "materials",
  Tasks: "tasks",
  Homework: "homework-templates",
  Flashcards: "flashcard-sets",
  Activity: "history",
  Assignments: "assignments",
  Calendar: "calendar/events",
};
const fields: Record<string, string[]> = {
  Students: ["display_name", "contact", "subject", "level", "goals", "notes"],
  Lessons: ["title", "student_id", "plan", "notes", "status", "material_ids"],
  Materials: ["title", "description", "tags", "student_ids", "lesson_ids"],
  Tasks: [
    "title",
    "description",
    "due_at",
    "status",
    "student_id",
    "lesson_id",
  ],
  Homework: ["title", "instructions", "questions", "source_refs"],
  Flashcards: ["title", "cards", "source_refs", "lesson_id"],
};
const label = (s: string) =>
  s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const text = (v: unknown) =>
  v==null?"":typeof v === "string" ? v : JSON.stringify(v);
const initial = (section: string) =>
  section === "Homework"
    ? {
        questions: [
          {
            id: crypto.randomUUID(),
            type: "written_response",
            prompt: "",
            points: 10,
            required: true,
            rubric: "",
            max_chars: 10000,
          },
        ],
        source_refs: [],
      }
    : section === "Flashcards"
      ? { cards: [{ term: "", definition: "" }], source_refs: [] }
      : section === "Lessons"
        ? { status: "planned", material_ids: [] }
        : section === "Tasks"
          ? { status: "todo" }
          : section === "Materials"
            ? { tags: [], student_ids: [], lesson_ids: [] }
            : {};
export function App() {
  const publicId = location.pathname.match(/^\/a\/([^/]+)$/)?.[1];
  return publicId ? <PublicAssignment id={publicId} /> : <Workspace />;
}
function Workspace() {
  const [auth, setAuth] = useState<boolean | null>(null),
    [authError, setAuthError] = useState("");
  const [section, setSection] = useState("Overview");
  useEffect(() => {
    initializeAuth()
      .then(setAuth)
      .catch((e) => setAuthError(e.message));
  }, []);
  if (auth === null || !auth)
    return (
      <div className="login">
        <div className="brand">
          <BookOpen /> atelier<span>tutor workspace</span>
        </div>
        <div className="login-card">
          <span className="eyebrow">ROOM TO GROW</span>
          <h1>
            Good teaching starts
            <br />
            with a little space.
          </h1>
          <p>
            Your students, lesson plans, and the next small breakthrough. All
            together.
          </p>
          {authError ? (
            <p role="alert" className="error">
              Sign-in unavailable: {authError}
            </p>
          ) : auth === null ? (
            <p>Connecting securely…</p>
          ) : (
            <button
              onClick={() => keycloak.login({ redirectUri: authRedirectUri })}
            >
              Sign in to your workspace <ArrowUpRight size={17} />
            </button>
          )}
          <small>Secure sign-in with Keycloak</small>
        </div>
      </div>
    );
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/">
          <BookOpen /> atelier
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav>
          {sections.map(([name, Icon]) => (
            <button
              key={name}
              className={section === name ? "active" : ""}
              onClick={() => setSection(name)}
            >
              <Icon size={19} />
              {name}
              {section === name && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar">
            {(keycloak.tokenParsed?.preferred_username ?? "T")
              .slice(0, 1)
              .toUpperCase()}
          </span>
          <div>
            <strong>
              {keycloak.tokenParsed?.preferred_username ?? "Tutor"}
            </strong>
            <small>Personal workspace</small>
          </div>
          <button
            aria-label="Sign out"
            onClick={() => keycloak.logout({ redirectUri: authRedirectUri })}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main">
        <header>
          <span>
            Workspace <ChevronRight size={14} /> {section}
          </span>
          <span className="today">
            {new Date().toLocaleDateString("en", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </span>
        </header>
        <main>
          {section === "Overview" ? (
            <Overview navigate={setSection} />
          ) : section === "Connections" ? (
            <Connections />
          ) : (
            <Resource key={section} section={section} />
          )}
        </main>
        <footer>
          MADE FOR THE WAY YOU TEACH <span>One lesson at a time.</span>
        </footer>
      </div>
    </div>
  );
}
function Overview({ navigate }: { navigate: (s: string) => void }) {
  const [data, setData] = useState<Record<string, RecordData[]>>({}),
    [error, setError] = useState("");
  useEffect(() => {
    Promise.all(
      ["students", "lessons", "tasks", "materials"].map(
        async (path) =>
          [path, (await request<Page>("/" + path)).items] as const,
      ),
    )
      .then((entries) => setData(Object.fromEntries(entries)))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A LITTLE CLARITY FOR YOUR DAY</span>
          <h1>Your teaching, in focus.</h1>
          <p>Make room for the work that matters.</p>
        </div>
        <button onClick={() => navigate("Lessons")}>
          <Plus size={17} /> Plan a lesson
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="stats">
        {[
          ["Students", "students", "Learning journeys"],
          ["Lessons", "lessons", "Plans taking shape"],
          ["Tasks", "tasks", "Things to move forward"],
          ["Materials", "materials", "Ideas to build on"],
        ].map(([title, key, note]) => (
          <button className="stat" key={key} onClick={() => navigate(title)}>
            <span>
              {title}
              <ArrowUpRight size={17} />
            </span>
            <strong>{data[key]?.length ?? "—"}</strong>
            <small>{note}</small>
          </button>
        ))}
      </div>
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-title">
            <h2>On your lesson desk</h2>
            <button className="text-button" onClick={() => navigate("Lessons")}>
              View lessons <ArrowUpRight size={15} />
            </button>
          </div>
          {data.lessons?.length ? (
            data.lessons.slice(0, 5).map((r) => (
              <div className="list-row" key={r.id}>
                <span className="record-icon">
                  <GraduationCap size={20} />
                </span>
                <div>
                  <strong>{text(r.title)}</strong>
                  <small>{text(r.status)}</small>
                </div>
                <ChevronRight size={17} />
              </div>
            ))
          ) : (
            <Empty
              icon="✧"
              title="A fresh page for your next lesson"
              description="Turn your ideas into a plan, then bring your materials together."
              action={() => navigate("Lessons")}
              actionLabel="Create a lesson"
            />
          )}
        </section>
        <section className="panel warm">
          <span className="eyebrow">SMALL STEPS, STEADY PROGRESS</span>
          <h2>What’s next?</h2>
          <p>A clear next step makes a little more room for your students.</p>
          {data.tasks
            ?.filter((r) => r.status !== "done")
            .slice(0, 4)
            .map((r) => (
              <div className="task-preview" key={r.id}>
                <CheckSquare size={18} />
                {text(r.title)}
              </div>
            ))}
          <button className="secondary" onClick={() => navigate("Tasks")}>
            Open your task list <ArrowUpRight size={16} />
          </button>
        </section>
      </div>
      <section className="quick-start">
        <div>
          <span className="eyebrow">CONNECTED, ON YOUR TERMS</span>
          <h2>Your assistant. Your workspace.</h2>
          <p>
            Connect an external AI agent to help prepare lessons and organize
            your teaching.
          </p>
        </div>
        <button className="secondary" onClick={() => navigate("Connections")}>
          Explore connections <ArrowUpRight size={16} />
        </button>
      </section>
    </>
  );
}
function Empty({
  icon,
  title,
  description,
  action,
  actionLabel,
}: {
  icon: string;
  title: string;
  description: string;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="empty">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <button className="secondary" onClick={action}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
function Resource({ section }: { section: string }) {
  const [rows, setRows] = useState<RecordData[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""),
    [archived,setArchived]=useState(false),
    [editor, setEditor] = useState<RecordData | {} | null>(null),
    [selected, setSelected] = useState<RecordData | null>(null),
    [result, setResult] = useState("");
  const route = routes[section];
  async function load(next?: string) {
    setLoading(true);
    setError("");
    try {
      let path = "/" + route;
      if(fields[section])path+="?archived="+archived;
      if (section === "Calendar") {
        const start = new Date(),
          end = new Date(Date.now() + 30 * 86400000);
        path += `?start=${start.toISOString()}&end=${end.toISOString()}`;
      }
      if (next)
        path +=
          (path.includes("?") ? "&" : "?") +
          "cursor=" +
          encodeURIComponent(next);
      const page = await request<Page>(path);
      setRows((old) => (next ? [...old, ...page.items] : page.items));
      setCursor(page.next_cursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [archived]);
  async function mutate(path: string, body: unknown = {}, revision?: number) {
    try {
      const response = await request<{
        data?: RecordData;
        status?: string;
        url?: string;
        link?: string;
        access_url?: string;
      }>(path, { method: "POST", body, revision });
      setResult(
        (response.data?.access_link as string | undefined) ??
          (response.data?.link_unavailable
            ? "This link cannot be recovered. Replace assignment access to generate a new link."
            : undefined) ??
          response.link ??
          response.access_url ??
          response.url ??
          (response.status === "pending"
            ? "Operation queued; awaiting confirmation."
            : "Change saved."),
      );
      await load();
      setSelected(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const visible = rows.filter(
    (r) =>
      JSON.stringify(r).toLowerCase().includes(query.toLowerCase()) &&
      (!filter || r.status === filter),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR TEACHING TOOLKIT</span>
          <h1>
            {section === "Activity" ? "A record of the work." : section + "."}
          </h1>
          <p>
            {
              (
                {
                  Students: "People at the heart of every lesson.",
                  Lessons: "Thoughtful plans for meaningful progress.",
                  Materials: "A library of ideas, ready when you are.",
                  Tasks: "A little structure for everything ahead.",
                  Homework: "Practice that carries the lesson forward.",
                  Flashcards: "Make the important ideas stick.",
                  Calendar: "Your teaching week, together.",
                  Activity: "Changes, provenance, and a way back.",
                } as Record<string, string>
              )[section]
            }
          </p>
        </div>
        {fields[section] && (
          <button onClick={() => setEditor(initial(section))}>
            <Plus size={17} /> Add{" "}
            {section === "Homework"
              ? "template"
              : section === "Flashcards"
                ? "set"
                : section.slice(0, -1).toLowerCase()}
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className="error">
          {error}{" "}
          <button className="text-button" onClick={() => load()}>
            Retry
          </button>
        </div>
      )}
      {result && (
        <div role="status" className="notice">
          {result.startsWith("http") ? (
            <>
              <input aria-label="Assignment link" readOnly value={result} />
              <button onClick={() => navigator.clipboard.writeText(result)}>
                Copy link
              </button>
              <p>Copy this link now. It cannot be shown again.</p>
            </>
          ) : (
            result
          )}
          <button className="text-button" onClick={() => setResult("")}>
            Dismiss
          </button>
        </div>
      )}
      {section === "Calendar" && <CalendarEditor refresh={() => load()} />}
      <section className="panel">
        <div className="toolbar">
          <label className="search">
            <Search size={17} />
            <input
              aria-label="Filter records"
              placeholder={`Search ${section.toLowerCase()}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {["Tasks", "Lessons"].includes(section) && (
            <select
              aria-label="Status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              {(section === "Tasks"
                ? ["todo", "in_progress", "done"]
                : ["planned", "completed", "cancelled"]
              ).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          )}
          {section === "Materials" && (
            <button
              className="secondary"
              disabled={!query}
              onClick={async () => {
                try {
                  const page = await request<Page>(
                    "/search?types=materials&q=" + encodeURIComponent(query),
                  );
                  setRows(page.items);
                  setQuery("");
                  setCursor(page.next_cursor);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Search text
            </button>
          )}
          {fields[section]&&<label className="option" style={{padding:6,margin:0,fontSize:11}}><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>Archived</label>}
          <span className="count">{visible.length} records</span>
        </div>
        {loading && !rows.length ? (
          <div className="empty" role="status">
            Loading your workspace…
          </div>
        ) : visible.length ? (
          <div className="records">
            {visible.map((r) => (
              <button
                className="list-row record-button"
                key={r.id}
                onClick={async()=>{if(fields[section]||section==='Assignments'){try{const response=await request<{data:RecordData}>('/'+route+'/'+r.id);setSelected(response.data)}catch(e){setError((e as Error).message)}}else setSelected(r)}}
              >
                <span className="record-icon">
                  {section === "Students" ? (
                    text(r.display_name).slice(0, 1)
                  ) : (
                    <BookOpen size={19} />
                  )}
                </span>
                <div>
                  <strong>
                    {text(r.display_name ?? r.title ?? r.entity_type ?? r.id)}
                  </strong>
                  <small>
                    {text(
                      r.subject ??
                        r.description ??
                        r.actor_category ??
                        r.status ??
                        "Revision " + r.revision,
                    ).slice(0, 120)}
                  </small>
                </div>
                {r.status != null && (
                  <span className="badge">{text(r.status)}</span>
                )}
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        ) : (
          <Empty
            icon="✧"
            title={`Your ${section.toLowerCase()} start here`}
            description="Everything you add will appear here, ready for your next step."
            action={
              fields[section] ? () => setEditor(initial(section)) : undefined
            }
            actionLabel="Add your first record"
          />
        )}
        {cursor && (
          <button className="secondary load-more" onClick={() => load(cursor)}>
            Load more
          </button>
        )}
      </section>
      {editor && (
        <Editor
          section={section}
          record={editor}
          close={() => setEditor(null)}
          saved={() => {
            setEditor(null);
            load();
          }}
        />
      )}
      {selected && (
        <div className="modal-backdrop">
          <section className="modal detail">
            <button
              className="close"
              aria-label="Close details"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
            <span className="eyebrow">
              {section} · REVISION {selected.revision}
            </span>
            <h2>
              {text(
                selected.display_name ?? selected.title ?? "Revision detail",
              )}
            </h2>
            <dl>
              {Object.entries(selected).map(([key, value]) => (
                <div key={key}>
                  <dt>{label(key)}</dt>
                  <dd>
                    <pre>
                      {typeof value === "object"
                        ? JSON.stringify(value, null, 2)
                        : text(value)}
                    </pre>
                  </dd>
                </div>
              ))}
            </dl>
            <div className="actions">
              {fields[section] && (
                <>
                  <button
                    onClick={() => {
                      setEditor(selected);
                      setSelected(null);
                    }}
                  >
                    Edit record
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      mutate(
                        `/${route}/${selected.id}/${selected.archived_at ? "restore" : "archive"}`,
                        {},
                        selected.revision,
                      )
                    }
                  >
                    {selected.archived_at ? "Restore" : "Archive"}
                  </button>
                </>
              )}
              {section === "Students" && <StudentProgress student={selected}/>}
              {section === "Materials" && <MaterialTools material={selected} />}{" "}
              {section === "Calendar" && (
                <CalendarTools
                  event={selected}
                  refresh={() => {
                    setSelected(null);
                    load();
                  }}
                />
              )}
              {section === "Assignments" && (
                <AssignmentReview
                  assignment={selected}
                  refresh={() => {
                    setSelected(null);
                    load();
                  }}
                />
              )}
              {section === "Materials" && (
                <label className="button secondary">
                  Upload version
                  <input
                    type="file"
                    accept=".pdf,.pptx,.docx,.md,.txt"
                    hidden
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const body = new FormData();
                      body.append("file", file);
                      await mutate(
                        `/materials/${selected.id}/versions`,
                        body,
                        selected.revision,
                      );
                    }}
                  />
                </label>
              )}
              {section === "Homework" && (
                <Publish
                  template={selected}
                  onPublish={(body) =>
                    mutate(
                      `/homework-templates/${selected.id}/publish`,
                      body,
                      selected.revision,
                    )
                  }
                />
              )}{" "}
              {section === "Flashcards" && (
                <button
                  className="secondary"
                  onClick={async () => {
                    try {
                      await download(
                        `/api/v1/flashcard-sets/${selected.id}/export`,
                        "flashcards.tsv",
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Download TSV
                </button>
              )}
              {section === "Activity" && (
                <button
                  className="secondary"
                  onClick={() => {
                    if (
                      confirm(
                        "Restore this revision’s previous state as a new revision? Later edits and irreversible effects may prevent restoration.",
                      )
                    )
                      mutate("/history/undo", {
                        target_revision_id: selected.id,
                        expected_current_revision: selected.revision,
                      });
                  }}
                >
                  Restore previous state
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function Publish({
  template,
  onPublish,
}: {
  template: RecordData;
  onPublish: (b: unknown) => void;
}) {
  const [student, setStudent] = useState(""),
    [due, setDue] = useState("");
  return (
    <form
      className="publish"
      onSubmit={(e) => {
        e.preventDefault();
        onPublish({
          student_id: student,
          ...(due ? { due_at: new Date(due).toISOString() } : {}),
          public_attachment_ids: [],
        });
      }}
    >
      <h3>Publish assignment</h3>
      <label>
        Student
        <ReferenceInput
          route="students"
          value={student}
          change={setStudent}
          required
        />
      </label>
      <label>
        Due date (optional)
        <input
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </label>
      <button>Publish & get private link</button>
      <small>
        A snapshot of “{text(template.title)}” will be shared with this student.
      </small>
    </form>
  );
}
function Editor({
  section,
  record,
  close,
  saved,
}: {
  section: string;
  record: RecordData | {};
  close: () => void;
  saved: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(record),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [key] = useState(crypto.randomUUID());
  const existing = record as RecordData;
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {};
      for (const field of fields[section]) {
        let v = draft[field];
        if (
          [
            "questions",
            "cards",
            "source_refs",
            "tags",
            "material_ids",
            "student_ids",
            "lesson_ids",
          ].includes(field)
        )
          v = typeof v === "string" ? JSON.parse(v) : (v ?? []);
        if(v===''&&existing.id&& !['title','display_name','instructions'].includes(field)){payload[field]=null;continue;}
        if (v !== undefined && v !== "")
          payload[field] =
            field === "due_at" ? new Date(String(v)).toISOString() : v;
      }
      await request(
        "/" + routes[section] + (existing.id ? "/" + existing.id : ""),
        {
          method: existing.id ? "PATCH" : "POST",
          body: payload,
          revision: existing.id ? existing.revision : undefined,
          key,
        },
      );
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={save}>
        <button
          type="button"
          className="close"
          aria-label="Close editor"
          onClick={close}
        >
          ×
        </button>
        <span className="eyebrow">MAKE IT YOUR OWN</span>
        <h2>
          {existing.id ? "Edit" : "New"} {section.toLowerCase()}
        </h2>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {fields[section].map((field) => {
          const val = draft[field],
            json = [
              "questions",
              "cards",
              "source_refs",
              "tags",
              "material_ids",
              "student_ids",
              "lesson_ids",
            ].includes(field);
          if(field==='contact')return <label key={field}>Contact email<input type="email" value={(val as {email?:string}|null)?.email??''} onChange={e=>setDraft({...draft,contact:e.target.value?{email:e.target.value}:null})}/></label>;
          if (["student_id", "lesson_id"].includes(field))
            return (
              <label key={field}>
                {label(field)}
                <ReferenceInput
                  route={field === "student_id" ? "students" : "lessons"}
                  value={text(val)}
                  change={(v) => setDraft({ ...draft, [field]: v })}
                  required={section === "Lessons" && field === "student_id"}
                />
              </label>
            );
          if (["student_ids", "lesson_ids", "material_ids"].includes(field))
            return (
              <label key={field}>
                {label(field)}
                <ReferenceMultiple
                  route={
                    field === "student_ids"
                      ? "students"
                      : field === "lesson_ids"
                        ? "lessons"
                        : "materials"
                  }
                  value={Array.isArray(val) ? (val as string[]) : []}
                  change={(v) => setDraft({ ...draft, [field]: v })}
                />
              </label>
            );
          if (field === "questions")
            return (
              <QuestionEditor
                key={field}
                value={Array.isArray(val) ? val : []}
                change={(v) => setDraft({ ...draft, questions: v })}
              />
            );
          if (field === "cards")
            return (
              <CardEditor
                key={field}
                value={Array.isArray(val) ? val : []}
                change={(v) => setDraft({ ...draft, cards: v })}
              />
            );
          return (
            <label key={field}>
              {label(field)}
              {field === "status" ? (
                <select
                  value={text(
                    val ?? (section === "Tasks" ? "todo" : "planned"),
                  )}
                  onChange={(e) =>
                    setDraft({ ...draft, [field]: e.target.value })
                  }
                >
                  {(section === "Tasks"
                    ? ["todo", "in_progress", "done"]
                    : ["planned", "completed", "cancelled"]
                  ).map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              ) : json ||
                [
                  "description",
                  "plan",
                  "notes",
                  "goals",
                  "instructions",
                ].includes(field) ? (
                <textarea
                  rows={json ? 6 : 3}
                  value={
                    json
                      ? typeof val === "string"
                        ? val
                        : JSON.stringify(val ?? [], null, 2)
                      : text(val)
                  }
                  onChange={(e) =>
                    setDraft({ ...draft, [field]: e.target.value })
                  }
                />
              ) : (
                <input
                  required={
                    ["title", "display_name"].includes(field) ||
                    (section === "Lessons" && field === "student_id")
                  }
                  type={field === "due_at" ? "datetime-local" : "text"}
                  value={text(val)}
                  onChange={(e) =>
                    setDraft({ ...draft, [field]: e.target.value })
                  }
                />
              )}{" "}
              {json && <small>Structured JSON · validated by the server</small>}
            </label>
          );
        })}
        <div className="actions">
          <button disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
async function download(path: string, name: string) {
  await keycloak.updateToken(30);
  const response = await fetch(path, {
    headers: { Authorization: `Bearer ${keycloak.token}` },
  });
  if (!response.ok) throw new Error("Download unavailable");
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
function Connections() {
  const [error, setError] = useState(""),
    [connection, setConnection] = useState<RecordData | null>(null);
  useEffect(() => {
    request<{ data: RecordData }>("/calendar/connection")
      .then((r) => setConnection(r.data))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CONNECTED, ON YOUR TERMS</span>
          <h1>A little extra support.</h1>
          <p>
            Bring your calendar and your preferred assistant into your workflow.
          </p>
        </div>
      </div>
      <section className="panel connection">
        <CalendarDays />
        <h2>Google Calendar</h2>
        <p>
          Connect one writable calendar to schedule lessons. Google remains the
          source of event timing.
        </p>
        {connection && (
          <>
            <pre>{JSON.stringify(connection, null, 2)}</pre>
            {connection.status === "select_calendar" && (
              <CalendarSelection
                connection={connection}
                saved={setConnection}
              />
            )}
          </>
        )}
        <button
          onClick={async () => {
            try {
              const r = await request<{
                data?: { authorization_url?: string };
                url?: string;
                authorization_url?: string;
              }>("/calendar/connection/authorize", {
                method: "POST",
                body: {},
              });
              const url =
                r.data?.authorization_url ?? r.authorization_url ?? r.url;
              if (url) location.assign(url);
              else
                throw new Error(
                  "The server did not return an authorization URL",
                );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Connect Google Calendar <ArrowUpRight size={16} />
        </button>
        {connection && (
          <button
            className="secondary"
            onClick={async () => {
              try {
                await request("/calendar/connection/disconnect", {
                  method: "POST",
                  body: {},
                  revision: connection.revision,
                });
                setConnection(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Disconnect
          </button>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
      <section className="panel connection">
        <Sparkles />
        <h2>Your external AI assistant</h2>
        <p>
          Connect an approved remote Streamable HTTP MCP client using OAuth with
          PKCE. Your assistant can access student data and materials when
          requested. Only the tutor website can release grades or reopen
          submissions.
        </p>
        <label>
          Server URL
          <input readOnly value={location.origin + "/mcp"} />
        </label>
        <p>
          Ask your deployment operator for the registered client ID, exact
          redirect URI, and supported scopes. No shared API key is required.
        </p>
        <code>
          workspace:read workspace:write assignments:publish calendar:read
          calendar:write grading:propose history:read history:undo
        </code>
      </section>
    </>
  );
}
type Question = {
  id: string;
  type: string;
  prompt: string;
  points: number;
  required: boolean;
  max_chars?: number;
  allowed_types?: string[];
  max_files?: number;
  options?: { id: string; text: string }[];
};
type PublicData = {
  id: string;
  title: string;
  instructions: string;
  questions: Question[];
  due_at?: string;
  status: string;
  attempt: {
    id: string;
    revision: number;
    status: string;
    answers: { question_id: string; value: unknown }[];
    files?: { id: string; question_id: string; filename: string }[];
  };
  attachments?: { id: string; filename: string }[];
  released_result?: {
    items: { question_id: string; awarded_points: number; feedback: string }[];
    overall_feedback: string;
  };
};
function PublicAssignment({ id }: { id: string }) {
  const [data, setData] = useState<PublicData | null>(null),
    [csrf, setCsrf] = useState(""),
    [answers, setAnswers] = useState<Record<string, unknown>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [conflict, setConflict] = useState(false);
  const apply = (d: PublicData) => {
    requireAssignmentIdentity(id, d.id);
    setData(d);
    const saved = Object.fromEntries(
      (d.attempt.answers ?? []).map((a) => [a.question_id, a.value]),
    );
    for (const question of d.questions)
      if (question.type === "file_upload")
        saved[question.id] = (d.attempt.files ?? [])
          .filter((f) => f.question_id === question.id)
          .map((f) => f.id);
    setAnswers(saved);
  };
  useEffect(() => {
    const token = location.hash.slice(1);
    history.replaceState(null, "", location.pathname);
    (async () => {
      try {
        if (token) {
          const r = await request<{
            csrf_token: string;
            assignment: PublicData;
          }>(`/assignments/${id}/session`, {
            public: true,
            method: "POST",
            body: { token },
          });
          setCsrf(r.csrf_token);
          sessionStorage.setItem("assignment-csrf", r.csrf_token);
          apply(r.assignment);
        } else {
          setCsrf(sessionStorage.getItem("assignment-csrf") ?? "");
          apply(await request<PublicData>("/assignment", { public: true }));
        }
      } catch {
        setError(
          "This assignment is unavailable. Please contact your tutor for a current link.",
        );
      }
    })();
  }, [id]);
  async function save() {
    if (!data) return false;
    const response = await request<{
      revision: number;
      data?: { revision: number };
    }>("/attempt", {
      public: true,
      method: "PATCH",
      revision: data.attempt.revision,
      csrf,
      body: {
        answers: Object.entries(answers).map(([question_id, value]) => ({
          question_id,
          value,
        })),
      },
    });
    const revision = response.revision ?? response.data?.revision;
    if (!revision)
      throw new Error(
        "Save returned no revision. Reload to check the saved draft.",
      );
    setData({ ...data, attempt: { ...data.attempt, revision } });
    return revision;
  }
  async function action(submit = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const revision = await save();
      if (submit && revision) {
        await request("/attempt/submit", {
          public: true,
          method: "POST",
          revision,
          csrf,
          body: {},
        });
        apply(await request<PublicData>("/assignment", { public: true }));
        setMessage("Your work has been submitted.");
      } else setMessage("Draft saved. You can come back to it.");
    } catch (e) {
      setError((e as Error).message);
      if ((e as { status?: number }).status === 409) setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="assignment">
      <a className="brand" href="#">
        <BookOpen /> atelier<span>practice space</span>
      </a>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {conflict && (
        <div className="notice">
          <p>
            This draft changed in another session. Review the server draft
            before continuing. Your answers remain visible until you choose to
            reload.
          </p>
          <button
            onClick={async () => {
              try {
                apply(await request<PublicData>("/assignment", { public: true }));
                setConflict(false);
                setError("");
              } catch (err) { setError((err as Error).message); }
            }}
          >
            Load server draft
          </button>
        </div>
      )}
      {data && (
        <>
          <div className="assignment-heading">
            <span className="eyebrow">
              A LITTLE PRACTICE, A LITTLE PROGRESS
            </span>
            <h1>{data.title}</h1>
            <p className="preserve">{data.instructions}</p>
            {data.due_at && (
              <small>Due {new Date(data.due_at).toLocaleString()}</small>
            )}
            <span className="badge">{data.attempt.status}</span>
          </div>
          {(data.attachments ?? []).map((file) => (
            <p key={file.id}>
              <a href={"/public/v1/files/" + file.id} download>
                {file.filename}
              </a>
            </p>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(true);
            }}
          >
            {data.questions.map((q, i) => {
              const readonly = !canEditAssignment(data.status, data.attempt.status);
              return (
                <fieldset
                  className="panel question"
                  key={q.id}
                  disabled={readonly || busy || conflict}
                >
                  <legend>
                    <span>{String(i + 1).padStart(2, "0")}</span> {q.prompt}{" "}
                    {q.required && <small>Required</small>}
                  </legend>
                  <small>{q.points} points</small>
                  {["single_choice", "multiple_choice"].includes(q.type) ? (
                    q.options?.map((option) => (
                      <label className="option" key={option.id}>
                        <input
                          type={
                            q.type === "single_choice" ? "radio" : "checkbox"
                          }
                          name={q.id}
                          checked={
                            q.type === "single_choice"
                              ? answers[q.id] === option.id
                              : Array.isArray(answers[q.id]) &&
                                (answers[q.id] as string[]).includes(option.id)
                          }
                          onChange={(e) => {
                            if (q.type === "single_choice")
                              setAnswers({ ...answers, [q.id]: option.id });
                            else {
                              const current = (answers[q.id] ?? []) as string[];
                              setAnswers({
                                ...answers,
                                [q.id]: e.target.checked
                                  ? [...current, option.id]
                                  : current.filter((v) => v !== option.id),
                              });
                            }
                          }}
                        />
                        {option.text}
                      </label>
                    ))
                  ) : q.type === "file_upload" ? (
                    <>
                      <input
                        type="file"
                        accept={(q.allowed_types ?? ["pdf", "docx", "txt", "png", "jpg", "jpeg"]).map(type => "." + type).join(",")}
                        disabled={(data.attempt.files ?? []).filter(file => file.question_id === q.id).length >= (q.max_files ?? 3)}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          setBusy(true);
                          try {
                            const body = new FormData();
                            body.append("question_id", q.id);
                            body.append("file", file);
                            await request("/attempt/files", {
                              public: true,
                              method: "POST",
                              body,
                              revision: (await save()) || data.attempt.revision,
                              csrf,
                            });
                            apply(
                              await request<PublicData>("/assignment", {
                                public: true,
                              }),
                            );
                            setMessage("File attached.");
                          } catch (err) {
                            setError((err as Error).message);
                            if ((err as { status?: number }).status === 409) setConflict(true);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      />
                      {(data.attempt.files ?? [])
                        .filter((f) => f.question_id === q.id)
                        .map((file) => (
                          <div className="attachment" key={file.id}>
                            <a href={"/public/v1/files/" + file.id} download>
                              {file.filename}
                            </a>
                            {!readonly && (
                              <button
                                type="button"
                                className="text-button"
                                onClick={async () => {
                                  setBusy(true);
                                  setError("");
                                  try {
                                    const revision = await save();
                                    await request(
                                      "/attempt/files/" + file.id + "/remove",
                                      {
                                        public: true,
                                        method: "POST",
                                        revision: revision || data.attempt.revision,
                                        csrf,
                                        body: {},
                                      },
                                    );
                                    apply(
                                      await request<PublicData>("/assignment", {
                                        public: true,
                                      }),
                                    );
                                  } catch (err) {
                                    setError((err as Error).message);
                                    if ((err as { status?: number }).status === 409) setConflict(true);
                                  } finally { setBusy(false); }
                                }}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                    </>
                  ) : (
                    <textarea
                      aria-label={q.prompt}
                      rows={6}
                      maxLength={q.max_chars ?? 10000}
                      value={text(answers[q.id])}
                      onChange={(e) =>
                        setAnswers({ ...answers, [q.id]: e.target.value })
                      }
                    />
                  )}
                </fieldset>
              );
            })}
            {message && (
              <p role="status" className="notice">
                {message}
              </p>
            )}
            {canEditAssignment(data.status, data.attempt.status) ? (
              <div className="assignment-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || conflict}
                  onClick={() => action()}
                >
                  Save draft
                </button>
                <button type="submit" disabled={busy || conflict}>
                  {busy ? "Saving…" : "Submit assignment"}{" "}
                  <ArrowUpRight size={16} />
                </button>
                <p>
                  Submission makes your answers read-only until your tutor
                  reopens the assignment.
                </p>
              </div>
            ) : (
              <div className="notice">
                {data.status !== "open" ? "This assignment is closed. Contact your tutor to continue." : "Your answers are submitted. Your tutor will share feedback here when it is ready."}
              </div>
            )}
          </form>
          {data.released_result != null && (
            <section className="panel question">
              <h2>Your feedback</h2>
              <p className="preserve">
                {data.released_result.overall_feedback}
              </p>
              {data.released_result.items.map((item) => (
                <div className="question-editor" key={item.question_id}>
                  <strong>
                    {data.questions.find((q) => q.id === item.question_id)
                      ?.prompt ?? "Question"}
                  </strong>
                  <p>{item.awarded_points} points</p>
                  <p className="preserve">{item.feedback}</p>
                </div>
              ))}
            </section>
          )}
        </>
      )}
      <footer>Your own pace. Your next step.</footer>
    </div>
  );
}
function QuestionEditor({
  value,
  change,
}: {
  value: unknown[];
  change: (v: unknown[]) => void;
}) {
  const questions = value as (Question & {
    rubric?: string;
    correct_option_id?: string;
    correct_option_ids?: string[];
    allowed_types?: string[];
    max_files?: number;
  })[];
  const update = (i: number, patch: object) =>
    change(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  return (
    <section>
      <h3>Questions</h3>
      {questions.map((q, i) => (
        <div className="question-editor" key={q.id}>
          <div className="toolbar">
            <strong>Question {i + 1}</strong>
            <button
              type="button"
              className="text-button"
              onClick={() => change(questions.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
          <label>
            Question type
            <select
              value={q.type}
              onChange={(e) => {
                const type = e.target.value;
                const common = {
                  id: q.id,
                  type,
                  prompt: q.prompt,
                  points: q.points,
                  required: q.required,
                };
                if (type.includes("choice")) {
                  const options = [
                    { id: crypto.randomUUID(), text: "" },
                    { id: crypto.randomUUID(), text: "" },
                  ];
                  change(
                    questions.map((v, j) =>
                      j === i
                        ? {
                            ...common,
                            options,
                            ...(type === "single_choice"
                              ? { correct_option_id: options[0].id }
                              : { correct_option_ids: [options[0].id] }),
                          }
                        : v,
                    ),
                  );
                } else
                  change(
                    questions.map((v, j) =>
                      j === i
                        ? {
                            ...common,
                            rubric: "",
                            ...(type === "file_upload"
                              ? {
                                  allowed_types: [
                                    "pdf",
                                    "docx",
                                    "txt",
                                    "png",
                                    "jpg",
                                  ],
                                  max_files: 3,
                                }
                              : { max_chars: 10000 }),
                          }
                        : v,
                    ),
                  );
              }}
            >
              {[
                "written_response",
                "single_choice",
                "multiple_choice",
                "file_upload",
              ].map((t) => (
                <option key={t} value={t}>
                  {label(t)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Prompt
            <textarea
              required
              value={q.prompt}
              onChange={(e) => update(i, { prompt: e.target.value })}
            />
          </label>
          <label>
            Points
            <input
              type="number"
              min="0"
              max="100"
              value={q.points}
              onChange={(e) => update(i, { points: Number(e.target.value) })}
            />
          </label>
          <label className="option">
            <input
              type="checkbox"
              checked={q.required}
              onChange={(e) => update(i, { required: e.target.checked })}
            />
            Required answer
          </label>
          {q.options?.map((o, j) => (
            <div className="option-edit" key={o.id}>
              <input
                aria-label={`Option ${j + 1}`}
                required
                value={o.text}
                onChange={(e) =>
                  update(i, {
                    options: q.options!.map((v) =>
                      v.id === o.id ? { ...v, text: e.target.value } : v,
                    ),
                  })
                }
              />
              <label className="option">
                <input
                  type={q.type === "single_choice" ? "radio" : "checkbox"}
                  name={"correct-" + q.id}
                  checked={
                    q.type === "single_choice"
                      ? q.correct_option_id === o.id
                      : (q.correct_option_ids?.includes(o.id) ?? false)
                  }
                  onChange={(e) =>
                    update(
                      i,
                      q.type === "single_choice"
                        ? { correct_option_id: o.id }
                        : {
                            correct_option_ids: e.target.checked
                              ? [...(q.correct_option_ids ?? []), o.id]
                              : (q.correct_option_ids ?? []).filter(
                                  (v) => v !== o.id,
                                ),
                          },
                    )
                  }
                />
                Correct
              </label>
            </div>
          ))}
          {q.options && q.options.length < 10 && (
            <button
              type="button"
              className="secondary"
              onClick={() =>
                update(i, {
                  options: [
                    ...q.options!,
                    { id: crypto.randomUUID(), text: "" },
                  ],
                })
              }
            >
              Add option
            </button>
          )}
          {!q.options && (
            <label>
              Private grading rubric
              <textarea
                value={q.rubric ?? ""}
                onChange={(e) => update(i, { rubric: e.target.value })}
              />
            </label>
          )}
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        onClick={() =>
          change([
            ...questions,
            {
              id: crypto.randomUUID(),
              type: "written_response",
              prompt: "",
              points: 10,
              required: true,
              rubric: "",
              max_chars: 10000,
            },
          ])
        }
      >
        Add question
      </button>
    </section>
  );
}
function CardEditor({
  value,
  change,
}: {
  value: unknown[];
  change: (v: unknown[]) => void;
}) {
  const cards = value as { term: string; definition: string }[];
  return (
    <section>
      <h3>Flashcards</h3>
      {cards.map((card, i) => (
        <div className="question-editor" key={i}>
          <label>
            Term
            <input
              required
              value={card.term}
              onChange={(e) =>
                change(
                  cards.map((c, j) =>
                    j === i ? { ...c, term: e.target.value } : c,
                  ),
                )
              }
            />
          </label>
          <label>
            Definition
            <textarea
              required
              value={card.definition}
              onChange={(e) =>
                change(
                  cards.map((c, j) =>
                    j === i ? { ...c, definition: e.target.value } : c,
                  ),
                )
              }
            />
          </label>
          <button
            type="button"
            className="text-button"
            onClick={() => change(cards.filter((_, j) => j !== i))}
          >
            Remove card
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        onClick={() => change([...cards, { term: "", definition: "" }])}
      >
        Add card
      </button>
    </section>
  );
}
function AssignmentReview({
  assignment,
  refresh,
}: {
  assignment: RecordData;
  refresh: () => void;
}) {
  const [attempts, setAttempts] = useState<RecordData[]>([]),
    [attempt, setAttempt] = useState<RecordData | null>(null),
    [items, setItems] = useState<
      { question_id: string; awarded_points: number; feedback: string }[]
    >([]),
    [feedback, setFeedback] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    request<Page>(`/assignments/${assignment.id}/submissions`)
      .then((r) => setAttempts(r.items))
      .catch((e) => setError(e.message));
  }, [assignment.id]);
  async function select(row: RecordData) {
    try {
      const r = await request<{ data: RecordData }>(`/submissions/${row.id}`);
      setAttempt(r.data);
      const questions = (r.data.questions ??
        (assignment.content as { questions?: unknown[] } | undefined)
          ?.questions ??
        []) as Question[];
      setItems(
        questions.length
          ? questions.map((q) => ({
              question_id: q.id,
              awarded_points: Number(
                (
                  r.data.objective_result as Record<string, number> | undefined
                )?.[q.id] ?? 0,
              ),
              feedback: "",
            }))
          : ((r.data.answers ?? []) as { question_id: string }[]).map((a) => ({
              question_id: a.question_id,
              awarded_points: Number(
                (
                  r.data.objective_result as Record<string, number> | undefined
                )?.[a.question_id] ?? 0,
              ),
              feedback: "",
            })),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function action(name: string) {
    setBusy(true);
    try {
      const response = await request<{
        data?: { access_link?: string };
        url?: string;
        link?: string;
        access_url?: string;
      }>(`/assignments/${assignment.id}/${name}`, {
        method: "POST",
        revision: assignment.revision,
        body: {},
      });
      if (name === "replace-access")
        setNotice(
          response.data?.access_link ??
            response.link ??
            response.access_url ??
            response.url ??
            "Link unavailable. Replace access to issue a new link.",
        );
      else refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function release() {
    if (!attempt) return;
    setBusy(true);
    try {
      const proposal = await request<{ data: RecordData; revision: number }>(
        `/submissions/${attempt.id}/grade-proposals`,
        {
          method: "POST",
          body: {
            items,
            overall_feedback: feedback,
            expected_submission_revision: attempt.revision,
          },
        },
      );
      await request(`/submissions/${attempt.id}/release-grade`, {
        method: "POST",
        revision: assignment.revision,
        body: {
          proposal_id: proposal.data.id,
          expected_proposal_revision:
            proposal.revision ?? proposal.data.revision,
          expected_submission_revision: attempt.revision,
          expected_assignment_revision: assignment.revision,
        },
      });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="review">
      <h3>Assignment access & review</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <div className="notice">
          <input value={notice} readOnly aria-label="New assignment link" />
          <button onClick={() => navigator.clipboard.writeText(notice)}>
            Copy now
          </button>
        </div>
      )}
      <div className="actions">
        <button
          disabled={busy}
          className="secondary"
          onClick={() => action("replace-access")}
        >
          Replace private link
        </button>
        <button
          disabled={busy}
          className="secondary"
          onClick={() => action("revoke-access")}
        >
          Revoke access
        </button>
        <button
          disabled={busy}
          className="secondary"
          onClick={() => action("reopen")}
        >
          Reopen submission
        </button>
      </div>
      <h3>Submissions</h3>
      {!attempts.length && <p>No submissions yet.</p>}
      {attempts.map((a) => (
        <button className="secondary" key={a.id} onClick={() => select(a)}>
          {text(a.status)} · {a.id.slice(0, 8)}
        </button>
      ))}
      {attempt && (
        <>
          <pre>{JSON.stringify(attempt, null, 2)}</pre>
          {items.map((item, i) => (
            <div key={item.question_id}>
              <label>
                Question {i + 1} points
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={item.awarded_points}
                  onChange={(e) =>
                    setItems(
                      items.map((v, j) =>
                        j === i
                          ? { ...v, awarded_points: Number(e.target.value) }
                          : v,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Feedback
                <textarea
                  value={item.feedback}
                  onChange={(e) =>
                    setItems(
                      items.map((v, j) =>
                        j === i ? { ...v, feedback: e.target.value } : v,
                      ),
                    )
                  }
                />
              </label>
            </div>
          ))}
          <label>
            Overall feedback
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </label>
          <button
            disabled={busy || attempt.status === "draft"}
            onClick={release}
          >
            {busy ? "Saving…" : "Release grades & feedback"}
          </button>
          <p>
            Objective scores must match the deterministic server score. Students
            see grades only after release.
          </p>
        </>
      )}
    </div>
  );
}
function CalendarEditor({ refresh }: { refresh: () => void }) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function sync() {
    try {
      const r = await request<{ operation_id: string }>("/calendar/sync", {
        method: "POST",
        body: {},
      });
      setNotice("Refresh queued · " + r.operation_id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="panel connection">
      <div className="actions">
        <button className="secondary" onClick={sync}>
          Refresh calendar
        </button>
        <button onClick={() => setOpen(!open)}>Schedule a lesson</button>
      </div>
      {notice && <p className="notice">{notice}</p>}
      {notice.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i) && (
        <OperationMonitor
          id={notice.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)![0]}
        />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {open && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              const timezone = String(f.get("timezone"));
              const r = await request<{ operation_id: string }>(
                "/calendar/events",
                {
                  method: "POST",
                  body: {
                    title: f.get("title"),
                    lesson_id: f.get("lesson_id"),
                    expected_lesson_revision: Number(f.get("lesson_revision")),
                    start: new Date(String(f.get("start"))).toISOString(),
                    end: new Date(String(f.get("end"))).toISOString(),
                    timezone,
                  },
                },
              );
              setNotice(
                "Schedule operation queued; Google confirmation is pending · " +
                  r.operation_id,
              );
              setOpen(false);
              refresh();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <label>
            Lesson ID
            <input name="lesson_id" required />
          </label>
          <label>
            Current lesson revision
            <input name="lesson_revision" type="number" min="1" required />
          </label>
          <label>
            Event title
            <input name="title" required />
          </label>
          <label>
            Start (your local time)
            <input name="start" type="datetime-local" required />
          </label>
          <label>
            End (your local time)
            <input name="end" type="datetime-local" required />
          </label>
          <label>
            Timezone
            <input
              name="timezone"
              defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone}
              required
            />
          </label>
          <button>Queue calendar event</button>
        </form>
      )}
    </section>
  );
}
function MaterialTools({ material }: { material: RecordData }) {
  const [versions, setVersions] = useState<RecordData[]>([]),
    [preview, setPreview] = useState(""),
    [artifact, setArtifact] = useState(text(material.active_artifact_id??"")),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    request<Page>(`/materials/${material.id}/versions`)
      .then((r) => setVersions(r.items))
      .catch((e) => setError(e.message));
  }, [material.id]);
  return (
    <section className="review">
      <h3>Versions & extracted text</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="notice">{notice}</p>}
      {notice.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i) && (
        <OperationMonitor
          id={notice.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)![0]}
        />
      )}
      {versions.map((v) => (
        <div className="question-editor" key={v.id}>
          <strong>{text(v.filename ?? v.id)}</strong>
          <p>Status: {text(v.status ?? "processing")}</p>
          <pre>{JSON.stringify(v, null, 2)}</pre>
          <div className="actions">
            <button
              className="secondary"
              onClick={() =>
                download(
                  `/api/v1/materials/${material.id}/original?version_id=${v.id}`,
                  text(v.filename ?? "material"),
                )
              }
            >
              Download original
            </button>
            <button
              className="secondary"
              onClick={async () => {
                try {
                  const r = await request<{ status: string }>(
                    `/materials/${material.id}/retry-conversion`,
                    {
                      method: "POST",
                      revision: material.revision,
                      body: { version_id: v.id },
                    },
                  );
                  setNotice("Conversion queued · " + r.status);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Retry conversion
            </button>
          </div>
        </div>
      ))}
      <label>
        Artifact ID
        <input value={artifact} onChange={(e) => setArtifact(e.target.value)} />
      </label>
      <button
        className="secondary"
        disabled={!artifact}
        onClick={async () => {
          try {
            const chunks:string[]=[];let start:number|null=0;
            do{const r:{data:{chunks:{text:string}[];warnings:string[];next_start:number|null}}=await request<{data:{chunks:{text:string}[];warnings:string[];next_start:number|null}}>(`/materials/${material.id}/chunks?artifact_id=${encodeURIComponent(artifact)}&start=${start}&count=20`);chunks.push(...r.data.chunks.map(c=>c.text));start=r.data.next_start;if(r.data.warnings.length)setNotice(r.data.warnings.join(' · '));}while(start!==null);
            setPreview(chunks.join('\n\n'));
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Load extracted text
      </button>
      <label>
        Correct extracted Markdown
        <textarea
          rows={12}
          value={preview}
          onChange={(e) => setPreview(e.target.value)}
        />
      </label>
      <button
        disabled={!artifact || !preview}
        onClick={async () => {
          try {
            await request(`/materials/${material.id}/markdown-corrections`, {
              method: "POST",
              revision: material.revision,
              body: { source_artifact_id: artifact, markdown: preview },
            });
            setNotice("Correction saved as a new artifact.");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Save correction
      </button>
    </section>
  );
}
function CalendarTools({
  event,
  refresh,
}: {
  event: RecordData;
  refresh: () => void;
}) {
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <section className="review">
      <h3>Calendar event</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="notice">{notice}</p>}
      {notice.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i) && (
        <OperationMonitor
          id={notice.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)![0]}
        />
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            const r = await request<{ operation_id: string }>(
              `/calendar/events/${event.id}`,
              {
                method: "PATCH",
                revision: event.revision,
                body: {
                  start: new Date(String(f.get("start"))).toISOString(),
                  end: new Date(String(f.get("end"))).toISOString(),
                  timezone: f.get("timezone"),
                  expected_etag: event.etag,
                },
              },
            );
            setNotice(
              "Reschedule queued; provider confirmation pending · " +
                r.operation_id,
            );
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <label>
          New start (your local time)
          <input type="datetime-local" name="start" required />
        </label>
        <label>
          New end (your local time)
          <input type="datetime-local" name="end" required />
        </label>
        <label>
          Timezone
          <input
            name="timezone"
            defaultValue={text(
              event.timezone ??
                Intl.DateTimeFormat().resolvedOptions().timeZone,
            )}
            required
          />
        </label>
        <button>Queue reschedule</button>
      </form>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await request(`/calendar/events/${event.id}/link`, {
              method: "POST",
              revision: event.revision,
              body: {
                lesson_id: f.get("lesson_id"),
                expected_lesson_revision: Number(f.get("revision")),
              },
            });
            refresh();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <label>
          Link lesson ID
          <input name="lesson_id" required />
        </label>
        <label>
          Current lesson revision
          <input name="revision" type="number" min="1" required />
        </label>
        <button className="secondary">Link lesson</button>
      </form>
    </section>
  );
}
function CalendarSelection({
  connection,
  saved,
}: {
  connection: RecordData;
  saved: (r: RecordData) => void;
}) {
  const [calendars, setCalendars] = useState<RecordData[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    request<Page>("/calendar/calendars")
      .then((r) => setCalendars(r.items))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const r = await request<{ data: RecordData }>(
            "/calendar/connection",
            {
              method: "PUT",
              revision: connection.revision,
              body: { calendar_id: selected },
            },
          );
          saved(r.data);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <label>
        Select your teaching calendar
        <select
          required
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Choose a writable calendar</option>
          {calendars.map((c) => (
            <option value={c.id} key={c.id}>
              {text(c.summary ?? c.id)}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      <button>Use this calendar</button>
    </form>
  );
}
function ReferenceInput({
  route,
  value,
  change,
  required = false,
}: {
  route: string;
  value: string;
  change: (v: string) => void;
  required?: boolean;
}) {
  const [rows, setRows] = useState<RecordData[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    request<Page>("/" + route + "?limit=100")
      .then((r) => setRows(r.items))
      .catch((e) => setError(e.message));
  }, [route]);
  return (
    <>
      <select
        required={required}
        value={value}
        onChange={(e) => change(e.target.value)}
      >
        <option value="">{required ? "Choose a record" : "None"}</option>
        {rows.map((r) => (
          <option value={r.id} key={r.id}>
            {text(r.display_name ?? r.title ?? r.id)}
          </option>
        ))}
      </select>
      {error && <small role="alert">{error}</small>}
    </>
  );
}
function ReferenceMultiple({
  route,
  value,
  change,
}: {
  route: string;
  value: string[];
  change: (v: string[]) => void;
}) {
  const [rows, setRows] = useState<RecordData[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    request<Page>("/" + route + "?limit=100")
      .then((r) => setRows(r.items))
      .catch((e) => setError(e.message));
  }, [route]);
  return (
    <>
      <select
        multiple
        size={Math.min(5, Math.max(2, rows.length))}
        value={value}
        onChange={(e) =>
          change([...e.target.selectedOptions].map((o) => o.value))
        }
      >
        {rows.map((r) => (
          <option value={r.id} key={r.id}>
            {text(r.display_name ?? r.title ?? r.id)}
          </option>
        ))}
      </select>
      <small>Hold Ctrl / Command to select more than one.</small>
      {error && <small role="alert">{error}</small>}
    </>
  );
}
function OperationMonitor({ id }: { id: string }) {
  const [result, setResult] = useState<RecordData | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const r = await request<{ data: RecordData }>(
          "/calendar/operations/" + id,
        );
        if (!active) return;
        setResult(r.data);
        if (["queued", "pending", "running"].includes(text(r.data.status)))
          timer = setTimeout(poll, 2000);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    }
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id]);
  return (
    <div role="status" className="notice">
      Calendar operation: {result ? text(result.status) : "Checking status…"}
      {result?.error != null && <p>{text(result.error)}</p>}
      {error && <p>{error}</p>}
    </div>
  );
}
function StudentProgress({student}:{student:RecordData}){const[records,setRecords]=useState<{kind:string;record:RecordData}[]>([]),[error,setError]=useState('');useEffect(()=>{Promise.all(['lessons','assignments'].map(async kind=>{const r=await request<Page>('/'+kind+'?student_id='+student.id);return r.items.filter(item=>item.student_id===student.id).map(record=>({kind,record}))})).then(rows=>setRecords(rows.flat().sort((a,b)=>text(b.record.created_at).localeCompare(text(a.record.created_at))))).catch(e=>setError(e.message))},[student.id]);return <section className="review"><h3>Learning history</h3>{error&&<p className="error">{error}</p>}{records.length?records.map(({kind,record})=><div className="question-editor" key={record.id}><span className="eyebrow">{kind}</span><h3>{text(record.title??record.id)}</h3><p>{text(record.status)} · {new Date(text(record.created_at)).toLocaleDateString()}</p>{record.release_id!=null&&<span className="badge">Results released</span>}</div>):<p>No linked lessons or assignments yet.</p>}</section>}
