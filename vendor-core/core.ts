// Pure domain code: no SDK, environment, filesystem, clock or networking.
export type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'rejected' | 'unknown';
export interface Job { id: string; target: string; text: string; status: DeliveryStatus; updated: number }
export interface Session { answers: string[]; expires: number; version: number }
export interface RecordState {
  version: number;
  seen: { id: string; at: number }[];
  session: Session | null;
  submissions: { id: string; at: number; lead: unknown; jobs: Job[] }[];
  rate: { start: number; count: number };
  expires_at: number;
}
export interface Event { id: string; now: number }
export const DAY = 86400000;
export function initial(now: number): RecordState {
  return { version: 0, seen: [], session: null, submissions: [], rate: { start: now, count: 0 }, expires_at: now + 90 * DAY };
}
// One atomic document update includes deduplication, state, lead and every delivery intent.
// Caller MUST commit this document before acknowledging the webhook or calling send().
export function receive(previous: RecordState | null, event: Event,
  decide: (state: RecordState) => void): { state: RecordState; duplicate: boolean } {
  if (!event.id || event.id.length > 256 || !Number.isFinite(event.now)) throw new Error('invalid_event');
  const state: RecordState = JSON.parse(JSON.stringify(previous ?? initial(event.now)));
  state.seen = state.seen.filter(x => x.at > event.now - 7 * DAY);
  state.submissions = state.submissions.filter(x => x.at > event.now - 90 * DAY);
  if (state.seen.some(x => x.id === event.id)) return { state, duplicate: true };
  if (state.seen.length >= 2000 || state.submissions.length >= 100) throw new Error('record_capacity');
  if (state.session && state.session.expires <= event.now) state.session = null;
  if (event.now - state.rate.start >= 10000) state.rate = { start: event.now, count: 0 };
  if (state.rate.count >= 10) throw new Error('rate_limited');
  state.rate.count++;
  decide(state);
  state.seen.push({ id: event.id, at: event.now });
  state.version++;
  state.expires_at = event.now + 90 * DAY;
  if (JSON.stringify(state).length > 150000) throw new Error('record_capacity');
  return { state, duplicate: false };
}
export function quizStep(state: RecordState, step: number, answers: string[], options: string[][], now: number): void {
  if (!Number.isInteger(step) || step < 0 || step > options.length || answers.length !== step ||
    answers.some((a, i) => !options[i]?.includes(a))) throw new Error('invalid_quiz_step');
  if (step > 0 && (!state.session || state.session.answers.length !== step - 1 ||
    !state.session.answers.every((a, i) => a === answers[i]))) throw new Error('stale_quiz_step');
  state.session = { answers, expires: now + 3600000, version: (state.session?.version ?? 0) + 1 };
}
export function submit(state: RecordState, id: string, lead: unknown,
  messages: { target: string; text: string }[], now: number): void {
  if (!state.session || state.session.expires <= now) throw new Error('session_required');
  if (messages.length < 1 || messages.length > 10 || messages.some(x => !x.target || !x.text || x.text.length > 4000))
    throw new Error('invalid_delivery');
  state.submissions.push({ id, at: now, lead, jobs: messages.map((x, i) => ({ ...x, id: `${id}:${i}`, status: 'pending', updated: now })) });
  state.session = null;
}
export function claim(state: RecordState, jobId: string, now: number): Job | null {
  const job = state.submissions.flatMap(x => x.jobs).find(x => x.id === jobId);
  if (!job || job.status !== 'pending') return null;
  job.status = 'sending'; job.updated = now;
  return { ...job };
}
export function finish(state: RecordState, jobId: string, status: 'sent' | 'rejected' | 'unknown', now: number): void {
  const job = state.submissions.flatMap(x => x.jobs).find(x => x.id === jobId);
  if (!job || job.status !== 'sending') throw new Error('delivery_not_claimed');
  job.status = status; job.updated = now;
}
// A crashed sender is ambiguous. It must never be automatically returned to pending.
export function recover(state: RecordState, now: number): void {
  for (const job of state.submissions.flatMap(x => x.jobs))
    if (job.status === 'sending' && now - job.updated > 60000) { job.status = 'unknown'; job.updated = now; }
}
export function retryRejected(state: RecordState, jobId: string, now: number): void {
  const job = state.submissions.flatMap(x => x.jobs).find(x => x.id === jobId);
  if (!job || job.status !== 'rejected') throw new Error('only_explicit_rejection_can_retry');
  job.status = 'pending'; job.updated = now;
}
