type Photo = { url: string | null; expires: number };
const photos = new Map<number, Photo>();
const pending = new Map<number, Promise<Photo>>();
const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => [...word][0]).join("").toLocaleUpperCase() || "?";
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
export const avatarMarkup = (id: number, name: string) => `<span class="player-avatar avatar-tone-${id % 4}" data-avatar-player="${id}" aria-hidden="true"><span>${escape(initials(name))}</span></span>`;

/** Called after rendering; updates images without rerendering or moving the feed. */
export function hydrateAvatars(root: HTMLElement, initData: string, preview = false) {
  if (preview) return;
  const ids = new Set([...root.querySelectorAll<HTMLElement>("[data-avatar-player]")].map((node) => Number(node.dataset.avatarPlayer)));
  for (const id of ids) {
    const paint = (photo: Photo) => {
      if (!photo.url) return;
      for (const node of root.querySelectorAll<HTMLElement>(`[data-avatar-player="${id}"]`)) {
        if (node.querySelector("img")) continue;
        const image = document.createElement("img"); image.alt = ""; image.decoding = "async"; image.width = 28; image.height = 28;
        image.onload = () => node.classList.add("has-image");
        image.onerror = () => { image.remove(); node.classList.remove("has-image"); };
        image.src = photo.url; node.append(image);
      }
    };
    const old = photos.get(id);
    if (old && old.expires > Date.now()) { paint(old); continue; }
    let request = pending.get(id);
    if (!request) {
      request = (async () => {
        let url: string | null = null;
        try {
          const response = await fetch(`/api/players/${id}/avatar`, { headers: { Authorization: `tma ${initData}` }, signal: AbortSignal.timeout(12_000) });
          if (response.ok && ["image/jpeg", "image/png", "image/webp"].includes(response.headers.get("content-type") ?? "")) url = URL.createObjectURL(await response.blob());
        } catch { /* Initials stay visible when a photo is private or unavailable. */ }
        const photo = { url, expires: Date.now() + (url ? 300_000 : 60_000) };
        if (old?.url) URL.revokeObjectURL(old.url);
        photos.set(id, photo); return photo;
      })().finally(() => pending.delete(id));
      pending.set(id, request);
    }
    void request.then(paint);
  }
}
