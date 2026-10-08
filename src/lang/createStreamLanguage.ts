import { StreamLanguage, LanguageSupport, type StringStream } from "@codemirror/language";

/**
 * 用统一的样板（blankLine / indent）把 StreamParser 包装成 LanguageSupport 工厂。
 * toml / bat / powershell 等自定义语言共用此逻辑。
 */
export function createStreamLanguage<State>(parser: {
  name: string;
  startState: () => State;
  token: (stream: StringStream, state: State) => string | null;
}): () => LanguageSupport {
  const language = StreamLanguage.define<State>({
    name: parser.name,
    startState: parser.startState,
    token: parser.token,
    blankLine() {},
    indent() {
      return 0;
    },
  });
  return () => new LanguageSupport(language);
}
