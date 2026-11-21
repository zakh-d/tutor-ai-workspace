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
