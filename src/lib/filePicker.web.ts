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

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const raw = reader.result as string;
        // readAsDataURL yields "data:<mime>;base64,<data>" — strip the prefix.
        const content = encoding === 'base64' ? raw.split(',')[1] : raw;
        resolve({ name: file.name, content });
      };
      reader.onerror = () => resolve(null);

      if (encoding === 'base64') reader.readAsDataURL(file);
      else reader.readAsText(file);
    };

    // No native 'cancel' event for <input type="file"> in all browsers;
    // if the user dismisses the dialog without choosing a file, onchange
    // simply never fires and the promise stays pending until they retry.
    input.click();
  });
}
