import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Object3D } from 'three';
import { App } from './app/App';
import './app/app.css';
import { Editor, type EditorStorage } from './core/editor';
import { ToolManager } from './tools/tool-manager';

// Cabbage is Z up: the floor is the XY plane.
Object3D.DEFAULT_UP.set(0, 0, 1);

/** The browser's own storage, or nothing when the browser refuses access to it. */
function browserStorage(): EditorStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const editor = new Editor(browserStorage());
const tools = new ToolManager(editor);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App editor={editor} tools={tools} />
  </StrictMode>,
);
