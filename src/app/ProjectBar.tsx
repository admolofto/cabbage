import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_DOCUMENT } from '../core/document';
import type { Editor, EditorState } from '../core/editor';
import { CommitField } from './Inspector';
import { openProject, saveProject, type ProjectFileHandle } from './project-file';

/** Replacing the model: with an empty one, or with one from a file. */
type Replacement = 'new' | 'open';

/**
 * Save, Open, and New for the project. Opening or starting a project throws
 * the current one away, so when it has changes that are not in a file yet,
 * the person is asked first.
 */
export function useProject(editor: Editor, afterOpen: () => void) {
  const handle = useRef<ProjectFileHandle | null>(null);
  const [asking, setAsking] = useState<Replacement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const save = useCallback(
    async (chooseFile = false): Promise<boolean> => {
      try {
        const saved = await saveProject(editor.getState().document, handle.current, chooseFile);
        if (!saved) return false;
        handle.current = saved.handle;
        // The project is named after its file.
        editor.renameProject(saved.document.name);
        editor.markSaved();
        setNotice(saved.handle ? `Saved to ${saved.handle.name}` : `Saved as a download: ${saved.document.name}.cabbage`);
        return true;
      } catch {
        setNotice('The project could not be saved. It is still kept in this browser.');
        return false;
      }
    },
    [editor],
  );

  const replace = useCallback(
    async (kind: Replacement) => {
      setAsking(null);
      if (kind === 'new') {
        handle.current = null;
        editor.openDocument(EMPTY_DOCUMENT, false);
        afterOpen();
        return;
      }
      try {
        const opened = await openProject();
        if (opened === null) return;
        if (opened === 'unreadable') {
          setNotice('That file is not a Cabbage project.');
          return;
        }
        handle.current = opened.handle;
        editor.openDocument(opened.document, true);
        afterOpen();
      } catch {
        setNotice('That file could not be read.');
      }
    },
    [editor, afterOpen],
  );

  /** Starts replacing the model, asking first when there is something to lose. */
  const request = useCallback(
    (kind: Replacement) => {
      if (editor.getState().unsaved) setAsking(kind);
      else void replace(kind);
    },
    [editor, replace],
  );

  const cancel = useCallback(() => setAsking(null), []);

  return useMemo(
    () => ({ save, replace, request, asking, cancel, notice }),
    [save, replace, request, asking, cancel, notice],
  );
}

export type Project = ReturnType<typeof useProject>;

interface ProjectBarProps {
  editor: Editor;
  state: EditorState;
  project: Project;
}

export function ProjectBar({ editor, state, project }: ProjectBarProps) {
  return (
    <div className="projectbar">
      <span className="project-name" data-unsaved={state.unsaved || undefined}>
        <CommitField
          label="Project name"
          value={state.document.name}
          onCommit={(value) => editor.renameProject(value)}
        />
        {state.unsaved && <span className="unsaved-dot" title="Has changes that are not saved to a file" />}
      </span>
      <button type="button" className="quiet-button" title="Start a new project" onClick={() => project.request('new')}>
        New
      </button>
      <button
        type="button"
        className="quiet-button"
        title="Open a project file (Ctrl+O)"
        onClick={() => project.request('open')}
      >
        Open
      </button>
      <button
        type="button"
        className="quiet-button"
        title="Save the project to a file (Ctrl+S). Ctrl+Shift+S saves it under another name."
        onClick={(event) => void project.save(event.shiftKey)}
      >
        Save
      </button>
    </div>
  );
}

interface ReplaceDialogProps {
  kind: Replacement;
  unsaved: boolean;
  name: string;
  project: Project;
}

/** Asks before a project with unsaved changes is replaced. Once it is saved, the same card offers to carry on. */
export function ReplaceDialog({ kind, unsaved, name, project }: ReplaceDialogProps) {
  const carryOn = kind === 'new' ? 'Start a new project' : 'Open a project';
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="alertdialog" aria-label={carryOn}>
        {unsaved ? (
          <>
            <h2>Save “{name}” first?</h2>
            <p>It has changes that are not saved to a file. They are lost if you carry on without saving.</p>
          </>
        ) : (
          <>
            <h2>“{name}” is saved</h2>
            <p>Nothing will be lost.</p>
          </>
        )}
        <div className="form-actions">
          <button type="button" className="quiet-button" onClick={project.cancel}>
            Cancel
          </button>
          {unsaved && (
            <button type="button" className="quiet-button danger" onClick={() => void project.replace(kind)}>
              Do not save
            </button>
          )}
          {unsaved ? (
            <button type="button" className="solid-button" autoFocus onClick={() => void project.save()}>
              Save
            </button>
          ) : (
            <button type="button" className="solid-button" autoFocus onClick={() => void project.replace(kind)}>
              {carryOn}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
