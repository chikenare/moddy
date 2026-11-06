import { defineStore } from "pinia";
import { ref } from "vue";
import { api, type AutoReply, type ChatRecord, type ChatSettings, type EventRecord, type FormattedMessage, type NightMode, type NightModeSettings, type StaffMember } from "@/lib/api";
import { t } from "@/i18n";

export function useChatDetailStore(id: number) {
  return defineStore(`chatDetail:${id}`, () => {
    const chat = ref<ChatRecord | null>(null);
    const words = ref<string[]>([]);
    const whitelist = ref<string[]>([]);
    const staff = ref<StaffMember[]>([]);
    const autoReplies = ref<AutoReply[]>([]);
    const events = ref<EventRecord[]>([]);
    const nextBefore = ref<number | null>(null);
    const nightMode = ref<NightMode | null>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);

    async function load() {
      loading.value = true;
      error.value = null;
      try {
        const [c, w, wl, ev, st, ar, nm] = await Promise.all([
          api.getChat(id), api.listWords(id), api.listWhitelist(id), api.listEvents(id), api.listStaff(id), api.listAutoReplies(id),
          api.getNightMode(id),
        ]);
        chat.value = c;
        words.value = w;
        whitelist.value = wl;
        staff.value = st;
        autoReplies.value = ar;
        events.value = ev.events;
        nextBefore.value = ev.nextBefore;
        nightMode.value = nm;
      } catch (e) {
        error.value = e instanceof Error ? e.message : t("common.unknownError");
      } finally {
        loading.value = false;
      }
    }

    async function update(patch: Partial<ChatSettings>) {
      const current = chat.value;
      if (!current) return;
      const previous = Object.fromEntries(
        (Object.keys(patch) as (keyof ChatSettings)[]).map((k) => [k, current[k]]),
      );
      chat.value = { ...current, ...patch };
      try {
        chat.value = await api.updateChat(id, patch);
      } catch (e) {
        chat.value = { ...chat.value!, ...previous };
        throw e;
      }
    }

    async function addWord(w: string) {
      const word = await api.addWord(id, w);
      if (!words.value.includes(word)) words.value = [...words.value, word].sort();
    }

    async function removeWord(w: string) {
      await api.removeWord(id, w);
      words.value = words.value.filter((x) => x !== w);
    }

    async function addEntry(e: string) {
      const entry = await api.addWhitelistEntry(id, e);
      if (!whitelist.value.includes(entry)) whitelist.value = [...whitelist.value, entry].sort();
    }

    async function removeEntry(e: string) {
      await api.removeWhitelistEntry(id, e);
      whitelist.value = whitelist.value.filter((x) => x !== e);
    }

    async function addStaff(user: string) {
      const member = await api.addStaff(id, user);
      staff.value = [...staff.value.filter((s) => s.userId !== member.userId), member]
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    }

    async function removeStaff(userId: number) {
      await api.removeStaff(id, userId);
      staff.value = staff.value.filter((s) => s.userId !== userId);
    }

    async function saveAutoReply(replyId: number | null, triggers: string[], message: FormattedMessage) {
      if (replyId === null) {
        autoReplies.value = [...autoReplies.value, await api.addAutoReply(id, triggers, message)];
        return;
      }
      const updated = await api.updateAutoReply(id, replyId, triggers, message);
      autoReplies.value = autoReplies.value.map((r) => (r.id === replyId ? updated : r));
    }

    async function removeAutoReply(replyId: number) {
      await api.removeAutoReply(id, replyId);
      autoReplies.value = autoReplies.value.filter((r) => r.id !== replyId);
    }

    async function loadMoreEvents() {
      if (nextBefore.value === null) return;
      const page = await api.listEvents(id, nextBefore.value);
      events.value = [...events.value, ...page.events];
      nextBefore.value = page.nextBefore;
    }

    async function unban(eventId: number) {
      const updated = await api.unban(id, eventId);
      events.value = events.value.map((ev) =>
        ev.id === eventId ? updated
          : ev.senderType === updated.senderType && ev.senderId === updated.senderId ? { ...ev, unbannedAt: updated.unbannedAt }
          : ev);
      return updated;
    }

    async function saveNightMode(settings: NightModeSettings) {
      nightMode.value = await api.saveNightMode(id, settings);
    }

    async function setNightNow(action: "close" | "open") {
      nightMode.value = await api.setNightNow(id, action);
    }

    return { nightMode, saveNightMode, setNightNow, chat, words, whitelist, staff, autoReplies, events, nextBefore, loading, error, load, update, addWord, removeWord, addEntry, removeEntry, addStaff, removeStaff, saveAutoReply, removeAutoReply, loadMoreEvents, unban };
  })();
}
