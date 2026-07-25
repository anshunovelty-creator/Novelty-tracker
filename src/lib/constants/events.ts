// src/lib/constants/events.ts
// ============================================================
// Window event names used to nudge sibling client components that hold their
// own copy of server data. Declared once here — a typo in either the dispatcher
// or the listener would fail silently.
// ============================================================

/**
 * A job changed outside the jobs table — currently the machine board carrying a
 * stage forward on Start / Complete. JobsTable listens and refetches.
 */
export const JOBS_CHANGED_EVENT = 'novelty:jobs-changed';
