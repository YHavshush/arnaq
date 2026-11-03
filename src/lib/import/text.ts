/**
 * Bank files are text, but not always UTF-8: ABN AMRO's TXT export and some older ING files are Windows-1252, where an
 * "é" is one byte. UTF-8 is tried first (it rejects anything that is not valid UTF-8); only then Windows-1252, which
 * can read any byte. Without this the names with accents would come out as replacement characters.
 */
export function decodeBankText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
