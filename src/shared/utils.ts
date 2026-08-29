export function copyText(text: string): Promise<void> {
  const fallback = async (): Promise<void> => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      if (!document.execCommand("copy")) {
        throw new Error("Clipboard access is unavailable");
      }
    } finally {
      textarea.remove();
    }
  };

  const clipboard = navigator.clipboard;
  if (clipboard?.writeText) {
    return clipboard.writeText(text).catch(fallback);
  }

  return fallback();
}
