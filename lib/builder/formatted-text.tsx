import { createElement, Fragment, type ReactNode, type CSSProperties } from "react";
import { parseDocument } from "htmlparser2";

const blocks = new Set(["p", "div", "ul", "ol", "li", "blockquote", "h2", "h3", "h4", "hr"]);
const inlineTags = new Set(["strong", "b", "em", "i", "u", "s", "strike", "br", "span", "mark"]);
const discard = new Set(["script", "style", "iframe", "object", "svg", "math", "template"]);
type Node = ReturnType<typeof parseDocument>["children"][number];

function formattingColors(source = ""): CSSProperties {
  const style: CSSProperties = {};
  for (const declaration of source.split(";")) {
    const [property, raw] = declaration.split(":");
    const value = raw?.trim();
    if (!value || !/^(#[\da-f]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]+)$/i.test(value)) continue;
    if (property.trim().toLowerCase() === "color") style.color = value;
    if (property.trim().toLowerCase() === "background-color") style.backgroundColor = value;
  }
  return style;
}

// Parse saved editor HTML into an allowlisted React tree. Never inject raw HTML,
// event attributes, embedded media, or script-capable links into public pages.
export function formattedEditorText(source: string, inline = false): ReactNode {
  function render(node: Node, key: number): ReactNode {
    if (node.type === "text") return node.data;
    if (node.type !== "tag" || discard.has(node.name)) return null;
    const children = node.children.map(render);
    if (node.name === "a") {
      const href = node.attribs.href ?? "";
      return /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(href)
        ? <a key={key} href={href}>{children}</a>
        : <Fragment key={key}>{children}</Fragment>;
    }
    if (inlineTags.has(node.name) || (!inline && blocks.has(node.name))) {
      return createElement(node.name, { key, style: formattingColors(node.attribs.style) }, ...(["br", "hr"].includes(node.name) ? [] : children));
    }
    return <Fragment key={key}>{children}</Fragment>;
  }
  return parseDocument(source).children.map(render);
}
