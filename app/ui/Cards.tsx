import { ArrowRight } from "lucide-react";
import Link from "next/link";

import type { Card } from "../data/site";

type CardsProps = {
  cards: Card[];
  regionId: string;
  itemRegionPrefix?: string;
  instance?: string;
  featuredFirst?: boolean;
  columns?: "two" | "three";
};

export function Cards({
  cards,
  regionId,
  itemRegionPrefix = regionId,
  instance = "primary",
  featuredFirst = false,
  columns = "three"
}: CardsProps) {
  return (
    <div
      className={`card-grid ${columns === "two" ? "two" : ""}`}
      data-builder-instance={instance}
      data-builder-region={regionId}
      data-builder-kind="sections"
    >
      {cards.map((card, index) => {
        const Icon = card.icon;
        const className = featuredFirst && index === 0 ? "info-card featured" : "info-card";
        const prefix = `${itemRegionPrefix}.${card.id}`;
        return (
          <article className={className} data-builder-item-id={card.id} key={card.id}>
            <div className="icon-box">
              <Icon size={24} aria-hidden="true" />
            </div>
            {card.tag ? <span className="tag">{card.tag}</span> : null}
            <h3 data-builder-region={`${prefix}.title`} data-builder-kind="text">
              {card.title}
            </h3>
            <p data-builder-region={`${prefix}.body`} data-builder-kind="text">
              {card.text}
            </p>
            {card.href ? (
              <Link
                className="card-link"
                data-builder-region={`${prefix}.link`}
                data-builder-kind="link"
                href={card.href}
              >
                <span data-builder-link-label>Open</span>
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
