'use client';
// src/components/admin/MessagesDrawer.tsx
// ============================================================
// Slide-out panel (MessagesWidget). Two panes from sm up: conversations on
// the left, the open thread (or a new chat) on the right; on a phone it is
// one pane at a time with a Back button. Admin-initiated
// only — the "New chat" button (compose view) is hidden for anyone who
// isn't Admin, but every participant can reply once a thread exists.
//
// Realtime nudges live at the widget level (one shared subscription,
// see MessagesWidget) and invalidate the ['messages', ...] query keys
// used here — this component just reacts to whatever React Query hands
// it, the same "on-change nudge, not a poll loop" shape as PrepressTodoPanel.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Send, X, Tag, Plus, Check, Search } from 'lucide-react';
import { format, formatDistanceToNowStrict, isToday, isYesterday } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import type { ConversationDetail, ConversationSummary } from '@/lib/types';
import { useTeamDirectory, type DirectoryPerson } from '@/hooks/useReferenceData';
import { MentionText, MentionTextarea } from '@/components/ui/Mention';
import { initials } from '@/lib/team';
import { DesktopNotificationsToggle } from '@/components/ui/DesktopNotificationsToggle';

type Props = {
  userEmail:    string;
  isSuperAdmin: boolean;
  onClose:      () => void;
  /** Open on this thread — set when the drawer is opened from a message alert. */
  initialConversationId?: string | null;
};

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}

/** "11:42" today, "Yesterday", else "Tue" this week or "03 Oct". */
function listTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  return Date.now() - d.getTime() < 6 * 86_400_000 ? format(d, 'EEE') : format(d, 'dd MMM');
}

function dayHeading(iso: string): string {
  const d = new Date(iso);
  return isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'dd MMM yyyy');
}

const AVATAR = ['#7e22ce', '#0e7490', '#4338ca', '#047857', '#10553F', '#b45309'];
function avatarColour(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR[h % AVATAR.length];
}

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-xl font-mono text-xs font-semibold text-white"
      style={{ width: size, height: size, background: avatarColour(name) }}
    >
      {initials(name)}
    </span>
  );
}

/** Everyone in the thread except me — what a list row/thread header shows. */
function otherParticipants(c: { participants: { member_email: string }[] }, userEmail: string) {
  return c.participants.filter((p) => p.member_email !== userEmail).map((p) => p.member_email);
}

export default function MessagesDrawer({ userEmail, isSuperAdmin, onClose, initialConversationId = null }: Props) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId);
  const [draft,       setDraft]     = useState('');
  const [listQuery,   setListQuery] = useState('');
  const [sending,     setSending]   = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // ── New-chat view: opened from the header's "New chat" button. Pick
  // people from the list (or type to filter), then type the message in the
  // bottom composer — same place the reply box sits in a thread. Reuses an
  // existing thread with that exact recipient set if one exists, otherwise
  // starts a new one.
  const [composing,    setComposing]    = useState(false);
  const [recipients,   setRecipients]   = useState<DirectoryPerson[]>([]);
  const [toValue,      setToValue]      = useState('');
  const [activeIndex,  setActiveIndex]  = useState(0);
  const [messageText,  setMessageText]  = useState('');
  const [sendingNew,   setSendingNew]   = useState(false);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);
  const toRef = useRef<HTMLInputElement>(null);

  // Everyone's username, for names in the list and thread. Starting a chat
  // stays an Admin action, so only Admin gets people to pick from.
  const { people, nameOf } = useTeamDirectory();
  const members = useMemo(() => (isSuperAdmin ? people : []), [isSuperAdmin, people]);
  const namesOf = (emails: string[]) => emails.map((e) => nameOf(e)).join(', ');

  const { data: conversations = [], isLoading: listLoading } = useQuery({
    queryKey: ['messages', 'conversations'],
    queryFn: async () => {
      const res = await fetch('/api/messages/conversations', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load conversations');
      const data = await res.json();
      return data.conversations as ConversationSummary[];
    },
    refetchOnWindowFocus: true,
  });

  const { data: thread, isLoading: threadLoading } = useQuery({
    queryKey: ['messages', 'conversation', selectedId],
    queryFn: async () => {
      const res = await fetch(`/api/messages/conversations/${selectedId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load conversation');
      const data = await res.json();
      return data.conversation as ConversationDetail;
    },
    enabled: !!selectedId,
  });

  // Opening a thread marks it read — the server only ever touches the
  // caller's own participant row (RLS), so this can't affect anyone else.
  useEffect(() => {
    if (!selectedId) return;
    fetch(`/api/messages/conversations/${selectedId}/read`, { method: 'POST' })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['messages', 'unread-count'] });
        queryClient.invalidateQueries({ queryKey: ['messages', 'conversations'] });
      })
      .catch(() => { /* best-effort — the badge just stays stale until the next nudge */ });
  }, [selectedId, queryClient]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' });
  }, [thread?.messages.length]);

  // Close on Escape / outside click — same transient-overlay behaviour as
  // NotesFeed and PrepressTodoPanel.
  useEffect(() => {
    // Escape backs out of the new-chat view first, then closes the drawer.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (composing) closeCompose(); else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, composing]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  async function sendReply() {
    const text = draft.trim();
    if (!text || !selectedId || sending) return;

    setSending(true);
    try {
      const res = await fetch(`/api/messages/conversations/${selectedId}/messages`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ body: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to send');
        return;
      }
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['messages', 'conversation', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['messages', 'conversations'] });
    } catch {
      toast.error('Network error');
    } finally {
      setSending(false);
    }
  }

  // Filter text for the people list — a leading "@" is tolerated so the
  // old muscle memory still works.
  const memberQuery = toValue.replace(/^@/, '').trim().toLowerCase();

  const filteredMembers = useMemo(() => {
    if (!composing) return [];
    return members
      .filter((m) => m.email !== userEmail)
      .filter((m) => memberQuery === '' || m.username.includes(memberQuery) || m.email.toLowerCase().includes(memberQuery) || (m.department ?? '').toLowerCase().includes(memberQuery));
  }, [composing, members, memberQuery, userEmail]);

  useEffect(() => { setActiveIndex(0); }, [memberQuery]);

  useEffect(() => {
    if (composing) toRef.current?.focus();
  }, [composing]);

  function openCompose() {
    setSelectedId(null);
    setComposing(true);
  }

  function closeCompose() {
    setComposing(false);
    setRecipients([]);
    setToValue('');
    setMessageText('');
  }

  // Tapping a person toggles them in/out of the recipient set.
  function selectMember(m: DirectoryPerson) {
    setRecipients((prev) => (prev.some((r) => r.id === m.id) ? prev.filter((r) => r.id !== m.id) : [...prev, m]));
    setToValue('');
  }

  function removeRecipient(id: string) {
    setRecipients((prev) => prev.filter((r) => r.id !== id));
  }

  function onToKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && toValue === '' && recipients.length > 0) {
      setRecipients((prev) => prev.slice(0, -1));
      return;
    }
    if (filteredMembers.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => (i + 1) % filteredMembers.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => (i - 1 + filteredMembers.length) % filteredMembers.length); }
    else if (e.key === 'Enter') { e.preventDefault(); selectMember(filteredMembers[activeIndex] ?? filteredMembers[0]); }
  }

  function onMessageKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendNew(); }
  }

  // Reuses the existing thread if its participant set (minus me) matches
  // the tagged recipients exactly; otherwise starts a new one. Same two
  // endpoints the drawer already uses for replying / the old compose modal.
  async function sendNew() {
    const text = messageText.trim();
    if (!text || recipients.length === 0 || sendingNew) return;

    setSendingNew(true);
    try {
      const targetEmails = new Set(recipients.map((r) => r.email));
      const existing = conversations.find((c) => {
        const others = otherParticipants(c, userEmail);
        return others.length === targetEmails.size && others.every((e) => targetEmails.has(e));
      });

      const res = existing
        ? await fetch(`/api/messages/conversations/${existing.conversation_id}/messages`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ body: text }),
          })
        : await fetch('/api/messages/conversations', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ recipientIds: recipients.map((r) => r.id), body: text }),
          });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to send');
        return;
      }

      const targetId = existing ? existing.conversation_id : data.conversation.id;
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      closeCompose();
      setSelectedId(targetId);
    } catch {
      toast.error('Network error');
    } finally {
      setSendingNew(false);
    }
  }

  const selectedSummary = conversations.find((c) => c.conversation_id === selectedId);
  const threadName = selectedSummary ? namesOf(otherParticipants(selectedSummary, userEmail)) || 'You' : 'Conversation';

  const q = listQuery.trim().toLowerCase();
  const shownConversations = q
    ? conversations.filter((c) =>
        otherParticipants(c, userEmail).some((e) => e.toLowerCase().includes(q) || nameOf(e).includes(q))
        || (c.subject ?? '').toLowerCase().includes(q)
        || (c.last_message_body ?? '').toLowerCase().includes(q))
    : conversations;

  // Which pane a phone shows; from sm up both are on screen.
  const rightOpen = Boolean(selectedId || composing);

  const iconBtn = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-[#F1F5F2] text-brand-ink hover:bg-brand-surface-hover';

  return (
    <section
      ref={panelRef}
      aria-label="Team messages"
      className="fixed right-0 top-14 z-50 flex h-[calc(100dvh-3.5rem)] w-full bg-white shadow-[-18px_0_50px_rgba(12,42,32,0.18)] sm:w-[min(760px,100vw)]"
    >
      {/* ── Left: conversations ─────────────────────────────── */}
      <div className={cn('w-full flex-col border-brand-line-soft sm:flex sm:w-[300px] sm:shrink-0 sm:border-r', rightOpen ? 'hidden' : 'flex')}>
        <div className="flex flex-col gap-3 px-4 pb-3 pt-[18px]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-brand-ink">Messages</h2>
            <div className="flex items-center gap-1.5">
              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={openCompose}
                  aria-label="New message"
                  title="New message"
                  className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-brand-primary text-white hover:bg-brand-primary-hover"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              <button type="button" onClick={onClose} aria-label="Close messages" className={cn(iconBtn, 'sm:hidden')}>
                <X className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            </div>
          </div>
          <label className="flex h-10 items-center gap-2 rounded-[10px] bg-brand-surface-alt px-3 text-brand-muted">
            <Search className="h-[15px] w-[15px]" aria-hidden="true" />
            <span className="sr-only">Search conversations</span>
            <input
              value={listQuery}
              onChange={(e) => setListQuery(e.target.value)}
              placeholder="Search people"
              className="min-w-0 flex-1 bg-transparent text-sm text-brand-ink outline-none placeholder:text-brand-muted"
            />
          </label>
          <DesktopNotificationsToggle />
        </div>

        <ul className="flex-1 overflow-y-auto">
          {listLoading && <li className="px-4 py-8 text-center text-xs text-brand-muted">Loading…</li>}
          {!listLoading && conversations.length === 0 && (
            <li className="px-4 py-8 text-center text-xs text-brand-muted">
              {isSuperAdmin
                ? 'No conversations yet — use + to message someone.'
                : 'No conversations yet. Messages Admin sends you will show up here.'}
            </li>
          )}
          {!listLoading && conversations.length > 0 && shownConversations.length === 0 && (
            <li className="px-4 py-8 text-center text-xs text-brand-muted">No one matches “{listQuery}”.</li>
          )}
          {shownConversations.map((c) => {
            const name = namesOf(otherParticipants(c, userEmail)) || 'You';
            const on = c.conversation_id === selectedId;
            return (
              <li key={c.conversation_id}>
                <button
                  type="button"
                  onClick={() => { closeCompose(); setSelectedId(c.conversation_id); }}
                  aria-current={on ? 'true' : undefined}
                  className={cn('flex w-full items-center gap-3 px-4 py-3 text-left transition-colors', on ? 'bg-brand-surface-hover' : 'hover:bg-brand-surface-alt')}
                >
                  <Avatar name={name} />
                  <span className="min-w-0 flex-1">
                    <span className="flex justify-between gap-2">
                      <b className="truncate text-sm text-brand-ink">{name}</b>
                      <span className="shrink-0 font-mono text-[11px] text-brand-muted">{listTime(c.last_message_at ?? c.created_at)}</span>
                    </span>
                    <span className="block truncate text-[13px] text-brand-muted">
                      {c.last_message_sender_email === userEmail ? 'You: ' : ''}{c.last_message_body ?? c.subject ?? ''}
                    </span>
                  </span>
                  {c.unread_count > 0 && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-primary px-1.5 font-mono text-[11px] font-semibold text-white">
                      {c.unread_count > 99 ? '99+' : c.unread_count}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ── Right: thread, new chat, or a prompt ────────────── */}
      <div className={cn('min-w-0 flex-1 flex-col sm:flex', rightOpen ? 'flex' : 'hidden')}>
        <div className="flex min-h-[72px] items-center justify-between gap-3 border-b border-brand-line-soft py-3.5 pl-3 pr-4 sm:pl-5">
          <div className="flex min-w-0 items-center gap-3">
            {rightOpen && (
              <button
                type="button"
                onClick={() => (composing ? closeCompose() : setSelectedId(null))}
                aria-label="Back to conversations"
                className={cn(iconBtn, 'sm:hidden')}
              >
                <ArrowLeft className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            )}
            {selectedId && !composing && <Avatar name={threadName} />}
            <div className="min-w-0">
              <b className="block truncate text-[15px] text-brand-ink">
                {composing ? 'New message' : selectedId ? threadName : 'Messages'}
              </b>
              {selectedId && !composing && selectedSummary?.subject && (
                <span className="block truncate text-xs text-brand-muted">{selectedSummary.subject}</span>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close messages" className={iconBtn}>
            <X className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </div>

        {!rightOpen && (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-brand-muted">
            {conversations.length ? 'Pick a conversation to read it.' : isSuperAdmin ? 'Start one with +.' : 'Nothing here yet.'}
          </div>
        )}
      {/* ── New-chat view ───────────────────────────────────────
          Opened from the header button. "To" field with chips on top,
          the people list in the middle (tap to add/remove), and the
          message box pinned to the bottom like a thread's reply box. */}
      {composing && (
        <>
          <div className="px-4 pt-3 pb-2 border-b border-brand-border shrink-0">
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-brand-border bg-brand-bg px-2 py-1.5 focus-within:ring-2 focus-within:ring-brand-primary/40 transition-shadow">
              <span className="text-xs font-medium text-brand-muted pl-1">To:</span>
              {recipients.map((r) => (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-primary/10 text-brand-primary text-xs font-medium pl-2 pr-1 py-1"
                >
                  {r.username}
                  <button
                    type="button"
                    onClick={() => removeRecipient(r.id)}
                    aria-label={`Remove ${r.username}`}
                    className="rounded-full hover:bg-brand-primary/20 p-0.5"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
              <input
                ref={toRef}
                type="text"
                value={toValue}
                onChange={(e) => setToValue(e.target.value)}
                onKeyDown={onToKeyDown}
                placeholder={recipients.length === 0 ? 'Search name or department…' : 'Add another…'}
                aria-label="Search people"
                className="flex-1 min-w-[120px] bg-transparent text-sm text-brand-ink placeholder:text-brand-muted focus:outline-none py-1 min-h-[28px]"
              />
            </div>
          </div>

          <ul className="flex-1 overflow-y-auto divide-y divide-brand-border" aria-label="People">
            {filteredMembers.length === 0 && (
              <li className="px-4 py-8 text-center text-xs text-brand-muted">
                {members.length === 0 ? 'Loading…' : 'No one matches that search.'}
              </li>
            )}
            {filteredMembers.map((m, i) => {
              const picked = recipients.some((r) => r.id === m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => selectMember(m)}
                    aria-pressed={picked}
                    className={cn(
                      'w-full min-h-11 text-left px-4 py-2.5 flex items-center justify-between gap-2 transition-colors focus:outline-none focus-visible:bg-brand-bg',
                      i === activeIndex && toValue !== '' ? 'bg-brand-bg' : 'hover:bg-brand-bg',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-brand-ink truncate">{m.username}</span>
                      <span className="block text-[10px] text-brand-muted truncate">{m.email}</span>
                      {m.department && (
                        <span className="block text-[10px] font-mono text-brand-muted">{m.department}</span>
                      )}
                    </span>
                    <span
                      className={cn(
                        'h-5 w-5 shrink-0 rounded-full border flex items-center justify-center transition-colors',
                        picked ? 'bg-brand-primary border-brand-primary text-white' : 'border-brand-border',
                      )}
                      aria-hidden="true"
                    >
                      {picked && <Check className="h-3 w-3" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-brand-border p-3 shrink-0">
            <div className="flex items-end gap-2">
              <MentionTextarea
                inputRef={messageRef}
                wrapperClassName="flex-1"
                value={messageText}
                onValueChange={setMessageText}
                onKeyDown={onMessageKeyDown}
                disabled={recipients.length === 0}
                placeholder={recipients.length === 0 ? 'Pick someone first…' : 'Type your message…'}
                rows={1}
                className="resize-none max-h-28 rounded-lg border border-brand-border bg-brand-bg px-3 py-2 text-sm text-brand-ink placeholder:text-brand-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40 disabled:opacity-60"
              />
              <button
                onClick={sendNew}
                disabled={!messageText.trim() || recipients.length === 0 || sendingNew}
                aria-label="Send message"
                className="min-h-11 min-w-11 rounded-lg bg-brand-primary text-white flex items-center justify-center hover:bg-brand-primary-hover disabled:opacity-40 transition-colors"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Thread ───────────────────────────────────────────── */}
      {selectedId && (
        <>
          <ul className="flex flex-1 flex-col gap-2.5 overflow-y-auto bg-[#FBFCFB] p-5">
            {threadLoading && (
              <li className="py-8 text-center text-xs text-brand-muted">Loading…</li>
            )}
            {thread?.messages.map((m, i) => {
              const mine = m.sender_email === userEmail;
              const prev = thread.messages[i - 1];
              const newDay = !prev || dayHeading(prev.created_at) !== dayHeading(m.created_at);
              return (
                <li key={m.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                  {newDay && (
                    <span className="self-center py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-brand-muted">{dayHeading(m.created_at)}</span>
                  )}
                  <div className={cn('max-w-[76%] rounded-2xl px-3.5 py-2.5', mine ? 'rounded-br-md bg-brand-primary text-white' : 'rounded-bl-md bg-[#F1F5F2] text-brand-ink')}>
                    <p className="whitespace-pre-wrap break-words text-sm leading-normal"><MentionText text={m.body} tagClassName={mine ? 'font-semibold underline decoration-white/50 underline-offset-2' : undefined} /></p>
                    {m.job && (
                      <Link
                        href={`/admin/jobs/${m.job.id}`}
                        onClick={onClose}
                        className={cn(
                          'mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-mono',
                          mine ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-white border border-brand-border text-brand-primary hover:bg-brand-bg',
                        )}
                      >
                        <Tag className="h-3 w-3" aria-hidden="true" />
                        {m.job.job_card_number ?? m.job.po_number}
                      </Link>
                    )}
                  </div>
                  <time className="mt-1 text-[11px] text-brand-muted" title={relativeTime(m.created_at)}>
                    {mine ? 'You' : nameOf(m.sender_email)} · <span className="font-mono">{format(new Date(m.created_at), 'HH:mm')}</span>
                  </time>
                </li>
              );
            })}
            <div ref={threadEndRef} />
          </ul>

          <div className="border-t border-brand-border p-3 shrink-0">
            <div className="flex items-end gap-2">
              <MentionTextarea
                wrapperClassName="flex-1"
                value={draft}
                onValueChange={setDraft}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendReply();
                  }
                }}
                placeholder="Reply… type @ to tag someone"
                rows={1}
                className="resize-none max-h-28 rounded-lg border border-brand-border bg-brand-bg px-3 py-2 text-sm text-brand-ink placeholder:text-brand-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
              />
              <button
                onClick={sendReply}
                disabled={!draft.trim() || sending}
                aria-label="Send reply"
                className="min-h-11 min-w-11 rounded-lg bg-brand-primary text-white flex items-center justify-center hover:bg-brand-primary-hover disabled:opacity-40 transition-colors"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}
      </div>
    </section>
  );
}
