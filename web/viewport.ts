import type { Insets, WebApp } from "./types.js";

const pixels = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, value!) : 0;

/** System cutouts and Telegram's own controls occupy separate, additive areas. */
export function safeInsets(device?: Partial<Insets>, content?: Partial<Insets>, fullscreenMobile = false): Insets {
  return {
    top: pixels(device?.top) + (pixels(content?.top) || (fullscreenMobile ? 56 : 0)),
    bottom: pixels(device?.bottom) + pixels(content?.bottom),
    left: pixels(device?.left) + pixels(content?.left),
    right: pixels(device?.right) + pixels(content?.right),
  };
}

export function observeViewport(app?: WebApp) {
  const sync = () => {
    const style = document.documentElement.style;
    if (app?.safeAreaInset || app?.contentSafeAreaInset) {
      const insets = safeInsets(app.safeAreaInset, app.contentSafeAreaInset, !!app.isFullscreen && ["ios", "android"].includes(app.platform ?? ""));
      for (const edge of ["top", "bottom", "left", "right"] as const) {
        const device = pixels(app.safeAreaInset?.[edge]);
        // Keep the browser's notch inset as a fallback while native values arrive.
        style.setProperty(`--app-safe-${edge}`, `calc(max(env(safe-area-inset-${edge}, 0px), ${device}px) + ${insets[edge] - device}px)`);
      }
    }
    if (app?.viewportStableHeight && Number.isFinite(app.viewportStableHeight) && app.viewportStableHeight > 0) style.setProperty("--app-height", `${app.viewportStableHeight}px`);
  };
  sync();
  for (const event of ["safeAreaChanged", "contentSafeAreaChanged", "viewportChanged", "fullscreenChanged"]) app?.onEvent?.(event, sync);
  window.addEventListener("resize", sync);
}
