export function requireAssignmentIdentity(requestedId: string, receivedId: string) {
  if (receivedId !== requestedId) {
    throw new Error(
      "This browser has another assignment open. Reopen your tutor’s link to continue.",
    );
  }
}

export function canEditAssignment(assignmentStatus: string, attemptStatus: string) {
  return assignmentStatus === "open" && attemptStatus === "draft";
}

type RequiredQuestion = { id: string; required: boolean };

export function requiresAnswer(question: RequiredQuestion, answers: Record<string, unknown>) {
  const value = answers[question.id];
  return question.required && (Array.isArray(value) ? value.length === 0 : typeof value !== "string" || !value.trim());
}

export function firstUnansweredQuestion(questions: RequiredQuestion[], answers: Record<string, unknown>, submit: boolean) {
  return submit ? questions.findIndex(question => requiresAnswer(question, answers)) : -1;
}
