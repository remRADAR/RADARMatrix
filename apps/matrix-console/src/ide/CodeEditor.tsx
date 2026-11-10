/**
 * Matrix IDE — CodeMirror 6 editor surface.
 *
 * A thin, controlled wrapper around CodeMirror 6. The component owns the
 * EditorView lifecycle and pushes document changes up to the parent; the
 * parent owns the document text (so tabs, dirty state and the terminal all
 * read from one source of truth).
 */

import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
  placeholder as placeholderExt,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
  StreamLanguage,
} from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from '@codemirror/autocomplete';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { python } from '@codemirror/lang-python';
import { tags as t } from '@lezer/highlight';

const radarHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: '#d9b76b' },
  { tag: [t.name, t.deleted, t.character, t.propertyName], color: '#e8e6df' },
  { tag: [t.function(t.variableName), t.labelName], color: '#80b8e5' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#b39ae8' },
  { tag: [t.definition(t.name), t.separator], color: '#f2f1ec' },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: '#7bd2a1' },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: '#8c929a' },
  { tag: [t.meta, t.comment], color: '#5f6872', fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#80b8e5', textDecoration: 'underline' },
  { tag: t.heading, fontWeight: '700', color: '#d9b76b' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#e3847c' },
  { tag: [t.processingInstruction, t.string, t.inserted], color: '#a8c98f' },
  { tag: t.invalid, color: '#e3847c' },
]);

const radarTheme = EditorView.theme(
  {
    '&': {
      color: '#f2f1ec',
      backgroundColor: '#0d1013',
      height: '100%',
      fontSize: '12.5px',
    },
    '.cm-scroller': {
      fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
      lineHeight: '1.65',
      overflow: 'auto',
    },
    '.cm-content': { caretColor: '#d9b76b', padding: '10px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#d9b76b', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(217,183,107,0.18)',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.028)' },
    '.cm-gutters': {
      backgroundColor: '#0b0e11',
      color: '#4a525b',
      border: 'none',
      borderRight: '1px solid #1b2026',
    },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(217,183,107,0.07)', color: '#d9b76b' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 12px', minWidth: '34px' },
    '.cm-foldGutter .cm-gutterElement': { padding: '0 4px', color: '#5f6872' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'rgba(217,183,107,0.16)',
      outline: '1px solid rgba(217,183,107,0.4)',
    },
    '.cm-selectionMatch': { backgroundColor: 'rgba(128,184,229,0.14)' },
    '.cm-searchMatch': { backgroundColor: 'rgba(217,183,107,0.22)', outline: '1px solid rgba(217,183,107,0.45)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(217,183,107,0.4)' },
    '.cm-panels': { backgroundColor: '#121519', color: '#f2f1ec', borderTop: '1px solid #272d34' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid #272d34' },
    '.cm-panel.cm-search input, .cm-panel.cm-search button': {
      fontFamily: 'inherit',
      fontSize: '11px',
      background: '#0d1013',
      color: '#f2f1ec',
      border: '1px solid #272d34',
      borderRadius: '3px',
      padding: '3px 6px',
    },
    '.cm-panel.cm-search label': { fontSize: '10px', color: '#8c929a' },
    '.cm-tooltip': {
      backgroundColor: '#171b20',
      border: '1px solid #272d34',
      borderRadius: '4px',
      color: '#f2f1ec',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: '#2c2343',
      color: '#f2f1ec',
    },
    '.cm-placeholder': { color: '#4a525b' },
  },
  { dark: true },
);

function languageExtension(language: string) {
  switch (language) {
    case 'tsx':
      return javascript({ jsx: true, typescript: true });
    case 'ts':
      return javascript({ typescript: true });
    case 'jsx':
      return javascript({ jsx: true });
    case 'js':
      return javascript();
    case 'json':
      return json();
    case 'markdown':
      return markdown();
    case 'css':
      return css();
    case 'html':
      return html();
    case 'python':
      return python();
    case 'shell':
      return StreamLanguage.define({
        token(stream) {
          if (stream.match(/^#.*/)) return 'comment';
          if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
          if (stream.match(/^'(?:[^'\\]|\\.)*'/)) return 'string';
          if (stream.match(/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/)) return 'variableName';
          if (stream.match(/^(if|then|else|fi|for|do|done|while|case|esac|function|return|export|local|set)\b/)) return 'keyword';
          if (stream.match(/^[A-Za-z_][A-Za-z0-9_-]*/)) return 'variableName';
          stream.next();
          return null;
        },
      });
    case 'yaml':
      return StreamLanguage.define({
        token(stream) {
          if (stream.match(/^#.*/)) return 'comment';
          if (stream.match(/^[A-Za-z_][A-Za-z0-9_-]*(?=\s*:)/)) return 'propertyName';
          if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
          if (stream.match(/^'(?:[^'\\]|\\.)*'/)) return 'string';
          if (stream.match(/^(true|false|null|~)\b/)) return 'atom';
          if (stream.match(/^-?\d+(\.\d+)?\b/)) return 'number';
          stream.next();
          return null;
        },
      });
    default:
      return [];
  }
}

export interface CodeEditorProps {
  /** Document text. Changing this replaces the document. */
  value: string;
  /** Language id from `languageFor()`. */
  language: string;
  /** Called on every user edit. */
  onChange: (value: string) => void;
  /** Called on Ctrl/Cmd+S. */
  onSave?: () => void;
  /** Called on Ctrl/Cmd+Enter to run the active file. */
  onRun?: () => void;
  readOnly?: boolean;
  ariaLabel?: string;
}

export function CodeEditor({ value, language, onChange, onSave, onRun, readOnly = false, ariaLabel }: CodeEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const callbacks = useRef({ onChange, onSave, onRun });
  callbacks.current = { onChange, onSave, onRun };

  // Create the view once.
  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        syntaxHighlighting(radarHighlight),
        radarTheme,
        EditorView.lineWrapping,
        placeholderExt('Select a file from the tree to begin.'),
        languageCompartment.current.of(languageExtension(language)),
        readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              callbacks.current.onSave?.();
              return true;
            },
          },
          {
            key: 'Mod-Enter',
            preventDefault: true,
            run: () => {
              callbacks.current.onRun?.();
              return true;
            },
          },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
        }),
        EditorView.contentAttributes.of({
          'aria-label': ariaLabel ?? 'Code editor',
          spellcheck: 'false',
          autocapitalize: 'off',
          autocomplete: 'off',
        }),
      ],
    });
    const instance = new EditorView({ state, parent: host.current });
    view.current = instance;
    return () => {
      instance.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Replace the document when the parent switches files.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current === value) return;
    instance.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor: 0 },
    });
  }, [value]);

  // Swap the language extension when the file type changes.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({
      effects: languageCompartment.current.reconfigure(languageExtension(language)),
    });
  }, [language]);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  return <div className="ide-editor-host" ref={host} />;
}
