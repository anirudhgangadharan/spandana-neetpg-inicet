-- Server-observed position transitions support bounded, explicitly estimated
-- per-question time analytics. The browser never supplies timestamps/durations.
alter table faculty_module_attempts
  add column if not exists activity_position smallint
    check (activity_position between 1 and 200),
  add column if not exists activity_observed_at timestamptz;

alter table faculty_module_attempts
  add constraint faculty_module_attempts_activity_question_fk
  foreign key (module_id, activity_position)
  references faculty_module_questions (module_id, position)
  on delete cascade;

create index if not exists faculty_attempts_module_student_final_idx
  on faculty_module_attempts (module_id, student_user_id, attempt_number desc)
  where status in ('submitted', 'expired');

create index if not exists faculty_responses_attempt_position_idx
  on faculty_module_responses (attempt_id, position);
