import type { ReactNode } from "react";

type RichTextNode = {
  type?: unknown;
  text?: unknown;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type?: unknown; attrs?: Record<string, unknown> }>;
  content?: RichTextNode[];
};

function safeHref(value: unknown) {
  if (typeof value !== "string" || !value || value.startsWith("//") ||
      !(/^(?:\/|#|mailto:|tel:|https:\/\/)/i.test(value))) {
    throw new TypeError("Post content contains an unsafe link.");
  }
  return value;
}

function markedText(node: RichTextNode, key: string): ReactNode {
  if (typeof node.text !== "string") throw new TypeError("Post text is invalid.");
  let content: ReactNode = node.text;
  for (const [index, mark] of (node.marks ?? []).entries()) {
    const markKey = `${key}:mark:${index}`;
    if (mark.type === "bold") content = <strong key={markKey}>{content}</strong>;
    else if (mark.type === "italic") content = <em key={markKey}>{content}</em>;
    else if (mark.type === "underline") content = <u key={markKey}>{content}</u>;
    else if (mark.type === "strike") content = <s key={markKey}>{content}</s>;
    else if (mark.type === "code") content = <code key={markKey}>{content}</code>;
    else if (mark.type === "link") {
      const href = safeHref(mark.attrs?.href);
      const target = mark.attrs?.target === "_blank" ? "_blank" : undefined;
      content = <a href={href} key={markKey} target={target} {...(target ? { rel: "noopener noreferrer" } : {})}>{content}</a>;
    } else throw new TypeError("Post content contains an unsupported text mark.");
  }
  return content;
}

function renderNodes(nodes: RichTextNode[] | undefined, parentKey: string): ReactNode[] {
  return (nodes ?? []).map((node, index) => renderNode(node, `${parentKey}:${index}`));
}

function renderNode(node: RichTextNode, key: string): ReactNode {
  if (node.type === "text") return <span key={key}>{markedText(node, key)}</span>;
  if (node.type === "paragraph") return <p key={key}>{renderNodes(node.content, key)}</p>;
  if (node.type === "blockquote") return <blockquote key={key}>{renderNodes(node.content, key)}</blockquote>;
  if (node.type === "bulletList") return <ul key={key}>{renderNodes(node.content, key)}</ul>;
  if (node.type === "orderedList") return <ol key={key}>{renderNodes(node.content, key)}</ol>;
  if (node.type === "listItem") return <li key={key}>{renderNodes(node.content, key)}</li>;
  if (node.type === "horizontalRule") return <hr key={key} />;
  if (node.type === "hardBreak") return <br key={key} />;
  if (node.type === "heading") {
    const level = node.attrs?.level;
    if (level === 2) return <h2 key={key}>{renderNodes(node.content, key)}</h2>;
    if (level === 3) return <h3 key={key}>{renderNodes(node.content, key)}</h3>;
    if (level === 4) return <h4 key={key}>{renderNodes(node.content, key)}</h4>;
  }
  throw new TypeError("Post content contains an unsupported node.");
}

export function PostBody({ document }: { document: unknown }) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new TypeError("Post content is invalid.");
  }
  const record = document as { version?: unknown; type?: unknown; content?: unknown };
  if (record.version !== 1 || record.type !== "doc" || !Array.isArray(record.content)) {
    throw new TypeError("Post content is invalid.");
  }
  return <div className="post-body">{renderNodes(record.content as RichTextNode[], "post")}</div>;
}
