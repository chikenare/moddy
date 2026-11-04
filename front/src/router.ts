import { createRouter, createWebHistory } from "vue-router";
import ChatsView from "@/views/ChatsView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/", component: ChatsView }],
});
