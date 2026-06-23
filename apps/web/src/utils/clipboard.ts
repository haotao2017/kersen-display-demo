/**
 * Copy text to the clipboard.
 *
 * `navigator.clipboard` is only available in secure contexts (HTTPS or
 * localhost). When the app is served over plain HTTP on a LAN IP it is
 * `undefined`, so we fall back to a temporary <textarea> + execCommand('copy').
 * Returns whether the copy succeeded.
 */
export const copyText = async (text: string): Promise<boolean> => {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy approach
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
};
