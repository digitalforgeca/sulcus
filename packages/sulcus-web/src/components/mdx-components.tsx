import type { MDXComponents } from "mdx/types";
import Link from "next/link";

// Shared styling for all MDX content — Sulcus dark theme
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: ({ children }) => (
      <h1 className="text-3xl font-bold tracking-widest text-[#D4AF37] uppercase mb-6 mt-12 first:mt-0">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-xl font-bold tracking-widest text-[#D4AF37] uppercase mb-4 mt-10 border-b border-[#D4AF37]/10 pb-2">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-sm font-bold tracking-widest text-[#00F0FF] uppercase mb-3 mt-8">
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-xs font-bold tracking-widest text-[#888] uppercase mb-2 mt-6">
        {children}
      </h4>
    ),
    p: ({ children }) => (
      <p className="text-sm text-[#ccc] leading-relaxed mb-4">{children}</p>
    ),
    a: ({ href, children }) => {
      const isExternal = href?.startsWith("http");
      if (isExternal) {
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#00F0FF] hover:underline">
            {children}
          </a>
        );
      }
      return <Link href={href ?? "#"} className="text-[#00F0FF] hover:underline">{children}</Link>;
    },
    code: ({ children, className }) => {
      // Inline code vs code blocks
      const isBlock = className?.includes("language-");
      if (isBlock) {
        return (
          <code className={`${className} text-xs`}>{children}</code>
        );
      }
      return (
        <code className="text-xs text-[#50FA7B] bg-[#050a0f] px-1.5 py-0.5 border border-[#333] font-mono">
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre className="text-xs bg-[#050a0f] border border-[#333] p-4 mb-6 overflow-x-auto font-mono leading-relaxed">
        {children}
      </pre>
    ),
    ul: ({ children }) => (
      <ul className="text-sm text-[#ccc] leading-relaxed mb-4 pl-6 list-disc space-y-1">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="text-sm text-[#ccc] leading-relaxed mb-4 pl-6 list-decimal space-y-1">{children}</ol>
    ),
    li: ({ children }) => <li className="text-sm text-[#ccc]">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-[#D4AF37]/30 pl-4 my-4 text-sm text-[#888] italic">
        {children}
      </blockquote>
    ),
    table: ({ children }) => (
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-xs border-collapse border border-[#333]">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="bg-[#0a1520] border border-[#333] px-3 py-2 text-left text-[#D4AF37] uppercase tracking-widest font-bold">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-[#333] px-3 py-2 text-[#ccc]">{children}</td>
    ),
    hr: () => <hr className="border-[#D4AF37]/10 my-8" />,
    strong: ({ children }) => <strong className="text-[#ededed] font-bold">{children}</strong>,
    em: ({ children }) => <em className="text-[#D4AF37]/80">{children}</em>,
    ...components,
  };
}
