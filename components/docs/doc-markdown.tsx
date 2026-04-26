import {
  isValidElement,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { MermaidBlock } from "./mermaid-block";
import { cn } from "@/lib/utils";

/**
 * Mermaid in Markdown is a fenced ` ```mermaid ` block (becomes <pre><code class="language-mermaid">).
 */
function PreForMarkdown(
  props: ComponentPropsWithoutRef<"pre"> & { children?: ReactNode },
) {
  const { children, className, ...rest } = props;
  if (isValidElement(children)) {
    const cprops = children.props as {
      className?: string;
      children?: ReactNode;
    };
    if (
      typeof cprops.className === "string" &&
      cprops.className.includes("language-mermaid")
    ) {
      const text = String(cprops.children).replace(/\n$/, "");
      return <MermaidBlock chart={text} />;
    }
  }
  return (
    <pre
      className={cn(
        "my-4 overflow-x-auto rounded-lg border border-border bg-muted/40 p-4 text-sm",
        className,
      )}
      {...rest}
    >
      {children}
    </pre>
  );
}

const components: Components = {
  pre: PreForMarkdown,
  a: ({ href, children, ...rest }) => (
    <a
      href={href}
      className="font-medium text-primary underline underline-offset-4"
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
      {...rest}
    >
      {children}
    </a>
  ),
  h1: ({ children }) => (
    <h1 className="scroll-mt-20 text-3xl font-bold tracking-tight text-foreground">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-10 scroll-mt-20 border-b border-border pb-2 text-2xl font-semibold tracking-tight first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-8 scroll-mt-20 text-xl font-semibold tracking-tight">
      {children}
    </h3>
  ),
  p: ({ children }) => <p className="leading-7 text-foreground/90 [&:not(:first-child)]:mt-4">{children}</p>,
  ul: ({ children }) => <ul className="my-4 ml-6 list-disc space-y-2 marker:text-muted-foreground">{children}</ul>,
  ol: ({ children }) => (
    <ol className="my-4 ml-6 list-decimal space-y-2 marker:text-muted-foreground">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-7 pl-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mt-4 border-l-4 border-primary/30 bg-muted/30 py-1 pl-4 pr-2 text-muted-foreground">
      {children}
    </blockquote>
  ),
  code: (props) => {
    const { className, children, ...rest } = props;
    if (className?.includes("language-")) {
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-sm"
        {...rest}
      >
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="my-4 w-full overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border bg-muted/50 px-4 py-2 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border px-4 py-2 align-top text-foreground/90">{children}</td>
  ),
  tr: ({ children }) => <tr>{children}</tr>,
  img: (props) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={props.alt ?? ""}
      src={typeof props.src === "string" ? props.src : undefined}
      className="my-6 max-w-full rounded-md border border-border"
    />
  ),
  hr: () => <hr className="my-10 border-border" />,
};

type DocMarkdownProps = { markdown: string; className?: string };

export function DocMarkdown({ markdown, className }: DocMarkdownProps) {
  return (
    <div
      className={cn(
        "prose prose-neutral max-w-none dark:prose-invert prose-headings:scroll-mt-20 prose-p:leading-relaxed",
        "prose-table:my-0 prose-figure:my-6",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
