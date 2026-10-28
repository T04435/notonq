"use client";

import { cn } from "cn";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";

/** The app's one code box: the core shadcn Code Block, highlighted on the client, with a title and a copy button. */
export function Code({ code, language, title, className }: { code: string; language: string; title?: string; className?: string }) {
  const lines = useHighlightedCode(code, language);
  return (
    <CodeBlock size="sm" className={className}>
      <CodeBlockHeader>
        <CodeBlockTitle>{title ?? language}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent>
        {lines.map((line, i) => (
          <CodeBlockLine key={i}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

/** A line split into code and its trailing comment (# or //, after a space or at the start). URLs keep their //. */
function splitComment(line: string): [code: string, comment: string] {
  const m = /(^|\s)(#|\/\/)(\s|$)/.exec(line);
  if (!m) return [line, ""];
  const at = m.index + m[1].length;
  return [line.slice(0, at), line.slice(at)];
}

/** The docs code box (Console board "Docs components"): a title bar with what it is and the language, ink text,
 * comments dim, and the lines NotOnQ adds to a Qloo response in amber (`added`, 0-based line numbers). */
export function DocsCode({ code, language, title, added = [], className }: { code: string; language: string; title: string; added?: number[]; className?: string }) {
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <CodeBlock className={cn("border-border bg-surface dark:bg-surface", className)}>
      <CodeBlockHeader className="gap-3 border-b px-3.5 py-2 pt-2 text-xs">
        <CodeBlockTitle className="text-xs font-normal text-muted-foreground">{title}</CodeBlockTitle>
        <span className="ms-auto shrink-0 text-muted-foreground">{language}</span>
        <CodeBlockActions className="ms-0">
          <CodeBlockCopyButton value={code} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent className="p-3.5 pt-3.5! text-[12.5px] leading-[1.75] text-foreground">
        {lines.map((line, i) => {
          if (added.includes(i)) {
            return (
              <CodeBlockLine key={i} className="text-fill">
                {line}
              </CodeBlockLine>
            );
          }
          const [text, comment] = splitComment(line);
          return (
            <CodeBlockLine key={i}>
              {text}
              {comment ? <span className="text-dim">{comment}</span> : null}
            </CodeBlockLine>
          );
        })}
      </CodeBlockContent>
    </CodeBlock>
  );
}
