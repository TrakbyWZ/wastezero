"use client";

import mermaid from "mermaid";
import { useEffect, useId, useRef, useState } from "react";

type Props = { chart: string };

export function MermaidBlock({ chart }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const reactId = useId().replace(/[:]/g, "");
  const [id] = useState(() => `mermaid-${reactId}`);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const run = () => {
      setErr(null);
      const dark = document.documentElement.classList.contains("dark");
      mermaid.initialize({
        startOnLoad: false,
        theme: dark ? "dark" : "default",
        securityLevel: "loose",
      });
      el.replaceChildren();
      mermaid
        .render(id, chart)
        .then(({ svg }) => {
          el.innerHTML = svg;
        })
        .catch((e: unknown) => {
          setErr(e instanceof Error ? e.message : "Could not render diagram");
        });
    };

    run();

    const obs = new MutationObserver(() => run());
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, [chart, id]);

  if (err) {
    return (
      <div className="my-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
        {err}
      </div>
    );
  }

  return <div ref={containerRef} className="my-4 flex justify-center overflow-x-auto" />;
}
