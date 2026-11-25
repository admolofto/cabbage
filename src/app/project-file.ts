import {
  cleanProjectName,
  deserializeDocument,
  serializeDocument,
  type CabbageDocument,
} from '../core/document';

/**
 * Reading and writing project files.
 *
 * Browsers that can write straight to a file on disk get a real Save: the
 * first save asks where, and later ones write to the same file. The rest,
 * including Safari on a tablet, download the file instead and open one
 * through an ordinary file chooser.
 */

const EXTENSION = '.cabbage';
const FILE_TYPES = [{ description: 'Cabbage project', accept: { 'application/json': [EXTENSION, '.json'] } }];

interface WritableFile {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
}

/** A file on disk the browser has been allowed to read and write. */
export interface ProjectFileHandle {
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<WritableFile>;
}

interface FilePickers {
  showSaveFilePicker?: (options: { suggestedName: string; types: typeof FILE_TYPES }) => Promise<ProjectFileHandle>;
  showOpenFilePicker?: (options: { types: typeof FILE_TYPES; multiple: false }) => Promise<ProjectFileHandle[]>;
}

function pickers(): FilePickers {
  return window as unknown as FilePickers;
}

function isCancel(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** The project name a file name stands for: the name without its ending. */
function nameFromFile(fileName: string): string {
  return cleanProjectName(fileName.replace(/\.(cabbage|json)$/i, ''));
}

/** Hands the browser a file to download. */
export function downloadText(fileName: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The download has its own copy by the time the page gets another turn.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface SavedProject {
  /** The model as written, named after the file it went into. */
  document: CabbageDocument;
  /** The file to write to next time, when the browser can do that. */
  handle: ProjectFileHandle | null;
}

/**
 * Writes the project to a file. With a handle from an earlier save or open it
 * writes there without asking, unless `chooseFile` is set. Returns null when
 * the person backs out of choosing a file.
 */
export async function saveProject(
  document: CabbageDocument,
  handle: ProjectFileHandle | null,
  chooseFile: boolean,
): Promise<SavedProject | null> {
  const { showSaveFilePicker } = pickers();
  if (showSaveFilePicker) {
    try {
      const target =
        !chooseFile && handle
          ? handle
          : await showSaveFilePicker.call(window, { suggestedName: `${document.name}${EXTENSION}`, types: FILE_TYPES });
      // The project takes the name of the file it is saved as.
      const named = { ...document, name: nameFromFile(target.name) };
      const writable = await target.createWritable();
      await writable.write(serializeDocument(named));
      await writable.close();
      return { document: named, handle: target };
    } catch (error) {
      if (isCancel(error)) return null;
      // Some places refuse direct file access, such as a page inside a frame. A download still works there.
    }
  }
  downloadText(`${document.name}${EXTENSION}`, serializeDocument(document), 'application/json');
  return { document, handle: null };
}

/** Asks for a file with an ordinary file chooser. Resolves with null when the chooser is closed without one. */
function chooseFileToUpload(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${EXTENSION},.json,application/json`;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export interface OpenedProject {
  document: CabbageDocument;
  handle: ProjectFileHandle | null;
}

/**
 * Asks for a project file and reads it. Returns null when no file was chosen,
 * and 'unreadable' when the file is not a Cabbage project.
 */
export async function openProject(): Promise<OpenedProject | 'unreadable' | null> {
  const { showOpenFilePicker } = pickers();
  let file: File | null = null;
  let handle: ProjectFileHandle | null = null;
  if (showOpenFilePicker) {
    try {
      [handle = null] = await showOpenFilePicker.call(window, { types: FILE_TYPES, multiple: false });
      file = handle ? await handle.getFile() : null;
    } catch (error) {
      if (isCancel(error)) return null;
      handle = null;
    }
  }
  file ??= await chooseFileToUpload();
  if (!file) return null;

  const document = deserializeDocument(await file.text());
  if (!document) return 'unreadable';
  // A file renamed on disk is still the same project, now under that name.
  return { document: { ...document, name: nameFromFile(file.name) }, handle };
}
