import { StringStream } from "@codemirror/language";
import { createStreamLanguage } from "./createStreamLanguage";

const ps1Keywords = new Set([
  "function", "filter", "workflow", "class", "enum", "interface",
  "if", "else", "elseif", "switch", "for", "foreach", "while", "do",
  "until", "break", "continue", "return", "exit", "throw", "trap",
  "try", "catch", "finally", "param", "dynamicparam",
  "begin", "process", "end", "inlinescript",
  "parallel", "sequence",
]);

const ps1Cmdlets = new Set([
  "get-childitem", "get-content", "set-content", "get-item", "set-item",
  "remove-item", "new-item", "invoke-item", "move-item", "copy-item",
  "get-process", "stop-process", "start-process", "wait-process",
  "get-service", "stop-service", "start-service", "restart-service",
  "set-service", "new-service",
  "get-command", "get-help", "get-member", "get-alias", "set-alias",
  "import-module", "remove-module", "get-module",
  "write-host", "write-output", "write-warning", "write-error",
  "write-verbose", "write-debug", "write-information",
  "read-host", "out-host", "out-file", "out-string", "out-null",
  "select-object", "where-object", "foreach-object", "sort-object",
  "group-object", "measure-object", "compare-object",
  "format-table", "format-list", "format-wide", "format-custom",
  "convertto-json", "convertfrom-json", "convertto-csv", "convertfrom-csv",
  "convertto-html", "convertto-xml",
  "invoke-command", "invoke-expression", "invoke-restmethod",
  "invoke-webrequest", "new-object", "add-member",
  "test-path", "resolve-path", "join-path", "split-path",
  "get-location", "set-location", "push-location", "pop-location",
  "get-variable", "set-variable", "new-variable", "remove-variable",
  "get-date", "set-date", "start-sleep",
  "select-string", "match", "replace",
  "export-csv", "import-csv",
  "send-mailmessage",
  "enable-psremoting", "enter-pssession", "exit-pssession",
  "new-pssession", "remove-pssession", "get-pssession",
]);

const ps1Operators = new Set([
  "-eq", "-ne", "-gt", "-ge", "-lt", "-le",
  "-like", "-notlike", "-match", "-notmatch",
  "-contains", "-notcontains", "-in", "-notin",
  "-replace", "-split", "-join",
  "-and", "-or", "-xor", "-not", "-band", "-bor", "-bxor", "-bnot",
  "-shl", "-shr",
  "-is", "-isnot", "-as",
  "-f",
]);

const ps1StreamParser = {
  name: "powershell",

  startState() {
    return {
      inString: false,
      stringChar: null,
      inHereString: false,
      hereStringTag: "",
    };
  },

  token(stream: StringStream, state: {
    inString: boolean;
    stringChar: string | null;
    inHereString: boolean;
    hereStringTag: string;
  }) {
    if (state.inHereString) {
      if (stream.match(state.hereStringTag)) {
        state.inHereString = false;
        state.hereStringTag = "";
        return "string";
      }
      stream.skipToEnd();
      return "string";
    }

    if (state.inString) {
      const ch = stream.next();
      if (ch === "`") {
        stream.next();
        return "escape";
      }
      if (ch === state.stringChar) {
        state.inString = false;
        state.stringChar = null;
      }
      return "string";
    }

    if (stream.eatSpace()) return null;

    const ch = stream.peek();

    if (ch === "#") {
      stream.skipToEnd();
      return "comment";
    }

    if (ch === "<" && stream.match("<#", false)) {
      stream.match("<#");
      if (stream.match(/[\s\S]*?#>/)) {
        return "comment";
      }
      stream.skipToEnd();
      return "comment";
    }

    if (ch === "@") {
      stream.next();
      if (stream.peek() === "'") {
        stream.next();
        const tagMatch = stream.match(/^[a-zA-Z0-9_]*\n/);
        if (tagMatch && typeof tagMatch !== "boolean") {
          state.inHereString = true;
          state.hereStringTag = "'" + tagMatch[0].trim() + "'";
          return "string";
        }
        return "string";
      }
      if (stream.peek() === '"') {
        stream.next();
        const tagMatch = stream.match(/^[a-zA-Z0-9_]*\n/);
        if (tagMatch && typeof tagMatch !== "boolean") {
          state.inHereString = true;
          state.hereStringTag = '"' + tagMatch[0].trim() + '"';
          return "string";
        }
        return "string";
      }
      if (stream.peek() === "{") {
        stream.next();
        return "punctuation";
      }
      if (stream.peek() === "(") {
        stream.next();
        return "punctuation";
      }
      return "punctuation";
    }

    if (ch === '"' || ch === "'") {
      state.inString = true;
      state.stringChar = ch;
      stream.next();
      return "string";
    }

    if (ch === "$") {
      stream.next();
      if (stream.match(/^(?:global|local|script|private|env|function|variable):[a-zA-Z_][a-zA-Z0-9_]*/)) {
        return "variableName.special";
      }
      if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
        return "variableName";
      }
      if (stream.peek() === "{") {
        stream.next();
        stream.match(/^[^}]+/);
        if (stream.peek() === "}") stream.next();
        return "variableName";
      }
      return "variableName";
    }

    if (ch === "-") {
      const opMatch = stream.match(/^-[a-zA-Z][a-zA-Z0-9]*/);
      if (opMatch && typeof opMatch !== "boolean") {
        const op = opMatch[0].toLowerCase();
        if (ps1Operators.has(op)) return "operator";
        return "propertyName";
      }
    }

    if (ch === "`") {
      stream.next();
      stream.next();
      return "escape";
    }

    if (ch === "." && stream.match(/^\.\.[\\/]/)) {
      return "punctuation";
    }

    if (stream.match(/^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/)) {
      return "number";
    }

    if (stream.match(/^0x[0-9a-fA-F]+/)) {
      return "number";
    }

    // 命令名词包含连字符（如 Get-ChildItem），因此字符类需包含 "-"
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_-]*/)) {
      const w = stream.current().toLowerCase();
      if (ps1Keywords.has(w)) return "keyword";
      if (w.endsWith("-object") || w.endsWith("-string") || w.endsWith("-item") ||
          w.endsWith("-process") || w.endsWith("-service") || w.endsWith("-path") ||
          w.endsWith("-variable") || w.endsWith("-content") || w.endsWith("-location") ||
          w.endsWith("-command") || w.endsWith("-module") || w.startsWith("get-") ||
          w.startsWith("set-") || w.startsWith("new-") || w.startsWith("remove-") ||
          w.startsWith("invoke-") || w.startsWith("start-") || w.startsWith("stop-") ||
          w.startsWith("import-") || w.startsWith("export-") || w.startsWith("write-") ||
          w.startsWith("out-") || w.startsWith("select-") || w.startsWith("where-") ||
          w.startsWith("foreach-") || w.startsWith("format-") || w.startsWith("convertto-") ||
          w.startsWith("convertfrom-") || w.startsWith("add-") || w.startsWith("test-") ||
          w.startsWith("enable-") || w.startsWith("disable-") || w.startsWith("enter-") ||
          w.startsWith("exit-")) {
        return "keyword";
      }
      if (ps1Cmdlets.has(w)) return "keyword";
      if (w === "true" || w === "false") return "bool";
      if (w === "$null" || w === "null") return "null";
      return null;
    }

    if (ch === "{" || ch === "}" || ch === "(" || ch === ")" ||
        ch === "[" || ch === "]") {
      stream.next();
      return "punctuation";
    }

    if (ch === "|" || ch === ">" || ch === "<" || ch === "&") {
      stream.next();
      if (stream.peek() === ">" || stream.peek() === "&") stream.next();
      return "operator";
    }

    if (ch === "=" || ch === "!" || ch === "+" || ch === "-" ||
        ch === "*" || ch === "/" || ch === "%" || ch === "," ||
        ch === ";" || ch === ":" || ch === "?") {
      stream.next();
      return "punctuation";
    }

    stream.next();
    return null;
  },
};

export const powershell = createStreamLanguage(ps1StreamParser);
