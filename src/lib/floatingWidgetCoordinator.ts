// src/lib/floatingWidgetCoordinator.ts
// Keeps the bottom-right floating widgets (chat/NotesFeed, Prepress To-Do,
// Meter Calculator) mutually exclusive — opening one closes any other that's
// open, like a single-open accordion. They're independent components
// mounted in different subtrees (NotesFeed lives in the admin layout,
// To-Do/Meter Calculator live inside JobSeparationManager), so there's no
// shared ancestor to hold this in React state — a tiny module-level pub/sub
// is the simplest thing that works across all of them.

type Listener = (openId: string | null) => void;

let activeId: string | null = null;
const listeners = new Set<Listener>();

/** Call when a widget opens — closes whichever other widget was open. */
export function requestOpen(id: string): void {
  activeId = id;
  listeners.forEach((fn) => fn(activeId));
}

/** Subscribe to changes in which widget is open. Returns an unsubscribe fn. */
export function subscribeActiveWidget(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
