export const isMac =
  typeof navigator !== "undefined" &&
  /(Mac|iPhone|iPad|iPod)/i.test(navigator.platform || navigator.userAgent);

export const modKey = isMac ? "⌘" : "Ctrl";
