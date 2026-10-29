"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retryRejected = exports.recover = exports.finish = exports.claim = exports.submit = exports.quizStep = exports.receive = exports.initial = exports.DAY = void 0;
exports.DAY = 86400000;
function initial(now) {
    return { version: 0, seen: [], session: null, submissions: [], rate: { start: now, count: 0 }, expires_at: now + 90 * exports.DAY };
}
exports.initial = initial;
// One atomic document update includes deduplication, state, lead and every delivery intent.
// Caller MUST commit this document before acknowledging the webhook or calling send().
function receive(previous, event, decide) {
    if (!event.id || event.id.length > 256 || !Number.isFinite(event.now))
        throw new Error('invalid_event');
    const state = JSON.parse(JSON.stringify(previous ?? initial(event.now)));
    state.seen = state.seen.filter(x => x.at > event.now - 7 * exports.DAY);
    state.submissions = state.submissions.filter(x => x.at > event.now - 90 * exports.DAY);
    if (state.seen.some(x => x.id === event.id))
        return { state, duplicate: true };
    if (state.seen.length >= 2000 || state.submissions.length >= 100)
        throw new Error('record_capacity');
    if (state.session && state.session.expires <= event.now)
        state.session = null;
    if (event.now - state.rate.start >= 10000)
        state.rate = { start: event.now, count: 0 };
    if (state.rate.count >= 10)
        throw new Error('rate_limited');
    state.rate.count++;
    decide(state);
    state.seen.push({ id: event.id, at: event.now });
    state.version++;
    state.expires_at = event.now + 90 * exports.DAY;
    if (JSON.stringify(state).length > 150000)
        throw new Error('record_capacity');
    return { state, duplicate: false };
}
exports.receive = receive;
function quizStep(state, step, answers, options, now) {
    if (!Number.isInteger(step) || step < 0 || step > options.length || answers.length !== step ||
        answers.some((a, i) => !options[i]?.includes(a)))
        throw new Error('invalid_quiz_step');
    if (step > 0 && (!state.session || state.session.answers.length !== step - 1 ||
        !state.session.answers.every((a, i) => a === answers[i])))
        throw new Error('stale_quiz_step');
    state.session = { answers, expires: now + 3600000, version: (state.session?.version ?? 0) + 1 };
}
exports.quizStep = quizStep;
function submit(state, id, lead, messages, now) {
    if (!state.session || state.session.expires <= now)
        throw new Error('session_required');
    if (messages.length < 1 || messages.length > 10 || messages.some(x => !x.target || !x.text || x.text.length > 4000))
        throw new Error('invalid_delivery');
    state.submissions.push({ id, at: now, lead, jobs: messages.map((x, i) => ({ ...x, id: `${id}:${i}`, status: 'pending', updated: now })) });
    state.session = null;
}
exports.submit = submit;
function claim(state, jobId, now) {
    const job = state.submissions.flatMap(x => x.jobs).find(x => x.id === jobId);
    if (!job || job.status !== 'pending')
        return null;
    job.status = 'sending';
    job.updated = now;
    return { ...job };
}
exports.claim = claim;
function finish(state, jobId, status, now) {
    const job = state.submissions.flatMap(x => x.jobs).find(x => x.id === jobId);
    if (!job || job.status !== 'sending')
        throw new Error('delivery_not_claimed');
    job.status = status;
    job.updated = now;
}
exports.finish = finish;
// A crashed sender is ambiguous. It must never be automatically returned to pending.
function recover(state, now) {
    for (const job of state.submissions.flatMap(x => x.jobs))
        if (job.status === 'sending' && now - job.updated > 60000) {
            job.status = 'unknown';
            job.updated = now;
        }
}
exports.recover = recover;
function retryRejected(state, jobId, now) {
    const job = state.submissions.flatMap(x => x.jobs).find(x => x.id === jobId);
    if (!job || job.status !== 'rejected')
        throw new Error('only_explicit_rejection_can_retry');
    job.status = 'pending';
    job.updated = now;
}
exports.retryRejected = retryRejected;
