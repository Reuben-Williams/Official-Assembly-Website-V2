import { ArrowRight } from "lucide-react";
import Link from "next/link";

import {
  builderLink,
  builderSectionIds,
  builderText,
  type BuilderServerContent,
} from "../../lib/builder/server-content";
import type { Card } from "../data/site";

type CardsProps = {
  cards: Card[];
  regionId: string;
  itemRegionPrefix?: string;
  instance?: string;
  featuredFirst?: boolean;
  columns?: "two" | "three";
  content?: BuilderServerContent;
};

const EMPTY_CONTENT: BuilderServerContent = { regions: {} };

export function Cards({
  cards,
  regionId,
  itemRegionPrefix = regionId,
  instance = "primary",
  featuredFirst = false,
  columns = "three",
  content = EMPTY_CONTENT,
}: CardsProps) {
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const orderedCards = builderSectionIds(content, regionId, cards.map((card) => card.id))
    .flatMap((id) => cardsById.get(id) ?? []);
  return (
    <div
      className={`card-grid ${columns === "two" ? "two" : ""}`}
      data-builder-instance={instance}
      data-builder-region={regionId}
      data-builder-kind="sections"
    >
      {orderedCards.map((card, index) => {
        const Icon = card.icon;
        const className = featuredFirst && index === 0 ? "info-card featured" : "info-card";
        const prefix = `${itemRegionPrefix}.${card.id}`;
        const hasLink = Boolean(card.href) || content.regions[`${prefix}.link`]?.type === "link";
        const link = hasLink ? builderLink(content, `${prefix}.link`, {
          href: card.href ?? "#",
          label: "Open",
        }) : null;
        return (
          <article className={className} data-builder-item-id={card.id} key={card.id}>
            <div className="icon-box">
              <Icon size={24} aria-hidden="true" />
            </div>
            {card.tag ? <span className="tag">{card.tag}</span> : null}
            <h3 data-builder-region={`${prefix}.title`} data-builder-kind="text">
              {builderText(content, `${prefix}.title`, card.title)}
            </h3>
            <p data-builder-region={`${prefix}.body`} data-builder-kind="text">
              {builderText(content, `${prefix}.body`, card.text)}
            </p>
            {link ? (
              <Link
                className="card-link"
                data-builder-region={`${prefix}.link`}
                data-builder-kind="link"
                href={link.href}
              >
                <span data-builder-link-label>{link.label}</span>
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
