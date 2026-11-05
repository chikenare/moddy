import { defineStore } from "pinia";
import { ref } from "vue";
import { type SessionState, api } from "@/lib/api";

export const useAuthStore = defineStore("auth", () => {
  const authenticated = ref<boolean | null>(null);
  const mustChangePassword = ref(false);
  const unreachable = ref(false);

  function apply(state: SessionState) {
    authenticated.value = state.authenticated;
    mustChangePassword.value = state.mustChangePassword;
    unreachable.value = false;
  }

  async function check(): Promise<SessionState> {
    try {
      if (authenticated.value === null) apply(await api.session());
      return { authenticated: authenticated.value === true, mustChangePassword: mustChangePassword.value };
    } catch {
      // Still unknown: an outage does not mean logged out, so the next navigation asks again.
      unreachable.value = true;
      return { authenticated: false, mustChangePassword: false };
    }
  }

  async function login(username: string, password: string) {
    apply(await api.login(username, password));
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    apply(await api.changePassword(currentPassword, newPassword));
  }

  async function logout() {
    await api.logout();
    // A full reload drops everything the stores hold in memory.
    window.location.assign("/login");
  }

  return { authenticated, mustChangePassword, unreachable, check, login, changePassword, logout };
});
