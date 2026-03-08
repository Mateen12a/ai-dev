import { useState, useEffect, useRef, useCallback } from "react";
import type { ProjectFile } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Save, FileCode, History, AlignLeft, Loader2 } from "lucide-react";
import { FileHistoryPanel } from "@/components/file-history-panel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, rectangularSelection, crosshairCursor, highlightSpecialChars, hoverTooltip } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, closeBrackets, closeBracketsKeymap, type CompletionContext, type Completion } from "@codemirror/autocomplete";
import { indentOnInput, bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { abbreviationTracker, expandAbbreviation } from "@emmetio/codemirror6-plugin";

function isEmmetSupported(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return ["html", "htm", "jsx", "tsx", "css", "scss"].includes(ext);
}

function getPrettierParser(fileName: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript",
    js: "babel", jsx: "babel",
    json: "json",
    css: "css", scss: "css",
    html: "html", htm: "html",
    md: "markdown",
    yml: "yaml", yaml: "yaml",
  };
  return map[ext] || null;
}

async function formatWithPrettier(code: string, parser: string): Promise<string> {
  const prettier = await import("prettier/standalone");
  const plugins: any[] = [];
  if (parser === "typescript" || parser === "babel") {
    const p = await import("prettier/plugins/typescript");
    const e = await import("prettier/plugins/estree");
    plugins.push(p.default || p, e.default || e);
  } else if (parser === "css") {
    const p = await import("prettier/plugins/postcss");
    plugins.push(p.default || p);
  } else if (parser === "html") {
    const p = await import("prettier/plugins/html");
    plugins.push(p.default || p);
  } else if (parser === "json") {
    const p = await import("prettier/plugins/babel");
    const e = await import("prettier/plugins/estree");
    plugins.push(p.default || p, e.default || e);
  } else if (parser === "markdown") {
    const p = await import("prettier/plugins/markdown");
    plugins.push(p.default || p);
  } else if (parser === "yaml") {
    const p = await import("prettier/plugins/yaml");
    plugins.push(p.default || p);
  }
  const formatted = await prettier.format(code, {
    parser,
    plugins,
    singleQuote: true,
    trailingComma: "all",
    tabWidth: 2,
    semi: true,
  });
  return formatted;
}

export interface EditorContext {
  activeFile: string | null;
  activeFilePath: string | null;
  selection: string | null;
  cursorLine: number | null;
  fileContent: string | null;
}

interface CodeEditorProps {
  file: ProjectFile | null;
  openFiles: ProjectFile[];
  allFiles?: ProjectFile[];
  projectId?: string;
  onSave: (fileId: string, content: string) => void;
  onSelectFile: (file: ProjectFile) => void;
  onCloseFile: (fileId: string) => void;
  onEditorContext?: (context: EditorContext) => void;
  onAskAI?: (question: string) => void;
  theme?: "dark" | "light";
}

function getLanguageClass(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts": case "tsx": return "typescript";
    case "js": case "jsx": return "javascript";
    case "json": return "json";
    case "css": case "scss": return "css";
    case "html": return "html";
    case "py": return "python";
    case "go": return "go";
    case "rs": return "rust";
    case "md": return "markdown";
    case "yml": case "yaml": return "yaml";
    default: return "plaintext";
  }
}

function getLanguageExtension(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "ts": case "tsx": case "js": case "jsx":
      return javascript({ jsx: true, typescript: ext.includes("t") });
    case "html":
      return html();
    case "css": case "scss":
      return css();
    case "json":
      return json();
    case "py":
      return python();
    case "md":
      return markdown();
    default:
      return [];
  }
}

function isJsOrTs(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return ["ts", "tsx", "js", "jsx"].includes(ext);
}

function isCssFile(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return ["css", "scss"].includes(ext);
}

function isHtmlFile(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return ext === "html";
}

const jsGlobalAPIs: Completion[] = [
  { label: "console", type: "variable", detail: "Console API", info: "The console object provides access to the browser's debugging console" },
  { label: "console.log", type: "function", detail: "(…args) => void", info: "Outputs a message to the console" },
  { label: "console.error", type: "function", detail: "(…args) => void", info: "Outputs an error message" },
  { label: "console.warn", type: "function", detail: "(…args) => void", info: "Outputs a warning message" },
  { label: "console.info", type: "function", detail: "(…args) => void", info: "Outputs an informational message" },
  { label: "console.table", type: "function", detail: "(data, columns?) => void", info: "Displays tabular data as a table" },
  { label: "console.dir", type: "function", detail: "(obj) => void", info: "Displays an interactive listing of object properties" },
  { label: "console.time", type: "function", detail: "(label?) => void", info: "Starts a timer" },
  { label: "console.timeEnd", type: "function", detail: "(label?) => void", info: "Stops a timer and logs elapsed time" },
  { label: "console.group", type: "function", detail: "(…args) => void", info: "Creates a new inline group" },
  { label: "console.groupEnd", type: "function", detail: "() => void", info: "Exits the current inline group" },
  { label: "document", type: "variable", detail: "Document", info: "The Document interface represents the web page" },
  { label: "document.getElementById", type: "function", detail: "(id: string) => Element | null", info: "Returns the Element with the given ID" },
  { label: "document.querySelector", type: "function", detail: "(selector: string) => Element | null", info: "Returns the first element matching the selector" },
  { label: "document.querySelectorAll", type: "function", detail: "(selector: string) => NodeList", info: "Returns all elements matching the selector" },
  { label: "document.createElement", type: "function", detail: "(tagName: string) => Element", info: "Creates an HTML element" },
  { label: "document.createTextNode", type: "function", detail: "(text: string) => Text", info: "Creates a text node" },
  { label: "document.body", type: "property", detail: "HTMLBodyElement", info: "The <body> element of the document" },
  { label: "document.head", type: "property", detail: "HTMLHeadElement", info: "The <head> element of the document" },
  { label: "window", type: "variable", detail: "Window", info: "The global window object" },
  { label: "window.location", type: "property", detail: "Location", info: "The current URL" },
  { label: "window.history", type: "property", detail: "History", info: "The browser history" },
  { label: "window.localStorage", type: "property", detail: "Storage", info: "Access to local storage" },
  { label: "window.sessionStorage", type: "property", detail: "Storage", info: "Access to session storage" },
  { label: "window.addEventListener", type: "function", detail: "(type, listener) => void", info: "Adds an event listener" },
  { label: "window.removeEventListener", type: "function", detail: "(type, listener) => void", info: "Removes an event listener" },
  { label: "window.setTimeout", type: "function", detail: "(fn, delay) => number", info: "Sets a timer to execute a function" },
  { label: "window.setInterval", type: "function", detail: "(fn, delay) => number", info: "Repeatedly calls a function with fixed time delay" },
  { label: "window.clearTimeout", type: "function", detail: "(id) => void", info: "Cancels a timeout" },
  { label: "window.clearInterval", type: "function", detail: "(id) => void", info: "Cancels an interval" },
  { label: "window.fetch", type: "function", detail: "(url, init?) => Promise<Response>", info: "Fetches a resource from the network" },
  { label: "Math", type: "variable", detail: "Math", info: "Mathematical constants and functions" },
  { label: "Math.abs", type: "function", detail: "(x: number) => number", info: "Returns the absolute value" },
  { label: "Math.ceil", type: "function", detail: "(x: number) => number", info: "Rounds up to the nearest integer" },
  { label: "Math.floor", type: "function", detail: "(x: number) => number", info: "Rounds down to the nearest integer" },
  { label: "Math.round", type: "function", detail: "(x: number) => number", info: "Rounds to the nearest integer" },
  { label: "Math.max", type: "function", detail: "(…values) => number", info: "Returns the largest value" },
  { label: "Math.min", type: "function", detail: "(…values) => number", info: "Returns the smallest value" },
  { label: "Math.random", type: "function", detail: "() => number", info: "Returns a pseudo-random number between 0 and 1" },
  { label: "Math.sqrt", type: "function", detail: "(x: number) => number", info: "Returns the square root" },
  { label: "Math.pow", type: "function", detail: "(base, exp) => number", info: "Returns base to the power of exp" },
  { label: "Math.PI", type: "constant", detail: "3.141592653589793", info: "The ratio of a circle's circumference to its diameter" },
  { label: "JSON.parse", type: "function", detail: "(text: string) => any", info: "Parses a JSON string" },
  { label: "JSON.stringify", type: "function", detail: "(value, replacer?, space?) => string", info: "Converts a value to a JSON string" },
  { label: "Object.keys", type: "function", detail: "(obj) => string[]", info: "Returns an array of the object's own enumerable property names" },
  { label: "Object.values", type: "function", detail: "(obj) => any[]", info: "Returns an array of the object's own enumerable property values" },
  { label: "Object.entries", type: "function", detail: "(obj) => [string, any][]", info: "Returns an array of [key, value] pairs" },
  { label: "Object.assign", type: "function", detail: "(target, …sources) => object", info: "Copies properties from source objects to the target" },
  { label: "Object.freeze", type: "function", detail: "(obj) => object", info: "Freezes an object" },
  { label: "Array.isArray", type: "function", detail: "(value) => boolean", info: "Determines whether a value is an array" },
  { label: "Array.from", type: "function", detail: "(iterable) => any[]", info: "Creates a new Array from an iterable" },
  { label: "Promise", type: "class", detail: "Promise<T>", info: "Represents the eventual completion of an async operation" },
  { label: "Promise.resolve", type: "function", detail: "(value) => Promise", info: "Returns a resolved Promise" },
  { label: "Promise.reject", type: "function", detail: "(reason) => Promise", info: "Returns a rejected Promise" },
  { label: "Promise.all", type: "function", detail: "(promises) => Promise", info: "Resolves when all promises are resolved" },
  { label: "Promise.allSettled", type: "function", detail: "(promises) => Promise", info: "Resolves when all promises are settled" },
  { label: "Promise.race", type: "function", detail: "(promises) => Promise", info: "Resolves/rejects with the first settled promise" },
  { label: "parseInt", type: "function", detail: "(string, radix?) => number", info: "Parses a string and returns an integer" },
  { label: "parseFloat", type: "function", detail: "(string) => number", info: "Parses a string and returns a float" },
  { label: "isNaN", type: "function", detail: "(value) => boolean", info: "Determines whether a value is NaN" },
  { label: "isFinite", type: "function", detail: "(value) => boolean", info: "Determines whether a value is finite" },
  { label: "encodeURIComponent", type: "function", detail: "(str) => string", info: "Encodes a URI component" },
  { label: "decodeURIComponent", type: "function", detail: "(str) => string", info: "Decodes a URI component" },
  { label: "setTimeout", type: "function", detail: "(fn, delay?) => number", info: "Sets a timer to execute a function after delay" },
  { label: "setInterval", type: "function", detail: "(fn, delay) => number", info: "Repeatedly calls a function with fixed time delay" },
  { label: "clearTimeout", type: "function", detail: "(id) => void", info: "Cancels a timeout" },
  { label: "clearInterval", type: "function", detail: "(id) => void", info: "Cancels an interval" },
  { label: "fetch", type: "function", detail: "(url, init?) => Promise<Response>", info: "Fetches a resource from the network" },
  { label: "Date", type: "class", detail: "Date", info: "Creates a Date object for date/time operations" },
  { label: "Date.now", type: "function", detail: "() => number", info: "Returns the current timestamp in milliseconds" },
  { label: "RegExp", type: "class", detail: "RegExp", info: "Regular expression object" },
  { label: "Map", type: "class", detail: "Map<K, V>", info: "Map object holds key-value pairs" },
  { label: "Set", type: "class", detail: "Set<T>", info: "Set object stores unique values" },
  { label: "WeakMap", type: "class", detail: "WeakMap<K, V>", info: "WeakMap holds weak references to keys" },
  { label: "WeakSet", type: "class", detail: "WeakSet<T>", info: "WeakSet holds weak references to values" },
  { label: "Symbol", type: "function", detail: "(description?) => symbol", info: "Creates a unique symbol" },
  { label: "Error", type: "class", detail: "Error", info: "Base error class" },
  { label: "TypeError", type: "class", detail: "TypeError", info: "Represents a type error" },
  { label: "RangeError", type: "class", detail: "RangeError", info: "Represents a range error" },
  { label: "SyntaxError", type: "class", detail: "SyntaxError", info: "Represents a syntax error" },
];

const tsKeywords: Completion[] = [
  { label: "interface", type: "keyword" },
  { label: "type", type: "keyword" },
  { label: "enum", type: "keyword" },
  { label: "namespace", type: "keyword" },
  { label: "declare", type: "keyword" },
  { label: "readonly", type: "keyword" },
  { label: "abstract", type: "keyword" },
  { label: "implements", type: "keyword" },
  { label: "keyof", type: "keyword" },
  { label: "typeof", type: "keyword" },
  { label: "as", type: "keyword" },
  { label: "is", type: "keyword" },
  { label: "infer", type: "keyword" },
  { label: "never", type: "keyword" },
  { label: "unknown", type: "keyword" },
  { label: "any", type: "keyword" },
  { label: "void", type: "keyword" },
  { label: "string", type: "type" },
  { label: "number", type: "type" },
  { label: "boolean", type: "type" },
  { label: "null", type: "keyword" },
  { label: "undefined", type: "keyword" },
  { label: "Record", type: "type", detail: "Record<K, V>" },
  { label: "Partial", type: "type", detail: "Partial<T>" },
  { label: "Required", type: "type", detail: "Required<T>" },
  { label: "Pick", type: "type", detail: "Pick<T, K>" },
  { label: "Omit", type: "type", detail: "Omit<T, K>" },
  { label: "Readonly", type: "type", detail: "Readonly<T>" },
  { label: "ReturnType", type: "type", detail: "ReturnType<T>" },
  { label: "Parameters", type: "type", detail: "Parameters<T>" },
  { label: "Awaited", type: "type", detail: "Awaited<T>" },
  { label: "NonNullable", type: "type", detail: "NonNullable<T>" },
];

const reactCompletions: Completion[] = [
  { label: "useState", type: "function", detail: "<T>(initial) => [T, SetState<T>]", info: "React state hook" },
  { label: "useEffect", type: "function", detail: "(effect, deps?) => void", info: "React effect hook" },
  { label: "useRef", type: "function", detail: "<T>(initial) => RefObject<T>", info: "React ref hook" },
  { label: "useCallback", type: "function", detail: "(fn, deps) => fn", info: "React memoized callback hook" },
  { label: "useMemo", type: "function", detail: "(fn, deps) => T", info: "React memoized value hook" },
  { label: "useContext", type: "function", detail: "(Context) => T", info: "React context hook" },
  { label: "useReducer", type: "function", detail: "(reducer, initial) => [state, dispatch]", info: "React reducer hook" },
  { label: "useLayoutEffect", type: "function", detail: "(effect, deps?) => void", info: "Synchronous effect hook" },
  { label: "useId", type: "function", detail: "() => string", info: "Generates a unique ID" },
  { label: "useImperativeHandle", type: "function", detail: "(ref, create, deps?) => void", info: "Customizes instance value exposed to parent" },
  { label: "forwardRef", type: "function", detail: "(render) => Component", info: "Forwards ref to a child component" },
  { label: "memo", type: "function", detail: "(Component) => Component", info: "Memoizes a component" },
  { label: "createContext", type: "function", detail: "(default) => Context", info: "Creates a React context" },
  { label: "Fragment", type: "keyword", detail: "React.Fragment", info: "Groups elements without adding extra nodes" },
  { label: "Suspense", type: "class", detail: "React.Suspense", info: "Displays a fallback while children are loading" },
];

const nodeCompletions: Completion[] = [
  { label: "require", type: "function", detail: "(module: string) => any", info: "Import a CommonJS module" },
  { label: "module.exports", type: "variable", detail: "object", info: "Module exports object" },
  { label: "process.env", type: "variable", detail: "object", info: "Environment variables" },
  { label: "process.exit", type: "function", detail: "(code?) => never", info: "Exits the process" },
  { label: "process.cwd", type: "function", detail: "() => string", info: "Returns current working directory" },
  { label: "__dirname", type: "variable", detail: "string", info: "Directory name of the current module" },
  { label: "__filename", type: "variable", detail: "string", info: "Filename of the current module" },
  { label: "Buffer", type: "class", detail: "Buffer", info: "Buffer for binary data" },
];

const cssProperties: Completion[] = [
  "display", "position", "width", "height", "margin", "padding", "border",
  "background", "background-color", "color", "font-size", "font-weight", "font-family",
  "text-align", "text-decoration", "line-height", "letter-spacing",
  "flex", "flex-direction", "flex-wrap", "justify-content", "align-items", "align-self",
  "gap", "grid", "grid-template-columns", "grid-template-rows",
  "overflow", "overflow-x", "overflow-y", "z-index", "opacity",
  "transform", "transition", "animation", "cursor", "pointer-events",
  "box-shadow", "border-radius", "outline", "visibility",
  "top", "right", "bottom", "left", "min-width", "max-width", "min-height", "max-height",
  "white-space", "word-break", "text-overflow", "box-sizing",
  "content", "list-style", "text-transform", "vertical-align",
].map(prop => ({ label: prop, type: "property" as const, detail: "CSS property" }));

const htmlTags: Completion[] = [
  "div", "span", "p", "a", "img", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
  "header", "footer", "nav", "main", "section", "article", "aside",
  "form", "input", "button", "textarea", "select", "option", "label",
  "table", "thead", "tbody", "tr", "th", "td",
  "script", "style", "link", "meta", "title",
  "video", "audio", "canvas", "svg", "iframe",
  "pre", "code", "blockquote", "hr", "br",
  "strong", "em", "small", "mark", "sub", "sup",
].map(tag => ({ label: tag, type: "type" as const, detail: "HTML tag" }));

const htmlAttributes: Completion[] = [
  "class", "id", "style", "src", "href", "alt", "title", "type", "value", "name",
  "placeholder", "disabled", "checked", "readonly", "required", "autoComplete",
  "onClick", "onChange", "onSubmit", "onKeyDown", "onKeyUp", "onMouseEnter", "onMouseLeave",
  "className", "htmlFor", "tabIndex", "role", "aria-label", "aria-hidden",
  "data-testid", "key", "ref", "dangerouslySetInnerHTML",
  "target", "rel", "method", "action", "encType",
  "width", "height", "loading", "crossOrigin",
].map(attr => ({ label: attr, type: "property" as const, detail: "HTML attribute" }));

const identifierRegex = /\b(?:(?:const|let|var|function|class)\s+([a-zA-Z_$][\w$]*)|(?:export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([a-zA-Z_$][\w$]*)))/g;
const importRegex = /import\s+(?:\{([^}]+)\}|(\w+))\s+from/g;

function extractIdentifiersFromContent(content: string): Completion[] {
  const seen = new Set<string>();
  const completions: Completion[] = [];

  let match: RegExpExecArray | null;
  const idRe = new RegExp(identifierRegex.source, "g");
  while ((match = idRe.exec(content)) !== null) {
    const name = match[1] || match[2];
    if (name && !seen.has(name) && name.length > 1) {
      seen.add(name);
      completions.push({ label: name, type: "variable", detail: "project identifier" });
    }
  }

  const impRe = new RegExp(importRegex.source, "g");
  while ((match = impRe.exec(content)) !== null) {
    if (match[1]) {
      match[1].split(",").forEach(part => {
        const name = part.replace(/\s+as\s+\w+/, "").trim();
        if (name && !seen.has(name) && name.length > 1) {
          seen.add(name);
          completions.push({ label: name, type: "variable", detail: "imported" });
        }
      });
    }
    if (match[2] && !seen.has(match[2])) {
      seen.add(match[2]);
      completions.push({ label: match[2], type: "variable", detail: "imported module" });
    }
  }

  return completions;
}

function createProjectCompletionSource(allFilesRef: React.RefObject<ProjectFile[]>, fileNameRef: React.RefObject<string>) {
  return (context: CompletionContext) => {
    const word = context.matchBefore(/[\w$.]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;

    const fileName = fileNameRef.current || "";
    const lang = getLanguageClass(fileName);

    let options: Completion[] = [];

    if (lang === "typescript" || lang === "javascript") {
      options = [...jsGlobalAPIs, ...nodeCompletions];
      if (lang === "typescript") {
        options = [...options, ...tsKeywords];
      }
      if (fileName.endsWith(".tsx") || fileName.endsWith(".jsx")) {
        options = [...options, ...reactCompletions, ...htmlTags, ...htmlAttributes];
      }

      const files = allFilesRef.current || [];
      for (const f of files) {
        if (isJsOrTs(f.name) && f.content) {
          const extracted = extractIdentifiersFromContent(f.content);
          options = [...options, ...extracted];
        }
      }
    } else if (lang === "css") {
      options = cssProperties;
    } else if (lang === "html") {
      options = [...htmlTags, ...htmlAttributes];
    }

    if (options.length === 0) return null;

    const seen = new Set<string>();
    const deduped = options.filter(o => {
      if (seen.has(o.label)) return false;
      seen.add(o.label);
      return true;
    });

    return {
      from: word.from,
      options: deduped,
      validFor: /^[\w$.]*$/,
    };
  };
}

const functionSignatures: Record<string, string> = {
  "console.log": "(…args: any[]): void",
  "console.error": "(…args: any[]): void",
  "console.warn": "(…args: any[]): void",
  "document.getElementById": "(id: string): Element | null",
  "document.querySelector": "(selector: string): Element | null",
  "document.querySelectorAll": "(selector: string): NodeList",
  "document.createElement": "(tagName: string): Element",
  "Math.abs": "(x: number): number",
  "Math.ceil": "(x: number): number",
  "Math.floor": "(x: number): number",
  "Math.round": "(x: number): number",
  "Math.max": "(…values: number[]): number",
  "Math.min": "(…values: number[]): number",
  "Math.random": "(): number",
  "Math.sqrt": "(x: number): number",
  "Math.pow": "(base: number, exponent: number): number",
  "JSON.parse": "(text: string, reviver?: Function): any",
  "JSON.stringify": "(value: any, replacer?: Function, space?: number): string",
  "Object.keys": "(obj: object): string[]",
  "Object.values": "(obj: object): any[]",
  "Object.entries": "(obj: object): [string, any][]",
  "Object.assign": "(target: object, …sources: object[]): object",
  "Array.isArray": "(value: any): boolean",
  "Array.from": "(iterable: Iterable, mapFn?: Function): any[]",
  "parseInt": "(string: string, radix?: number): number",
  "parseFloat": "(string: string): number",
  "fetch": "(url: string, init?: RequestInit): Promise<Response>",
  "setTimeout": "(callback: Function, delay?: number): number",
  "setInterval": "(callback: Function, delay: number): number",
  "clearTimeout": "(id: number): void",
  "clearInterval": "(id: number): void",
  "useState": "<T>(initialState: T | (() => T)): [T, (value: T) => void]",
  "useEffect": "(effect: () => void | (() => void), deps?: any[]): void",
  "useRef": "<T>(initialValue: T): { current: T }",
  "useCallback": "<T>(callback: T, deps: any[]): T",
  "useMemo": "<T>(factory: () => T, deps: any[]): T",
  "useContext": "<T>(context: Context<T>): T",
  "useReducer": "(reducer: Function, initialState: any): [state, dispatch]",
  "Promise.all": "(promises: Promise[]): Promise<any[]>",
  "Promise.race": "(promises: Promise[]): Promise<any>",
  "Promise.resolve": "(value: any): Promise",
  "Promise.reject": "(reason: any): Promise",
};

function createParameterHintTooltip(fileNameRef: React.RefObject<string>) {
  return hoverTooltip((view, pos) => {
    const fileName = fileNameRef.current || "";
    if (!isJsOrTs(fileName)) return null;

    const line = view.state.doc.lineAt(pos);
    const text = line.text;
    const col = pos - line.from;

    const beforeCursor = text.substring(0, col + 1);
    const fnMatch = beforeCursor.match(/([\w$.]+)\s*\(?\s*$/);
    if (!fnMatch) return null;

    const fnName = fnMatch[1];
    const sig = functionSignatures[fnName];
    if (!sig) return null;

    const start = line.from + (fnMatch.index || 0);
    const end = start + fnName.length;

    return {
      pos: start,
      end,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.style.padding = "4px 8px";
        dom.style.fontSize = "12px";
        dom.style.fontFamily = "monospace";
        dom.style.maxWidth = "400px";
        dom.style.whiteSpace = "pre-wrap";
        dom.textContent = `${fnName}${sig}`;
        return { dom };
      },
    };
  });
}

function createBasicJsLinter(fileNameRef: React.RefObject<string>) {
  return linter((view) => {
    const fileName = fileNameRef.current || "";
    if (!isJsOrTs(fileName) && !isHtmlFile(fileName)) return [];

    const diagnostics: Diagnostic[] = [];
    const doc = view.state.doc;
    const text = doc.toString();

    const bracketStack: { char: string; pos: number }[] = [];
    const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
    const closers: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    let inString = false;
    let stringChar = "";
    let inLineComment = false;
    let inBlockComment = false;
    let inTemplate = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const prev = i > 0 ? text[i - 1] : "";

      if (inLineComment) {
        if (ch === "\n") inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === "/" && prev === "*") inBlockComment = false;
        continue;
      }
      if (inString) {
        if (ch === stringChar && prev !== "\\") inString = false;
        continue;
      }
      if (inTemplate) {
        if (ch === "`" && prev !== "\\") inTemplate = false;
        continue;
      }

      if (ch === "/" && text[i + 1] === "/") { inLineComment = true; continue; }
      if (ch === "/" && text[i + 1] === "*") { inBlockComment = true; continue; }
      if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }
      if (ch === "`") { inTemplate = true; continue; }

      if (pairs[ch]) {
        bracketStack.push({ char: ch, pos: i });
      } else if (closers[ch]) {
        const last = bracketStack.pop();
        if (!last || last.char !== closers[ch]) {
          diagnostics.push({
            from: i,
            to: i + 1,
            severity: "error",
            message: last ? `Mismatched bracket: expected '${pairs[last.char]}' but found '${ch}'` : `Unexpected closing bracket '${ch}'`,
          });
        }
      }
    }

    for (const unclosed of bracketStack) {
      diagnostics.push({
        from: unclosed.pos,
        to: unclosed.pos + 1,
        severity: "error",
        message: `Unclosed bracket '${unclosed.char}'`,
      });
    }

    if (isJsOrTs(fileName)) {
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const varMatch = line.match(/\bvar\s+/);
        if (varMatch) {
          const lineStart = doc.line(i + 1).from;
          const from = lineStart + (varMatch.index || 0);
          diagnostics.push({
            from,
            to: from + 3,
            severity: "warning",
            message: "Consider using 'const' or 'let' instead of 'var'",
          });
        }
      }
    }

    return diagnostics;
  });
}

const darkCustomTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "#0d1117",
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
    fontSize: "12px",
    lineHeight: "1.65rem",
  },
  ".cm-gutters": {
    backgroundColor: "#0d1117",
    borderRight: "1px solid #21262d",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#161b22",
  },
  ".cm-activeLine": {
    backgroundColor: "#161b2266",
  },
  ".cm-cursor": {
    borderLeftColor: "#c9d1d9",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "#264f78 !important",
  },
  ".cm-tooltip": {
    backgroundColor: "#1c2128",
    border: "1px solid #30363d",
    color: "#c9d1d9",
  },
  ".cm-tooltip-autocomplete": {
    backgroundColor: "#1c2128",
    border: "1px solid #30363d",
  },
  ".cm-tooltip-autocomplete > ul > li": {
    color: "#c9d1d9",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "#264f78",
    color: "#ffffff",
  },
  ".cm-completionLabel": {
    color: "#c9d1d9",
  },
  ".cm-completionDetail": {
    color: "#8b949e",
    fontStyle: "italic",
  },
  ".cm-completionMatchedText": {
    color: "#79c0ff",
    textDecoration: "none",
    fontWeight: "bold",
  },
  ".cm-diagnostic-error": {
    borderLeft: "3px solid #f85149",
  },
  ".cm-diagnostic-warning": {
    borderLeft: "3px solid #d29922",
  },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy #f85149",
  },
  ".cm-lintRange-warning": {
    backgroundImage: "none",
    textDecoration: "underline wavy #d29922",
  },
}, { dark: true });

const lightCustomTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "#fafbfc",
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
    fontSize: "12px",
    lineHeight: "1.65rem",
  },
  ".cm-gutters": {
    backgroundColor: "#f6f8fa",
    borderRight: "1px solid #e1e4e8",
    color: "#959da5",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#e8eaed",
  },
  ".cm-activeLine": {
    backgroundColor: "#f0f2f5",
  },
  ".cm-cursor": {
    borderLeftColor: "#24292e",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "#c8e1ff !important",
  },
  ".cm-diagnostic-error": {
    borderLeft: "3px solid #d73a49",
  },
  ".cm-diagnostic-warning": {
    borderLeft: "3px solid #e36209",
  },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy #d73a49",
  },
  ".cm-lintRange-warning": {
    backgroundImage: "none",
    textDecoration: "underline wavy #e36209",
  },
}, { dark: false });

export function CodeEditor({ file, openFiles, allFiles, projectId, onSave, onSelectFile, onCloseFile, onEditorContext, onAskAI, theme = "dark" }: CodeEditorProps) {
  const [hasChanges, setHasChanges] = useState(false);
  const [isFormatting, setIsFormatting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const onEditorContextRef = useRef(onEditorContext);
  onEditorContextRef.current = onEditorContext;
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());
  const fileRef = useRef<ProjectFile | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const fileIdRef = useRef<string | null>(null);
  const allFilesRef = useRef<ProjectFile[]>(allFiles || []);
  const fileNameRef = useRef<string>("");

  useEffect(() => {
    allFilesRef.current = allFiles || [];
  }, [allFiles]);

  useEffect(() => {
    fileNameRef.current = file?.name || "";
  }, [file?.name]);

  const getContent = useCallback(() => {
    return viewRef.current?.state.doc.toString() || "";
  }, []);

  const handleSave = useCallback(() => {
    const currentFile = fileRef.current;
    if (currentFile) {
      const currentContent = getContent();
      if (currentContent !== currentFile.content) {
        onSaveRef.current(currentFile.id, currentContent);
        setHasChanges(false);
      }
    }
  }, [getContent]);

  const handleFormat = useCallback(async () => {
    const currentFile = fileRef.current;
    const view = viewRef.current;
    if (!currentFile || !view) return;
    const parser = getPrettierParser(currentFile.name);
    if (!parser) return;
    setIsFormatting(true);
    try {
      const code = view.state.doc.toString();
      const formatted = await formatWithPrettier(code, parser);
      if (formatted !== code) {
        view.dispatch({
          changes: { from: 0, to: code.length, insert: formatted },
        });
        setHasChanges(formatted !== currentFile.content);
      }
    } catch (err) {
      console.error("Format error:", err);
    } finally {
      setIsFormatting(false);
    }
  }, []);

  useEffect(() => {
    if (!editorRef.current || !file) return;

    fileRef.current = file;

    if (viewRef.current && fileIdRef.current === file.id) {
      const currentContent = viewRef.current.state.doc.toString();
      if (currentContent !== file.content) {
        viewRef.current.dispatch({
          changes: { from: 0, to: currentContent.length, insert: file.content },
        });
        setHasChanges(false);
      }
      return;
    }

    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    fileIdRef.current = file.id;

    const langExtension = getLanguageExtension(file.name);

    const state = EditorState.create({
      doc: file.content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({
          override: [createProjectCompletionSource(allFilesRef, fileNameRef)],
          defaultKeymap: true,
          activateOnTyping: true,
          maxRenderedOptions: 50,
        }),
        createParameterHintTooltip(fileNameRef),
        createBasicJsLinter(fileNameRef),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        languageCompartment.current.of(langExtension),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...searchKeymap,
          ...closeBracketsKeymap,
          indentWithTab,
          {
            key: "Mod-s",
            run: () => {
              const currentFile = fileRef.current;
              if (currentFile) {
                const view = viewRef.current;
                if (view) {
                  onSaveRef.current(currentFile.id, view.state.doc.toString());
                  setHasChanges(false);
                }
              }
              return true;
            },
          },
          {
            key: "Shift-Alt-f",
            run: () => {
              handleFormat();
              return true;
            },
          },
        ]),
        ...(isEmmetSupported(file.name) ? [abbreviationTracker(), keymap.of([{ key: "Tab", run: expandAbbreviation }])] : []),
        themeCompartment.current.of(
          theme === "dark"
            ? [oneDark, darkCustomTheme]
            : [syntaxHighlighting(defaultHighlightStyle, { fallback: true }), lightCustomTheme]
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const currentFile = fileRef.current;
            if (currentFile) {
              const newContent = update.state.doc.toString();
              setHasChanges(newContent !== currentFile.content);
            }
          }
          if (update.docChanged || update.selectionSet) {
            const currentFile = fileRef.current;
            if (currentFile && onEditorContextRef.current) {
              const state = update.state;
              const sel = state.selection.main;
              const selectedText = sel.empty ? null : state.sliceDoc(sel.from, sel.to);
              const cursorLine = state.doc.lineAt(sel.head).number;
              onEditorContextRef.current({
                activeFile: currentFile.name,
                activeFilePath: currentFile.path || currentFile.name,
                selection: selectedText,
                cursorLine,
                fileContent: state.doc.toString(),
              });
            }
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;
    setHasChanges(false);

    return () => {
    };
  }, [file?.id, file?.content]);

  useEffect(() => {
    if (!file || !viewRef.current) return;
    const langExtension = getLanguageExtension(file.name);
    viewRef.current.dispatch({
      effects: languageCompartment.current.reconfigure(langExtension),
    });
  }, [file?.name]);

  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: themeCompartment.current.reconfigure(
        theme === "dark"
          ? [oneDark, darkCustomTheme]
          : [syntaxHighlighting(defaultHighlightStyle, { fallback: true }), lightCustomTheme]
      ),
    });
  }, [theme]);

  useEffect(() => {
    fileRef.current = file;
  }, [file]);

  useEffect(() => {
    return () => {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, []);

  if (!file) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
        <FileCode className="w-12 h-12 mb-3 opacity-30" />
        <p className="text-sm font-medium">No file open</p>
        <p className="text-xs mt-1">Select a file from the explorer to edit</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center border-b overflow-x-auto">
        <div className="flex items-center min-w-0">
          {openFiles.map((f) => (
            <div
              key={f.id}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs border-r shrink-0 transition-colors cursor-pointer ${
                f.id === file.id
                  ? "bg-background text-foreground"
                  : "bg-card text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => onSelectFile(f)}
              data-testid={`tab-file-${f.name}`}
            >
              <span className="truncate max-w-[120px]">{f.name}</span>
              {f.id === file.id && hasChanges && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              )}
              <span
                role="button"
                className="ml-1 rounded-sm hover:bg-muted p-0.5 inline-flex"
                onClick={(e) => { e.stopPropagation(); onCloseFile(f.id); }}
                data-testid={`button-close-tab-${f.name}`}
              >
                <X className="w-3 h-3" />
              </span>
            </div>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 px-2 shrink-0">
          <Badge variant="outline" className="text-[10px]">{getLanguageClass(file.name)}</Badge>
          {isEmmetSupported(file.name) && (
            <Badge variant="secondary" className="text-[10px]">Emmet</Badge>
          )}
          {getPrettierParser(file.name) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleFormat}
                  disabled={isFormatting}
                  className="h-6 px-2 text-[10px] gap-1"
                  data-testid="button-format-file"
                >
                  {isFormatting ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlignLeft className="w-3 h-3" />}
                  Format
                </Button>
              </TooltipTrigger>
              <TooltipContent>Format with Prettier (Shift+Alt+F)</TooltipContent>
            </Tooltip>
          )}
          {projectId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant={showHistory ? "secondary" : "ghost"}
                  onClick={() => setShowHistory(h => !h)}
                  className="h-6 px-2 text-[10px] gap-1"
                  data-testid="button-file-history"
                >
                  <History className="w-3 h-3" />
                  History
                </Button>
              </TooltipTrigger>
              <TooltipContent>View file version history</TooltipContent>
            </Tooltip>
          )}
          {hasChanges && (
            <Button size="sm" variant="ghost" onClick={handleSave} data-testid="button-save-file">
              <Save className="w-3 h-3 mr-1" />
              Save
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex">
        <div className="flex-1 overflow-hidden" ref={editorRef} data-testid="textarea-code-editor" />
        {showHistory && file && projectId && (
          <div className="w-64 shrink-0">
            <FileHistoryPanel
              projectId={projectId}
              file={file}
              onClose={() => setShowHistory(false)}
              onRestored={() => setShowHistory(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
