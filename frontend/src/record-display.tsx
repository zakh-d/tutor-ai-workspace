import type { RecordData } from "./api";
import { formatDateTime, formatStatus } from "./overview-data";

/** Readable values never serialize transport objects or expose their internal keys. */
export function readableValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(readableValue).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    return readableValue(row.text ?? row.message ?? row.email ?? row.label ?? row.name ?? row.value);
  }
  return "";
}
export function RecordSummary({ record }: { record: RecordData }) {
  const fields: [string, string][] = [
    ["status", "Status"], ["due_at", "Due"], ["contact", "Contact"], ["subject", "Subject"], ["level", "Level"],
    ["description", "Description"], ["plan", "Lesson plan"], ["goals", "Learning goals"], ["notes", "Private notes"],
    ["instructions", "Instructions"], ["start", "Starts"], ["end", "Ends"], ["expires_at", "Access expires"], ["tags", "Tags"],
  ];
  const rows = fields.map(([key, title]) => ({ title, value: key === "status" ? (record[key] ? formatStatus(record[key]) : "") : ["due_at", "start", "end", "expires_at"].includes(key) ? formatDateTime(record[key]) : readableValue(record[key]) })).filter(row => row.value);
  return rows.length ? <dl className="record-summary">{rows.map(row => <div key={row.title}><dt>{row.title}</dt><dd className="preserve">{row.value}</dd></div>)}</dl> : null;
}
type Question = { id: string; prompt: string; type: string; points: number; required?: boolean; options?: { id: string; text: string }[]; rubric?: string; correct_option_id?: string; correct_option_ids?: string[] };
function contentOf(record: Record<string, unknown>) { return (record.content ?? record) as { questions?: Question[]; cards?: {term: string; definition: string}[]; instructions?: string }; }
export function ContentPreview({ record }: { record: RecordData }) {
  const content = contentOf(record);
  return <>
    {record.content != null && content.instructions && <section className="review"><h2>Instructions</h2><p className="preserve">{content.instructions}</p></section>}
    {content.questions?.length ? <section className="review"><h2>Questions</h2>{content.questions.map((question, index) => <article className="question-editor" key={question.id}>
      <h3>{index + 1}. {question.prompt}</h3><p>{formatStatus(question.type)} · {question.points} points{question.required ? " · Required" : ""}</p>
      {question.options && <ul>{question.options.map(option => <li key={option.id}>{option.text}{question.correct_option_id === option.id || question.correct_option_ids?.includes(option.id) ? " (correct answer)" : ""}</li>)}</ul>}
      {question.rubric && <p className="preserve">Private grading guidance: {question.rubric}</p>}
    </article>)}</section> : null}
    {content.cards?.length ? <section className="review"><h2>Flashcards</h2><dl className="record-summary">{content.cards.map((card, index) => <div key={index}><dt>{card.term}</dt><dd>{card.definition}</dd></div>)}</dl></section> : null}
  </>;
}
export function answerText(value: unknown, question?: Question) {
  if (question?.options) return (Array.isArray(value) ? value : [value]).map(id => question.options?.find(option => option.id === id)?.text ?? "Unavailable option").join(", ");
  return readableValue(value) || "No answer provided";
}
export function SubmissionAnswers({ attempt, content, download, questionId }: { attempt: RecordData; content: unknown; questionId?: string; download?: (path: string, name: string) => void }) {
  const questions = (attempt.questions ?? (content as {questions?: Question[]} | undefined)?.questions ?? []) as Question[];
  const answers = (attempt.answers ?? []) as {question_id: string; value: unknown}[];
  const files = (attempt.files ?? []) as { id: string; question_id: string; filename: string }[];
  const rows = questions.length ? questions.map(question => ({question, answer: answers.find(answer => answer.question_id === question.id)})) : answers.map(answer => ({question: undefined, answer}));
  const visible = questionId ? rows.filter(row => (row.question?.id ?? row.answer?.question_id) === questionId) : rows;
  return <section className="review">{!questionId && <><h3>Student answers</h3><p>{formatStatus(attempt.status)}</p></>}{visible.length ? visible.map(({question, answer}, index) => <article className="question-editor" key={question?.id ?? answer!.question_id}>
    <h3>{question ? questions.indexOf(question) + 1 : index + 1}. {question?.prompt || "Written answer"}</h3>
    {question && <p>Available points: {question.points}</p>}
    <p className="preserve">{question?.type === "file_upload" ? (files.some(file => file.question_id === question.id) ? "Attached files:" : "No files attached") : answerText(answer?.value, question)}</p>
    {files.filter(file => file.question_id === (question?.id ?? answer?.question_id)).map(file => <a className="text-link" key={file.id} href={`/api/v1/submissions/${attempt.id}/files/${file.id}`} onClick={event => { event.preventDefault(); download?.(`/api/v1/submissions/${attempt.id}/files/${file.id}`, file.filename); }}>{file.filename}</a>)}
  </article>) : <p>No answers have been saved.</p>}</section>;
}
