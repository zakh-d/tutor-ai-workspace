from typing import Annotated, Literal, Any
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, model_validator, AwareDatetime

class Strict(BaseModel):
    model_config=ConfigDict(extra='forbid')
class Student(Strict):
    display_name: str=Field(min_length=1,max_length=200)
    contact: dict[str,str]|None=None
    subject: str|None=None
    level: str|None=None
    goals: str|None=None
    notes: str|None=None
class Lesson(Strict):
    student_id: UUID
    title: str=Field(min_length=1,max_length=200)
    plan: str|None=None
    notes: str|None=None
    status: Literal['planned','completed','cancelled']='planned'
    material_ids: list[UUID]=Field(default_factory=list,max_length=100)
class Task(Strict):
    title: str=Field(min_length=1,max_length=200)
    description: str|None=None
    due_at: AwareDatetime|None=None
    status: Literal['todo','in_progress','done']='todo'
    student_id: UUID|None=None
    lesson_id: UUID|None=None
class Material(Strict):
    title: str=Field(min_length=1,max_length=200)
    description: str|None=None
    tags: list[str]=Field(default_factory=list,max_length=50)
    student_ids: list[UUID]=Field(default_factory=list,max_length=100)
    lesson_ids: list[UUID]=Field(default_factory=list,max_length=100)
class SourceRef(Strict):
    material_id: UUID
    material_version_id: UUID
    artifact_id: UUID
    chunk_start: int=Field(ge=0)
    chunk_end: int=Field(ge=0)
class Option(Strict):
    id: UUID
    text: str=Field(min_length=1,max_length=2000)
class Question(Strict):
    id: UUID
    type: Literal['single_choice','multiple_choice','written_response','file_upload']
    prompt: str=Field(min_length=1,max_length=10000)
    points: int=Field(ge=0,le=100,strict=True)
    required: bool=True
    source_refs: list[SourceRef]=Field(default_factory=list)
    options: list[Option]|None=None
    correct_option_id: UUID|None=None
    correct_option_ids: list[UUID]|None=None
    rubric: str|None=None
    max_chars: int=Field(default=10000,ge=1,le=10000)
    allowed_types: list[str]=Field(default_factory=lambda:['pdf','docx','txt','png','jpg'])
    max_files: int=Field(default=5,ge=1,le=5)
    @model_validator(mode='after')
    def validate_shape(self):
        if self.type in ('single_choice','multiple_choice'):
            opts={o.id for o in self.options or []}
            if not 2<=len(opts)<=10 or len(opts)!=len(self.options or []): raise ValueError('Provide 2–10 uniquely identified options')
            if self.type=='single_choice' and self.correct_option_id not in opts: raise ValueError('Correct option must exist')
            if self.type=='multiple_choice' and (not self.correct_option_ids or len(set(self.correct_option_ids))!=len(self.correct_option_ids) or not set(self.correct_option_ids)<=opts): raise ValueError('Correct options must be a unique nonempty subset')
        else:
            if self.rubric is None: raise ValueError('Rubric is required')
        if not set(self.allowed_types)<={'pdf','docx','txt','png','jpg','jpeg'}: raise ValueError('Unsupported file type')
        return self
class Homework(Strict):
    title: str=Field(min_length=1,max_length=200)
    instructions: str=Field(max_length=200000)
    questions: list[Question]=Field(max_length=100)
    source_refs: list[SourceRef]=Field(default_factory=list)
    @model_validator(mode='after')
    def unique_questions(self):
        if len({q.id for q in self.questions})!=len(self.questions): raise ValueError('Question IDs must be unique')
        return self
class Card(Strict):
    @model_validator(mode='after')
    def nonblank(self):
        if not self.term.strip() or not self.definition.strip():raise ValueError('Card fields cannot be blank')
        return self
    term: str=Field(min_length=1,max_length=2000)
    definition: str=Field(min_length=1,max_length=2000)
class Flashcards(Strict):
    title: str=Field(min_length=1,max_length=200)
    cards: list[Card]=Field(max_length=500)
    source_refs: list[SourceRef]=Field(default_factory=list)
    lesson_id: UUID|None=None
class Publish(Strict):
    student_id: UUID
    lesson_id: UUID|None=None
    due_at: AwareDatetime|None=None
    expires_at: AwareDatetime|None=None
    public_attachment_ids: list[UUID]=Field(default_factory=list,max_length=20)
class AssignmentPatch(Strict):
    due_at: AwareDatetime|None=None
    status: Literal['open','closed']|None=None
class Answer(Strict):
    question_id: UUID
    value: Any
class Answers(Strict):
    answers: list[Answer]=Field(max_length=100)
class AssessmentItem(Strict):
    question_id: UUID
    awarded_points: int=Field(ge=0,le=100,strict=True)
    feedback: str=Field(max_length=10000)
class Assessment(Strict):
    items: list[AssessmentItem]=Field(max_length=100)
    overall_feedback: str=Field(max_length=20000)
class Proposal(Assessment):
    expected_submission_revision: int=Field(ge=1)
class Release(Strict):
    proposal_id: UUID
    expected_proposal_revision: int=Field(ge=1)
    expected_submission_revision: int=Field(ge=1)
    expected_assignment_revision: int=Field(ge=1)
    assessment: Assessment|None=None
class Exchange(Strict): token: str=Field(min_length=20,max_length=200)
class ReplaceAccess(Strict): expires_at: AwareDatetime|None=None
class Undo(Strict):
    target_revision_id: UUID
    expected_current_revision: int=Field(ge=1)
class Markdown(Strict):
    source_artifact_id: UUID
    markdown: str=Field(min_length=1,max_length=200000)
class RetryConversion(Strict): version_id: UUID
class WorkspacePatch(Strict):
    name: str|None=Field(default=None,min_length=1,max_length=200)
    timezone: str|None=None

SCHEMAS={'students':Student,'lessons':Lesson,'tasks':Task,'materials':Material,'homework-templates':Homework,'flashcard-sets':Flashcards}
