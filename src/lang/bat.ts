import { StringStream } from "@codemirror/language";
import { createStreamLanguage } from "./createStreamLanguage";

const batKeywords = new Set([
  "echo", "set", "if", "else", "for", "do", "in", "goto", "call", "exit",
  "pause", "rem", "cls", "title", "color", "mode", "ver", "vol", "label",
  "start", "del", "copy", "move", "ren", "rename", "md", "mkdir", "rd",
  "rmdir", "type", "find", "findstr", "sort", "more", "pushd", "popd",
  "chdir", "cd", "dir", "path", "setlocal", "endlocal", "shift",
  "choice", "attrib", "xcopy", "robocopy", "tasklist", "taskkill",
  "reg", "net", "sc", "wmic", "powershell", "cmd", "format", "chkdsk",
  "subst", "assoc", "ftype", "where", "timeout", "ping", "ipconfig",
  "systeminfo", "hostname", "shutdown", "logoff", "runas",
]);

const batConditionalKeywords = new Set([
  "exist", "not", "defined", "errorlevel", "equ", "neq", "lss", "leq",
  "gtr", "geq",
]);

// 关键字判定（两处 token 分支共用）
function batKeywordType(word: string): "keyword" | null {
  if (batKeywords.has(word)) return "keyword";
  if (batConditionalKeywords.has(word)) return "keyword";
  return null;
}

const batStreamParser = {
  name: "bat",

  startState() {
    return { inString: false, stringChar: null, inLabel: false };
  },

  token(stream: StringStream, state: { inString: boolean; stringChar: string | null; inLabel: boolean }) {
    if (state.inLabel) {
      stream.skipToEnd();
      state.inLabel = false;
      return "labelName";
    }

    if (state.inString) {
      const ch = stream.next();
      if (ch === "^") {
        stream.next();
        return "escape";
      }
      if (ch === state.stringChar) {
        state.inString = false;
        state.stringChar = null;
      }
      return "string";
    }

    if (stream.sol()) {
      stream.eatSpace();

      if (stream.peek() === ":") {
        stream.next();
        if (stream.peek() === ":") {
          stream.next();
          stream.skipToEnd();
          return "comment";
        }
        state.inLabel = true;
        return "label";
      }

      if (stream.match(/^rem\b/i)) {
        stream.skipToEnd();
        return "comment";
      }

      if (stream.peek() === "@") {
        stream.next();
        return "punctuation";
      }

      const wordMatch = stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
      if (wordMatch && typeof wordMatch !== "boolean") {
        const w = wordMatch[0].toLowerCase();
        return batKeywordType(w) ?? "variableName";
      }
    }

    if (stream.eatSpace()) return null;

    const ch = stream.peek();

    if (ch === "%") {
      stream.next();
      const next = stream.peek();
      if (next === "%") {
        stream.next();
        if (stream.match(/^[a-zA-Z0-9_]+%/)) {
          return "variableName.special";
        }
        return "variableName";
      }
      if (next === "~") {
        stream.next();
        stream.match(/^[a-zA-Z0-9_]+%/);
        return "variableName.special";
      }
      if (stream.match(/^[0-9]+%/)) {
        return "variableName.special";
      }
      if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*%/)) {
        return "variableName.special";
      }
      return "punctuation";
    }

    if (ch === "!" && !state.inString) {
      stream.next();
      if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*!/)) {
        return "variableName.special";
      }
      return "punctuation";
    }

    if (ch === '"' || ch === "'") {
      state.inString = true;
      state.stringChar = ch;
      stream.next();
      return "string";
    }

    if (ch === "^") {
      stream.next();
      stream.next();
      return "escape";
    }

    if (ch === "(" || ch === ")") {
      stream.next();
      return "punctuation";
    }

    if (ch === "=") {
      stream.next();
      return "operator";
    }

    if (ch === ">") {
      stream.next();
      if (stream.peek() === ">") stream.next();
      if (stream.peek() === "&") stream.next();
      return "operator";
    }

    if (ch === "<") {
      stream.next();
      if (stream.peek() === "&") stream.next();
      return "operator";
    }

    if (ch === "&") {
      stream.next();
      if (stream.peek() === "&") stream.next();
      return "operator";
    }

    if (ch === "|") {
      stream.next();
      if (stream.peek() === "|") stream.next();
      return "operator";
    }

    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
      const w = stream.current().toLowerCase();
      return batKeywordType(w);
    }

    stream.next();
    return null;
  },
};

export const bat = createStreamLanguage(batStreamParser);
