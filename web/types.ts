import type { appState } from "../src/services/app-service.js";

type Serialize<T> = T extends Date ? string : T extends readonly (infer U)[] ? Serialize<U>[] : T extends object ? { [K in keyof T]: Serialize<T[K]> } : T;
export type State = Omit<Serialize<Awaited<ReturnType<typeof appState>>>, "injuries"> & { injuries: { key: string; name: string; detail: string; excludes: string[] }[] };
export type Roll = NonNullable<State["pending"]>;
export type Assignment = State["history"][number];

export type Insets = { top: number; bottom: number; left: number; right: number };
export type WebApp = {
  initData: string; ready(): void; expand(): void; close(): void;
  setHeaderColor(color: string): void; setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  safeAreaInset?: Insets; contentSafeAreaInset?: Insets;
  isFullscreen?: boolean; platform?: string; viewportStableHeight?: number;
  onEvent?(event: string, callback: () => void): void;
  HapticFeedback?: { impactOccurred(style: string): void; notificationOccurred(type: string): void };
};
declare global { interface Window { Telegram?: { WebApp: WebApp } } }
