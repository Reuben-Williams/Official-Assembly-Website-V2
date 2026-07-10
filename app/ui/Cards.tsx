import { ArrowRight } from "lucide-react";
import Link from "next/link";

import type { Card } from "../data/site";

type CardsProps = {
  cards: Card[];
  featuredFirst?: boolean;
  columns?: "two" | "three";
};

export function Cards({
  cards,
  featuredFirst = false,
  columns = "three"
}: CardsProps) {
  return (
    <div className={`card-grid ${columns === "two" ? "two" : ""}`}>
      {cards.map((card, index) => {
        const Icon = card.icon;
        const className =
          featuredFirst && index === 0 ? "info-card featured" : "info-card";
        return (
          <article className={className} key={card.title}>
            <div className="icon-box">
              <Icon size={24} aria-hidden="true" />
            </div>
            {card.tag ? <span className="tag">{card.tag}</span> : null}
            <h3>{card.title}</h3>
            <p>{card.text}</p>
            {card.href ? (
              <Link className="card-link" href={card.href}>
                Open <ArrowRight size={17} aria-hidden="true" />
              </Link>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
