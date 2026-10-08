import { StringStream } from "@codemirror/language";
import { createStreamLanguage } from "./createStreamLanguage";

const tomlStreamParser = {
  name: "toml",
  startState() {
    return { inString: false, stringType: null };
  },
  token(stream: StringStream, state: { inString: boolean; stringType: string | null }) {
    // Strings
    if (state.inString) {
      const ch = stream.next();
      if (ch === "\\") {
        stream.next();
        return "string.escape";
      }
      if ((state.stringType === '"' && ch === '"') || (state.stringType === "'" && ch === "'")) {
        state.inString = false;
        state.stringType = null;
      }
      return "string";
    }

    // Comments
    if (stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }

    // Skip whitespace
    if (stream.eatSpace()) return null;

    // Table headers [section] or [[array]]
    if (stream.sol() && stream.peek() === "[") {
      stream.next();
      if (stream.peek() === "[") {
        stream.next();
        // Array of tables [[...]]
        if (stream.skipTo("]]")) {
          stream.next();
          stream.next();
        } else {
          stream.skipToEnd();
        }
      } else {
        // Table [...]
        if (stream.skipTo("]")) {
          stream.next();
        } else {
          stream.skipToEnd();
        }
      }
      return "heading";
    }

    // Strings (start)
    const ch = stream.peek();
    if (ch === '"' || ch === "'") {
      state.inString = true;
      state.stringType = ch;
      stream.next();
      return "string";
    }

    // Date/time (must be checked before numbers, otherwise the leading year is
    // tokenized as a number and these branches are unreachable)
    if (stream.match(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/)) {
      stream.match(/(\.\d+)?(Z|[+-]\d{2}:\d{2})?/);
      return "string.special";
    }
    if (stream.match(/^\d{4}-\d{2}-\d{2}/)) {
      return "string.special";
    }

    // Numbers (integer and float)
    if (stream.match(/^[+-]?\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d[\d_]*)?/) ||
        stream.match(/^[+-]?0x[\da-fA-F_]+/) ||
        stream.match(/^[+-]?0o[0-7_]+/) ||
        stream.match(/^[+-]?0b[01_]+/) ||
        stream.match(/^[+-]?(inf|nan)/)) {
      return "number";
    }

    // Booleans
    if (stream.match("true") || stream.match("false")) {
      return "bool";
    }

    // Dotted keys and = sign (exclude "." so dotted keys are tokenized here
    // instead of being swallowed whole)
    if (stream.eatWhile(/[^\s=#.\[\]'",]/)) {
      return "propertyName";
    }

    // Equals sign
    if (stream.eat("=")) {
      return "punctuation";
    }

    // Dots in keys
    if (stream.eat(".")) {
      return "punctuation";
    }

    stream.next();
    return null;
  },
};

export const toml = createStreamLanguage(tomlStreamParser);
