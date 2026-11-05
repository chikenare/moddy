import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "@/lib/api";

export const useAuthStore = defineStore("auth", () => {
  const authenticated = ref<boolean | null>(null);
  const unreachable = ref(false);

  async function check(): Promise<boolean> {
    if (authenticated.value !== null) return authenticated.value;
    try {
      authenticated.value = (await api.session()).authenticated;
      unreachable.value = false;
      return authenticated.value;
    } catch {
      // Still unknown: an outage does not mean logged out, so the next navigation asks again.
      unreachable.value = true;
      return false;
    }
  }

  async function login(username: string, password: string) {
    await api.login(username, password);
    authenticated.value = true;
    unreachable.value = false;
  }

  async function logout() {
    await api.logout();
    // A full reload drops everything the stores hold in memory.
    window.location.assign("/login");
  }

  return { authenticated, unreachable, check, login, logout };
});
