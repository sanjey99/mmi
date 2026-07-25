import * as DocumentPicker from 'expo-document-picker';
// The top-level `expo-file-system` export is the new File/Directory API;
// `readAsStringAsync`/`EncodingType` only exist under the legacy submodule
// (the top-level shim of the same names throws unconditionally at runtime).
import * as FileSystem from 'expo-file-system/legacy';

export type PickedFile = { name: string; content: string };

/**
 * Opens the native document picker and reads the selected file.
 * `encoding: 'base64'` is required for binary formats (e.g. .xlsx).
 */
export async function pickFile(
  mimeTypes: string[],
  encoding: 'utf8' | 'base64',
): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: mimeTypes,
    copyToCacheDirectory: true,
  });

  if (result.canceled) return null;

  const file = result.assets[0];
  const content = await FileSystem.readAsStringAsync(
    file.uri,
    encoding === 'base64' ? { encoding: FileSystem.EncodingType.Base64 } : undefined,
  );

  return { name: file.name, content };
}
