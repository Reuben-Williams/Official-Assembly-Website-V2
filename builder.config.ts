import type { BuilderSiteConfig } from "@reuben-williams/core";

export default {
  "siteId": "official-assembly-website-v2",
  "adapter": "supabase",
  "editor": {
    "path": "/admin/editor",
    "protected": true
  },
  "globalRegions": [
    {
      "id": "global.office.name",
      "kind": "text",
      "label": "Office name"
    },
    {
      "id": "global.office.representative-name",
      "kind": "text",
      "label": "Representative name"
    },
    {
      "id": "global.office.tagline",
      "kind": "text",
      "label": "Office tagline"
    },
    {
      "id": "global.header.brand",
      "kind": "text",
      "label": "Header brand"
    },
    {
      "id": "global.header.contact",
      "kind": "link",
      "label": "Header contact link"
    },
    {
      "id": "global.navigation",
      "kind": "sections",
      "label": "Primary navigation"
    },
    {
      "id": "global.accessibility.skip",
      "kind": "text",
      "label": "Skip navigation label"
    },
    {
      "id": "global.cta.contact",
      "kind": "link",
      "label": "Contact call to action"
    },
    {
      "id": "global.cta.newsletter",
      "kind": "link",
      "label": "Newsletter call to action"
    },
    {
      "id": "global.footer.sections-title",
      "kind": "text",
      "label": "Footer sections title"
    },
    {
      "id": "global.footer.access-title",
      "kind": "text",
      "label": "Footer access title"
    },
    {
      "id": "global.footer.access-body",
      "kind": "text",
      "label": "Footer access description"
    },
    {
      "id": "global.footer.communication-body",
      "kind": "text",
      "label": "Footer communication description"
    },
    {
      "id": "global.template.features-eyebrow",
      "kind": "text",
      "label": "Template feature eyebrow"
    },
    {
      "id": "global.template.features-title",
      "kind": "text",
      "label": "Template feature title"
    },
    {
      "id": "global.template.features-body",
      "kind": "text",
      "label": "Template feature introduction"
    },
    {
      "id": "global.template.form-eyebrow",
      "kind": "text",
      "label": "Form eyebrow"
    },
    {
      "id": "global.template.form-title",
      "kind": "text",
      "label": "Form title"
    },
    {
      "id": "global.template.form-body",
      "kind": "text",
      "label": "Form introduction"
    },
    {
      "id": "global.template.supporting-caption",
      "kind": "text",
      "label": "Supporting media caption"
    },
    {
      "id": "media.hero",
      "kind": "image",
      "label": "hero media"
    },
    {
      "id": "media.about",
      "kind": "image",
      "label": "about media"
    },
    {
      "id": "media.graduation",
      "kind": "image",
      "label": "graduation media"
    },
    {
      "id": "media.vote-board",
      "kind": "image",
      "label": "vote-board media"
    },
    {
      "id": "media.clinic",
      "kind": "image",
      "label": "clinic media"
    },
    {
      "id": "media.coverage",
      "kind": "image",
      "label": "coverage media"
    },
    {
      "id": "media.event-group",
      "kind": "image",
      "label": "event-group media"
    },
    {
      "id": "media.outdoor-visit",
      "kind": "image",
      "label": "outdoor-visit media"
    },
    {
      "id": "media.business",
      "kind": "image",
      "label": "business media"
    },
    {
      "id": "media.meeting",
      "kind": "image",
      "label": "meeting media"
    },
    {
      "id": "media.outreach",
      "kind": "image",
      "label": "outreach media"
    },
    {
      "id": "media.capitol",
      "kind": "image",
      "label": "capitol media"
    },
    {
      "id": "metadata.home.title",
      "kind": "text",
      "label": "home metadata title"
    },
    {
      "id": "metadata.home.description",
      "kind": "text",
      "label": "home metadata description"
    },
    {
      "id": "global.navigation.home.label",
      "kind": "text",
      "label": "home navigation label"
    },
    {
      "id": "global.navigation.home.link",
      "kind": "link",
      "label": "home navigation link"
    },
    {
      "id": "metadata.about.title",
      "kind": "text",
      "label": "about metadata title"
    },
    {
      "id": "metadata.about.description",
      "kind": "text",
      "label": "about metadata description"
    },
    {
      "id": "global.navigation.about.label",
      "kind": "text",
      "label": "about navigation label"
    },
    {
      "id": "global.navigation.about.link",
      "kind": "link",
      "label": "about navigation link"
    },
    {
      "id": "metadata.resources.title",
      "kind": "text",
      "label": "resources metadata title"
    },
    {
      "id": "metadata.resources.description",
      "kind": "text",
      "label": "resources metadata description"
    },
    {
      "id": "global.navigation.resources.label",
      "kind": "text",
      "label": "resources navigation label"
    },
    {
      "id": "global.navigation.resources.link",
      "kind": "link",
      "label": "resources navigation link"
    },
    {
      "id": "metadata.news.title",
      "kind": "text",
      "label": "news metadata title"
    },
    {
      "id": "metadata.news.description",
      "kind": "text",
      "label": "news metadata description"
    },
    {
      "id": "global.navigation.news.label",
      "kind": "text",
      "label": "news navigation label"
    },
    {
      "id": "global.navigation.news.link",
      "kind": "link",
      "label": "news navigation link"
    },
    {
      "id": "metadata.community.title",
      "kind": "text",
      "label": "community metadata title"
    },
    {
      "id": "metadata.community.description",
      "kind": "text",
      "label": "community metadata description"
    },
    {
      "id": "global.navigation.community.label",
      "kind": "text",
      "label": "community navigation label"
    },
    {
      "id": "global.navigation.community.link",
      "kind": "link",
      "label": "community navigation link"
    },
    {
      "id": "metadata.voting.title",
      "kind": "text",
      "label": "voting metadata title"
    },
    {
      "id": "metadata.voting.description",
      "kind": "text",
      "label": "voting metadata description"
    },
    {
      "id": "global.navigation.voting.label",
      "kind": "text",
      "label": "voting navigation label"
    },
    {
      "id": "global.navigation.voting.link",
      "kind": "link",
      "label": "voting navigation link"
    },
    {
      "id": "metadata.contact.title",
      "kind": "text",
      "label": "contact metadata title"
    },
    {
      "id": "metadata.contact.description",
      "kind": "text",
      "label": "contact metadata description"
    },
    {
      "id": "global.navigation.contact.label",
      "kind": "text",
      "label": "contact navigation label"
    },
    {
      "id": "global.navigation.contact.link",
      "kind": "link",
      "label": "contact navigation link"
    },
    {
      "id": "metadata.newsletter.title",
      "kind": "text",
      "label": "newsletter metadata title"
    },
    {
      "id": "metadata.newsletter.description",
      "kind": "text",
      "label": "newsletter metadata description"
    },
    {
      "id": "global.navigation.newsletter.label",
      "kind": "text",
      "label": "newsletter navigation label"
    },
    {
      "id": "global.navigation.newsletter.link",
      "kind": "link",
      "label": "newsletter navigation link"
    },
    {
      "id": "metadata.survey.title",
      "kind": "text",
      "label": "survey metadata title"
    },
    {
      "id": "metadata.survey.description",
      "kind": "text",
      "label": "survey metadata description"
    },
    {
      "id": "global.navigation.survey.label",
      "kind": "text",
      "label": "survey navigation label"
    },
    {
      "id": "global.navigation.survey.link",
      "kind": "link",
      "label": "survey navigation link"
    },
    {
      "id": "metadata.social.title",
      "kind": "text",
      "label": "social metadata title"
    },
    {
      "id": "metadata.social.description",
      "kind": "text",
      "label": "social metadata description"
    },
    {
      "id": "global.navigation.social.label",
      "kind": "text",
      "label": "social navigation label"
    },
    {
      "id": "global.navigation.social.link",
      "kind": "link",
      "label": "social navigation link"
    }
  ],
  "pages": [
    {
      "path": "/",
      "label": "Home",
      "regions": [
        {
          "id": "home.sections",
          "kind": "sections",
          "label": "home page sections"
        },
        {
          "id": "home.hero.eyebrow",
          "kind": "text",
          "label": "home hero eyebrow"
        },
        {
          "id": "home.hero.title",
          "kind": "text",
          "label": "home hero title"
        },
        {
          "id": "home.hero.body",
          "kind": "text",
          "label": "home hero description"
        },
        {
          "id": "home.hero.primary-cta",
          "kind": "link",
          "label": "home primary call to action"
        },
        {
          "id": "home.hero.secondary-cta",
          "kind": "link",
          "label": "home secondary call to action"
        },
        {
          "id": "home.hero.news-cta",
          "kind": "link",
          "label": "home news call to action"
        },
        {
          "id": "home.hero.newsletter-cta",
          "kind": "link",
          "label": "home newsletter call to action"
        },
        {
          "id": "home.features.eyebrow",
          "kind": "text",
          "label": "home feature eyebrow"
        },
        {
          "id": "home.features.title",
          "kind": "text",
          "label": "home feature title"
        },
        {
          "id": "home.features.body",
          "kind": "text",
          "label": "home feature introduction"
        },
        {
          "id": "home.cards",
          "kind": "sections",
          "label": "home cards"
        },
        {
          "id": "home.cards.office-help.title",
          "kind": "text",
          "label": "office-help title"
        },
        {
          "id": "home.cards.office-help.body",
          "kind": "text",
          "label": "office-help body"
        },
        {
          "id": "home.cards.office-help.link",
          "kind": "link",
          "label": "office-help link"
        },
        {
          "id": "home.cards.community-updates.title",
          "kind": "text",
          "label": "community-updates title"
        },
        {
          "id": "home.cards.community-updates.body",
          "kind": "text",
          "label": "community-updates body"
        },
        {
          "id": "home.cards.community-updates.link",
          "kind": "link",
          "label": "community-updates link"
        },
        {
          "id": "home.cards.civic-resources.title",
          "kind": "text",
          "label": "civic-resources title"
        },
        {
          "id": "home.cards.civic-resources.body",
          "kind": "text",
          "label": "civic-resources body"
        },
        {
          "id": "home.cards.civic-resources.link",
          "kind": "link",
          "label": "civic-resources link"
        },
        {
          "id": "home.stats",
          "kind": "sections",
          "label": "Home statistics"
        },
        {
          "id": "home.stats.services.value",
          "kind": "text",
          "label": "Services statistic value"
        },
        {
          "id": "home.stats.services.label",
          "kind": "text",
          "label": "Services statistic label"
        },
        {
          "id": "home.stats.updates.value",
          "kind": "text",
          "label": "Updates statistic value"
        },
        {
          "id": "home.stats.updates.label",
          "kind": "text",
          "label": "Updates statistic label"
        },
        {
          "id": "home.stats.access.value",
          "kind": "text",
          "label": "Access statistic value"
        },
        {
          "id": "home.stats.access.label",
          "kind": "text",
          "label": "Access statistic label"
        },
        {
          "id": "home.portal.eyebrow",
          "kind": "text",
          "label": "Portal eyebrow"
        },
        {
          "id": "home.portal.title",
          "kind": "text",
          "label": "Portal title"
        },
        {
          "id": "home.portal.body",
          "kind": "text",
          "label": "Portal introduction"
        },
        {
          "id": "home.portal.cards",
          "kind": "sections",
          "label": "Portal cards"
        },
        {
          "id": "home.official.eyebrow",
          "kind": "text",
          "label": "Official profile eyebrow"
        },
        {
          "id": "home.official.title",
          "kind": "text",
          "label": "Official profile title"
        },
        {
          "id": "home.official.body",
          "kind": "text",
          "label": "Official profile introduction"
        },
        {
          "id": "home.connections.eyebrow",
          "kind": "text",
          "label": "District connections eyebrow"
        },
        {
          "id": "home.connections.title",
          "kind": "text",
          "label": "District connections title"
        },
        {
          "id": "home.connections.body",
          "kind": "text",
          "label": "District connections introduction"
        },
        {
          "id": "home.connections.newsletter.eyebrow",
          "kind": "text",
          "label": "Homepage newsletter eyebrow"
        },
        {
          "id": "home.connections.newsletter.title",
          "kind": "text",
          "label": "Homepage newsletter title"
        },
        {
          "id": "home.connections.newsletter.body",
          "kind": "text",
          "label": "Homepage newsletter introduction"
        },
        {
          "id": "home.connections.newsletter.form",
          "kind": "sections",
          "label": "Homepage managed newsletter form"
        },
        {
          "id": "home.latest.eyebrow",
          "kind": "text",
          "label": "Latest updates eyebrow"
        },
        {
          "id": "home.latest.title",
          "kind": "text",
          "label": "Latest updates title"
        },
        {
          "id": "home.workflow.eyebrow",
          "kind": "text",
          "label": "Workflow eyebrow"
        },
        {
          "id": "home.workflow.title",
          "kind": "text",
          "label": "Workflow title"
        },
        {
          "id": "home.workflow.steps",
          "kind": "sections",
          "label": "Workflow steps"
        },
        {
          "id": "home.workflow.steps.public-information.title",
          "kind": "text",
          "label": "public-information title"
        },
        {
          "id": "home.workflow.steps.public-information.body",
          "kind": "text",
          "label": "public-information body"
        },
        {
          "id": "home.workflow.steps.service-requests.title",
          "kind": "text",
          "label": "service-requests title"
        },
        {
          "id": "home.workflow.steps.service-requests.body",
          "kind": "text",
          "label": "service-requests body"
        },
        {
          "id": "home.workflow.steps.community-updates.title",
          "kind": "text",
          "label": "community-updates title"
        },
        {
          "id": "home.workflow.steps.community-updates.body",
          "kind": "text",
          "label": "community-updates body"
        }
      ]
    },
    {
      "path": "/about",
      "label": "About",
      "regions": [
        {
          "id": "about.sections",
          "kind": "sections",
          "label": "about page sections"
        },
        {
          "id": "about.hero.eyebrow",
          "kind": "text",
          "label": "about hero eyebrow"
        },
        {
          "id": "about.hero.title",
          "kind": "text",
          "label": "about hero title"
        },
        {
          "id": "about.hero.body",
          "kind": "text",
          "label": "about hero description"
        },
        {
          "id": "about.hero.primary-cta",
          "kind": "link",
          "label": "about primary call to action"
        },
        {
          "id": "about.hero.secondary-cta",
          "kind": "link",
          "label": "about secondary call to action"
        },
        {
          "id": "about.features.eyebrow",
          "kind": "text",
          "label": "about feature eyebrow"
        },
        {
          "id": "about.features.title",
          "kind": "text",
          "label": "about feature title"
        },
        {
          "id": "about.features.body",
          "kind": "text",
          "label": "about feature introduction"
        },
        {
          "id": "about.cards",
          "kind": "sections",
          "label": "about cards"
        },
        {
          "id": "about.cards.district-leadership.title",
          "kind": "text",
          "label": "district-leadership title"
        },
        {
          "id": "about.cards.district-leadership.body",
          "kind": "text",
          "label": "district-leadership body"
        },
        {
          "id": "about.cards.district-leadership.link",
          "kind": "link",
          "label": "district-leadership link"
        },
        {
          "id": "about.cards.legislative-priorities.title",
          "kind": "text",
          "label": "legislative-priorities title"
        },
        {
          "id": "about.cards.legislative-priorities.body",
          "kind": "text",
          "label": "legislative-priorities body"
        },
        {
          "id": "about.cards.legislative-priorities.link",
          "kind": "link",
          "label": "legislative-priorities link"
        },
        {
          "id": "about.cards.community-presence.title",
          "kind": "text",
          "label": "community-presence title"
        },
        {
          "id": "about.cards.community-presence.body",
          "kind": "text",
          "label": "community-presence body"
        },
        {
          "id": "about.cards.community-presence.link",
          "kind": "link",
          "label": "community-presence link"
        },
        {
          "id": "about.cards.biography-readiness.title",
          "kind": "text",
          "label": "biography-readiness title"
        },
        {
          "id": "about.cards.biography-readiness.body",
          "kind": "text",
          "label": "biography-readiness body"
        },
        {
          "id": "about.cards.biography-readiness.link",
          "kind": "link",
          "label": "biography-readiness link"
        }
      ]
    },
    {
      "path": "/resources",
      "label": "Resources",
      "regions": [
        {
          "id": "resources.sections",
          "kind": "sections",
          "label": "resources page sections"
        },
        {
          "id": "resources.hero.eyebrow",
          "kind": "text",
          "label": "resources hero eyebrow"
        },
        {
          "id": "resources.hero.title",
          "kind": "text",
          "label": "resources hero title"
        },
        {
          "id": "resources.hero.body",
          "kind": "text",
          "label": "resources hero description"
        },
        {
          "id": "resources.hero.primary-cta",
          "kind": "link",
          "label": "resources primary call to action"
        },
        {
          "id": "resources.hero.secondary-cta",
          "kind": "link",
          "label": "resources secondary call to action"
        },
        {
          "id": "resources.features.eyebrow",
          "kind": "text",
          "label": "resources feature eyebrow"
        },
        {
          "id": "resources.features.title",
          "kind": "text",
          "label": "resources feature title"
        },
        {
          "id": "resources.features.body",
          "kind": "text",
          "label": "resources feature introduction"
        },
        {
          "id": "resources.cards",
          "kind": "sections",
          "label": "resources cards"
        },
        {
          "id": "resources.cards.state-agency-assistance.title",
          "kind": "text",
          "label": "state-agency-assistance title"
        },
        {
          "id": "resources.cards.state-agency-assistance.body",
          "kind": "text",
          "label": "state-agency-assistance body"
        },
        {
          "id": "resources.cards.state-agency-assistance.link",
          "kind": "link",
          "label": "state-agency-assistance link"
        },
        {
          "id": "resources.cards.fresh-start-clinics.title",
          "kind": "text",
          "label": "fresh-start-clinics title"
        },
        {
          "id": "resources.cards.fresh-start-clinics.body",
          "kind": "text",
          "label": "fresh-start-clinics body"
        },
        {
          "id": "resources.cards.fresh-start-clinics.link",
          "kind": "link",
          "label": "fresh-start-clinics link"
        },
        {
          "id": "resources.cards.downloadable-forms.title",
          "kind": "text",
          "label": "downloadable-forms title"
        },
        {
          "id": "resources.cards.downloadable-forms.body",
          "kind": "text",
          "label": "downloadable-forms body"
        },
        {
          "id": "resources.cards.downloadable-forms.link",
          "kind": "link",
          "label": "downloadable-forms link"
        }
      ]
    },
    {
      "path": "/news",
      "label": "News & Updates",
      "regions": [
        {
          "id": "news.sections",
          "kind": "sections",
          "label": "news page sections"
        },
        {
          "id": "news.hero.eyebrow",
          "kind": "text",
          "label": "news hero eyebrow"
        },
        {
          "id": "news.hero.title",
          "kind": "text",
          "label": "news hero title"
        },
        {
          "id": "news.hero.body",
          "kind": "text",
          "label": "news hero description"
        },
        {
          "id": "news.hero.primary-cta",
          "kind": "link",
          "label": "news primary call to action"
        },
        {
          "id": "news.hero.secondary-cta",
          "kind": "link",
          "label": "news secondary call to action"
        },
        {
          "id": "news.features.eyebrow",
          "kind": "text",
          "label": "news feature eyebrow"
        },
        {
          "id": "news.features.title",
          "kind": "text",
          "label": "news feature title"
        },
        {
          "id": "news.features.body",
          "kind": "text",
          "label": "news feature introduction"
        },
        {
          "id": "news.cards",
          "kind": "sections",
          "label": "news cards"
        },
        {
          "id": "news.cards.voting-rights-update.title",
          "kind": "text",
          "label": "voting-rights-update title"
        },
        {
          "id": "news.cards.voting-rights-update.body",
          "kind": "text",
          "label": "voting-rights-update body"
        },
        {
          "id": "news.cards.voting-rights-update.link",
          "kind": "link",
          "label": "voting-rights-update link"
        },
        {
          "id": "news.cards.expanded-coverage.title",
          "kind": "text",
          "label": "expanded-coverage title"
        },
        {
          "id": "news.cards.expanded-coverage.body",
          "kind": "text",
          "label": "expanded-coverage body"
        },
        {
          "id": "news.cards.expanded-coverage.link",
          "kind": "link",
          "label": "expanded-coverage link"
        },
        {
          "id": "news.cards.district-events.title",
          "kind": "text",
          "label": "district-events title"
        },
        {
          "id": "news.cards.district-events.body",
          "kind": "text",
          "label": "district-events body"
        },
        {
          "id": "news.cards.district-events.link",
          "kind": "link",
          "label": "district-events link"
        },
        {
          "id": "news.newsletter.eyebrow",
          "kind": "text",
          "label": "newsletter signup eyebrow"
        },
        {
          "id": "news.newsletter.title",
          "kind": "text",
          "label": "newsletter signup title"
        },
        {
          "id": "news.newsletter.body",
          "kind": "text",
          "label": "newsletter signup introduction"
        },
        {
          "id": "news.newsletter.form",
          "kind": "sections",
          "label": "newsletter managed form"
        }
      ]
    },
    {
      "path": "/community",
      "label": "Community",
      "regions": [
        {
          "id": "community.sections",
          "kind": "sections",
          "label": "community page sections"
        },
        {
          "id": "community.hero.eyebrow",
          "kind": "text",
          "label": "community hero eyebrow"
        },
        {
          "id": "community.hero.title",
          "kind": "text",
          "label": "community hero title"
        },
        {
          "id": "community.hero.body",
          "kind": "text",
          "label": "community hero description"
        },
        {
          "id": "community.hero.primary-cta",
          "kind": "link",
          "label": "community primary call to action"
        },
        {
          "id": "community.hero.secondary-cta",
          "kind": "link",
          "label": "community secondary call to action"
        },
        {
          "id": "community.features.eyebrow",
          "kind": "text",
          "label": "community feature eyebrow"
        },
        {
          "id": "community.features.title",
          "kind": "text",
          "label": "community feature title"
        },
        {
          "id": "community.features.body",
          "kind": "text",
          "label": "community feature introduction"
        },
        {
          "id": "community.cards",
          "kind": "sections",
          "label": "community cards"
        },
        {
          "id": "community.cards.small-business-roundtables.title",
          "kind": "text",
          "label": "small-business-roundtables title"
        },
        {
          "id": "community.cards.small-business-roundtables.body",
          "kind": "text",
          "label": "small-business-roundtables body"
        },
        {
          "id": "community.cards.small-business-roundtables.link",
          "kind": "link",
          "label": "small-business-roundtables link"
        },
        {
          "id": "community.cards.graduation-youth.title",
          "kind": "text",
          "label": "graduation-youth title"
        },
        {
          "id": "community.cards.graduation-youth.body",
          "kind": "text",
          "label": "graduation-youth body"
        },
        {
          "id": "community.cards.graduation-youth.link",
          "kind": "link",
          "label": "graduation-youth link"
        },
        {
          "id": "community.cards.constituent-conversations.title",
          "kind": "text",
          "label": "constituent-conversations title"
        },
        {
          "id": "community.cards.constituent-conversations.body",
          "kind": "text",
          "label": "constituent-conversations body"
        },
        {
          "id": "community.cards.constituent-conversations.link",
          "kind": "link",
          "label": "constituent-conversations link"
        }
      ]
    },
    {
      "path": "/voting",
      "label": "Voting",
      "regions": [
        {
          "id": "voting.sections",
          "kind": "sections",
          "label": "voting page sections"
        },
        {
          "id": "voting.hero.eyebrow",
          "kind": "text",
          "label": "voting hero eyebrow"
        },
        {
          "id": "voting.hero.title",
          "kind": "text",
          "label": "voting hero title"
        },
        {
          "id": "voting.hero.body",
          "kind": "text",
          "label": "voting hero description"
        },
        {
          "id": "voting.hero.primary-cta",
          "kind": "link",
          "label": "voting primary call to action"
        },
        {
          "id": "voting.hero.secondary-cta",
          "kind": "link",
          "label": "voting secondary call to action"
        },
        {
          "id": "voting.features.eyebrow",
          "kind": "text",
          "label": "voting feature eyebrow"
        },
        {
          "id": "voting.features.title",
          "kind": "text",
          "label": "voting feature title"
        },
        {
          "id": "voting.features.body",
          "kind": "text",
          "label": "voting feature introduction"
        },
        {
          "id": "voting.cards",
          "kind": "sections",
          "label": "voting cards"
        },
        {
          "id": "voting.cards.register-update.title",
          "kind": "text",
          "label": "register-update title"
        },
        {
          "id": "voting.cards.register-update.body",
          "kind": "text",
          "label": "register-update body"
        },
        {
          "id": "voting.cards.register-update.link",
          "kind": "link",
          "label": "register-update link"
        },
        {
          "id": "voting.cards.polling-information.title",
          "kind": "text",
          "label": "polling-information title"
        },
        {
          "id": "voting.cards.polling-information.body",
          "kind": "text",
          "label": "polling-information body"
        },
        {
          "id": "voting.cards.polling-information.link",
          "kind": "link",
          "label": "polling-information link"
        },
        {
          "id": "voting.cards.voter-rights.title",
          "kind": "text",
          "label": "voter-rights title"
        },
        {
          "id": "voting.cards.voter-rights.body",
          "kind": "text",
          "label": "voter-rights body"
        },
        {
          "id": "voting.cards.voter-rights.link",
          "kind": "link",
          "label": "voter-rights link"
        }
      ]
    },
    {
      "path": "/contact",
      "label": "Contact",
      "regions": [
        {
          "id": "contact.sections",
          "kind": "sections",
          "label": "contact page sections"
        },
        {
          "id": "contact.hero.eyebrow",
          "kind": "text",
          "label": "contact hero eyebrow"
        },
        {
          "id": "contact.hero.title",
          "kind": "text",
          "label": "contact hero title"
        },
        {
          "id": "contact.hero.body",
          "kind": "text",
          "label": "contact hero description"
        },
        {
          "id": "contact.hero.primary-cta",
          "kind": "link",
          "label": "contact primary call to action"
        },
        {
          "id": "contact.hero.secondary-cta",
          "kind": "link",
          "label": "contact secondary call to action"
        },
        {
          "id": "contact.features.eyebrow",
          "kind": "text",
          "label": "contact feature eyebrow"
        },
        {
          "id": "contact.features.title",
          "kind": "text",
          "label": "contact feature title"
        },
        {
          "id": "contact.features.body",
          "kind": "text",
          "label": "contact feature introduction"
        },
        {
          "id": "contact.cards",
          "kind": "sections",
          "label": "contact cards"
        },
        {
          "id": "contact.cards.send-message.title",
          "kind": "text",
          "label": "send-message title"
        },
        {
          "id": "contact.cards.send-message.body",
          "kind": "text",
          "label": "send-message body"
        },
        {
          "id": "contact.cards.send-message.link",
          "kind": "link",
          "label": "send-message link"
        },
        {
          "id": "contact.cards.district-office.title",
          "kind": "text",
          "label": "district-office title"
        },
        {
          "id": "contact.cards.district-office.body",
          "kind": "text",
          "label": "district-office body"
        },
        {
          "id": "contact.cards.district-office.link",
          "kind": "link",
          "label": "district-office link"
        },
        {
          "id": "contact.cards.community-requests.title",
          "kind": "text",
          "label": "community-requests title"
        },
        {
          "id": "contact.cards.community-requests.body",
          "kind": "text",
          "label": "community-requests body"
        },
        {
          "id": "contact.cards.community-requests.link",
          "kind": "link",
          "label": "community-requests link"
        },
        {
          "id": "contact.form",
          "kind": "sections",
          "label": "contact managed form"
        }
      ]
    },
    {
      "path": "/newsletter",
      "label": "Newsletter signup",
      "regions": [
        {
          "id": "newsletter.sections",
          "kind": "sections",
          "label": "newsletter page sections"
        },
        {
          "id": "newsletter.hero.eyebrow",
          "kind": "text",
          "label": "newsletter hero eyebrow"
        },
        {
          "id": "newsletter.hero.title",
          "kind": "text",
          "label": "newsletter hero title"
        },
        {
          "id": "newsletter.hero.body",
          "kind": "text",
          "label": "newsletter hero description"
        },
        {
          "id": "newsletter.hero.primary-cta",
          "kind": "link",
          "label": "newsletter primary call to action"
        },
        {
          "id": "newsletter.hero.secondary-cta",
          "kind": "link",
          "label": "newsletter secondary call to action"
        },
        {
          "id": "newsletter.features.eyebrow",
          "kind": "text",
          "label": "newsletter feature eyebrow"
        },
        {
          "id": "newsletter.features.title",
          "kind": "text",
          "label": "newsletter feature title"
        },
        {
          "id": "newsletter.features.body",
          "kind": "text",
          "label": "newsletter feature introduction"
        },
        {
          "id": "newsletter.cards",
          "kind": "sections",
          "label": "newsletter cards"
        },
        {
          "id": "newsletter.cards.district-updates.title",
          "kind": "text",
          "label": "district-updates title"
        },
        {
          "id": "newsletter.cards.district-updates.body",
          "kind": "text",
          "label": "district-updates body"
        },
        {
          "id": "newsletter.cards.district-updates.link",
          "kind": "link",
          "label": "district-updates link"
        },
        {
          "id": "newsletter.cards.subscriber-preferences.title",
          "kind": "text",
          "label": "subscriber-preferences title"
        },
        {
          "id": "newsletter.cards.subscriber-preferences.body",
          "kind": "text",
          "label": "subscriber-preferences body"
        },
        {
          "id": "newsletter.cards.subscriber-preferences.link",
          "kind": "link",
          "label": "subscriber-preferences link"
        },
        {
          "id": "newsletter.form",
          "kind": "sections",
          "label": "newsletter managed form"
        }
      ]
    },
    {
      "path": "/survey",
      "label": "Survey",
      "regions": [
        {
          "id": "survey.sections",
          "kind": "sections",
          "label": "survey page sections"
        },
        {
          "id": "survey.hero.eyebrow",
          "kind": "text",
          "label": "survey hero eyebrow"
        },
        {
          "id": "survey.hero.title",
          "kind": "text",
          "label": "survey hero title"
        },
        {
          "id": "survey.hero.body",
          "kind": "text",
          "label": "survey hero description"
        },
        {
          "id": "survey.hero.primary-cta",
          "kind": "link",
          "label": "survey primary call to action"
        },
        {
          "id": "survey.hero.secondary-cta",
          "kind": "link",
          "label": "survey secondary call to action"
        },
        {
          "id": "survey.features.eyebrow",
          "kind": "text",
          "label": "survey feature eyebrow"
        },
        {
          "id": "survey.features.title",
          "kind": "text",
          "label": "survey feature title"
        },
        {
          "id": "survey.features.body",
          "kind": "text",
          "label": "survey feature introduction"
        },
        {
          "id": "survey.cards",
          "kind": "sections",
          "label": "survey cards"
        },
        {
          "id": "survey.cards.issue-priorities.title",
          "kind": "text",
          "label": "issue-priorities title"
        },
        {
          "id": "survey.cards.issue-priorities.body",
          "kind": "text",
          "label": "issue-priorities body"
        },
        {
          "id": "survey.cards.issue-priorities.link",
          "kind": "link",
          "label": "issue-priorities link"
        },
        {
          "id": "survey.cards.neighborhood-context.title",
          "kind": "text",
          "label": "neighborhood-context title"
        },
        {
          "id": "survey.cards.neighborhood-context.body",
          "kind": "text",
          "label": "neighborhood-context body"
        },
        {
          "id": "survey.cards.neighborhood-context.link",
          "kind": "link",
          "label": "neighborhood-context link"
        }
      ]
    },
    {
      "path": "/social",
      "label": "Social",
      "regions": [
        {
          "id": "social.sections",
          "kind": "sections",
          "label": "social page sections"
        },
        {
          "id": "social.hero.eyebrow",
          "kind": "text",
          "label": "social hero eyebrow"
        },
        {
          "id": "social.hero.title",
          "kind": "text",
          "label": "social hero title"
        },
        {
          "id": "social.hero.body",
          "kind": "text",
          "label": "social hero description"
        },
        {
          "id": "social.hero.primary-cta",
          "kind": "link",
          "label": "social primary call to action"
        },
        {
          "id": "social.hero.secondary-cta",
          "kind": "link",
          "label": "social secondary call to action"
        },
        {
          "id": "social.features.eyebrow",
          "kind": "text",
          "label": "social feature eyebrow"
        },
        {
          "id": "social.features.title",
          "kind": "text",
          "label": "social feature title"
        },
        {
          "id": "social.features.body",
          "kind": "text",
          "label": "social feature introduction"
        },
        {
          "id": "social.cards",
          "kind": "sections",
          "label": "social cards"
        },
        {
          "id": "social.cards.post-highlights.title",
          "kind": "text",
          "label": "post-highlights title"
        },
        {
          "id": "social.cards.post-highlights.body",
          "kind": "text",
          "label": "post-highlights body"
        },
        {
          "id": "social.cards.post-highlights.link",
          "kind": "link",
          "label": "post-highlights link"
        },
        {
          "id": "social.cards.local-photos.title",
          "kind": "text",
          "label": "local-photos title"
        },
        {
          "id": "social.cards.local-photos.body",
          "kind": "text",
          "label": "local-photos body"
        },
        {
          "id": "social.cards.local-photos.link",
          "kind": "link",
          "label": "local-photos link"
        }
      ]
    },
    {
      "path": "/404",
      "label": "404 - Page not found",
      "regions": [
        {
          "id": "404.hero.eyebrow",
          "kind": "text",
          "label": "404 eyebrow"
        },
        {
          "id": "404.hero.title",
          "kind": "text",
          "label": "404 title"
        },
        {
          "id": "404.hero.body",
          "kind": "text",
          "label": "404 description"
        },
        {
          "id": "404.hero.image",
          "kind": "image",
          "label": "404 image"
        },
        {
          "id": "404.hero.primary-cta",
          "kind": "link",
          "label": "404 primary link"
        },
        {
          "id": "404.hero.secondary-cta",
          "kind": "link",
          "label": "404 secondary link"
        }
      ]
    }
  ],
  "sections": {
    "home": [
      "hero",
      "stats",
      "portal",
      "workflow"
    ],
    "route": [
      "hero",
      "features",
      "form",
      "supporting",
      "secondary"
    ]
  }
} satisfies BuilderSiteConfig;
