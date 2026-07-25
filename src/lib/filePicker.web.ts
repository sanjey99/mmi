export type PickedFile = { name: string; content: string };

/**
 * Opens the browser's native file picker via a hidden <input type="file">
 * and reads the selected file. Mirrors the native module's signature so
 * callers don't need Platform.OS branches.
 */
export async function pickFile(
  mimeTypes: string[],
  encoding: 'utf8' | 'base64',
): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = mimeTypes.join(',');
    input.style.display = 'none';
    document.body.appendChild(input);

    let settled = false;
    const settle = (value: PickedFile | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onWindowFocus);
      input.remove();
      resolve(value);
    };

    // <input type="file"> has no native 'cancel' event — if the user
    // dismisses the OS dialog without choosing a file, 'change' never
    // fires. The dialog closing always refocuses the window, so use
    // that as the cancel signal: give 'change' a moment to fire first
    // (it fires before focus returns in every evergreen browser), and
    // settle to null if no file showed up.
    const onWindowFocus = () => {
      setTimeout(() => {
        if (!settled && !input.files?.length) settle(null);
      }, 300);
    };
    window.addEventListener('focus', onWindowFocus);

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        settle(null);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const raw = reader.result as string;
        // readAsDataURL yields "data:<mime>;base64,<data>" — strip the prefix.
        const content = encoding === 'base64' ? raw.split(',')[1] : raw;
        settle({ name: file.name, content });
      };
      reader.onerror = () => settle(null);

      if (encoding === 'base64') reader.readAsDataURL(file);
      else reader.readAsText(file);
    };

    input.click();
  });
}
