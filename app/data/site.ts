import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  Bell,
  BookOpenCheck,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileText,
  Handshake,
  HeartHandshake,
  Landmark,
  Mail,
  MapPin,
  Megaphone,
  MessageSquareText,
  Newspaper,
  Scale,
  ShieldCheck,
  Users,
  Vote
} from "lucide-react";

export type ImageAsset = {
  key: string;
  regionId: string;
  src: string;
  alt: string;
};

export type Stat = {
  id: string;
  value: string;
  label: string;
};

export type Card = {
  id: string;
  title: string;
  text: string;
  icon: LucideIcon;
  href?: string;
  tag?: string;
};

export type PageContent = {
  href: string;
  slug?: string;
  navLabel: string;
  title: string;
  eyebrow: string;
  description: string;
  imageKey: string;
  cards: Card[];
  secondaryCards?: Card[];
};

export const siteConfig = {
  officeName: "Office of Assemblywoman Carmen Theresa Morales",
  representativeName: "Carmen Morales",
  districtLabel: "New Jersey Legislative District 34",
  tagline:
    "Constituent services, legislative information, voting resources, and district office access for New Jersey's 34th Legislative District.",
  officeAddress: "152 Franklin Street, Belleville, NJ 07109",
  phoneDisplay: "(973) 450-0484",
  phoneE164: "+19734500484",
  officialProfileUrl:
    "https://www.njleg.state.nj.us/legislative-roster/491/assemblywoman-morales"
};

export const imageAssets: ImageAsset[] = [
  {
    key: "hero",
    regionId: "media.hero",
    src: "/images/carmen-capitol-portrait.jpg",
    alt: "Assemblywoman Carmen Morales with legislative colleagues at the State House"
  },
  {
    key: "about",
    regionId: "media.about",
    src: "/images/carmen-capitol-colleagues.jpg",
    alt: "Assemblywoman Carmen Morales meeting with legislative colleagues"
  },
  {
    key: "graduation",
    regionId: "media.graduation",
    src: "/images/graduation-community.jpg",
    alt: "A graduate at a district graduation ceremony"
  },
  {
    key: "voteBoard",
    regionId: "media.vote-board",
    src: "/images/assembly-vote-board.jpg",
    alt: "New Jersey General Assembly electronic vote board"
  },
  {
    key: "clinic",
    regionId: "media.clinic",
    src: "/images/expungement-clinic.jpg",
    alt: "Fresh Start expungement clinic event flyer"
  },
  {
    key: "coverage",
    regionId: "media.coverage",
    src: "/images/rosy-bagolie-coverage.jpg",
    alt: "Community health clinic event flyer"
  },
  {
    key: "eventGroup",
    regionId: "media.event-group",
    src: "/images/community-event-group.jpg",
    alt: "Community members gathered at a district event"
  },
  {
    key: "outdoorVisit",
    regionId: "media.outdoor-visit",
    src: "/images/outdoor-district-visit.jpg",
    alt: "Assemblywoman Carmen Morales visiting constituents outdoors"
  },
  {
    key: "business",
    regionId: "media.business",
    src: "/images/small-business-roundtable.jpg",
    alt: "Small business roundtable with constituents at a local restaurant"
  },
  {
    key: "meeting",
    regionId: "media.meeting",
    src: "/images/constituent-meeting.jpg",
    alt: "Constituent meeting in a community space"
  },
  {
    key: "outreach",
    regionId: "media.outreach",
    src: "/images/district-outreach.jpg",
    alt: "District outreach event with community members"
  },
  {
    key: "capitol",
    regionId: "media.capitol",
    src: "/images/capitol-visit.jpg",
    alt: "Constituents and officials during a capitol visit"
  }
];

export const stats: Stat[] = [
  { id: "services", value: "Services", label: "Help navigating New Jersey agencies" },
  { id: "updates", value: "Updates", label: "Legislation and district information" },
  { id: "access", value: "Access", label: "Office, voting, and contact resources" }
];

export const pages: PageContent[] = [
  {
    href: "/",
    navLabel: "Home",
    title: "District 34 Constituent Services and Community Updates",
    eyebrow: "New Jersey General Assembly - District 34",
    description:
      "Find district office contact information, official legislative resources, voting guidance, and ways to request help with a New Jersey state agency.",
    imageKey: "hero",
    cards: [
      {
        id: "office-help",
        title: "Contact the District Office",
        text: "Call or send a message when you need help navigating a New Jersey state agency or want to share a legislative concern.",
        icon: HeartHandshake,
        href: "/contact"
      },
      {
        id: "community-updates",
        title: "Follow Legislative Activity",
        text: "Use official New Jersey Legislature sources for sponsored bills, votes, committee work, and current public information.",
        icon: Newspaper,
        href: "/news"
      },
      {
        id: "civic-resources",
        title: "Find Civic Resources",
        text: "Go directly to official voting, state service, district office, and newsletter resources.",
        icon: Landmark,
        href: "/resources"
      }
    ]
  },
  {
    href: "/about",
    slug: "about",
    navLabel: "About",
    title: "About Assemblywoman Carmen Theresa Morales",
    eyebrow: "Deputy Whip - District 34",
    description:
      "Assemblywoman Morales has served in the New Jersey General Assembly since 2024 and represents District 34 in Essex County.",
    imageKey: "about",
    cards: [
      {
        id: "district-leadership",
        title: "District 34",
        text: "The district includes Belleville, Bloomfield, East Orange, Glen Ridge, Nutley, and Orange.",
        icon: Users
      },
      {
        id: "legislative-priorities",
        title: "Committee Service",
        text: "The official legislative roster lists Higher Education, Appropriations, Science, Innovation and Technology, and the Joint Committee on the Public Schools.",
        icon: Scale,
        href: siteConfig.officialProfileUrl
      },
      {
        id: "community-presence",
        title: "Public Service",
        text: "Her official biography lists a career in education and service as an Essex County College trustee from 2017 through 2023.",
        icon: BadgeCheck,
        href: siteConfig.officialProfileUrl
      }
    ],
    secondaryCards: [
      {
        id: "biography-readiness",
        title: "Official biography and legislative record",
        text: "Review the New Jersey Legislature profile for the current biography, committee assignments, sponsored bills, and member votes.",
        icon: FileText,
        href: siteConfig.officialProfileUrl
      }
    ]
  },
  {
    href: "/resources",
    slug: "resources",
    navLabel: "Resources",
    title: "District and State Resources",
    eyebrow: "Constituent Support",
    description:
      "Start with official state information, then contact the district office if you need help identifying the appropriate New Jersey agency.",
    imageKey: "clinic",
    cards: [
      {
        id: "state-agency-assistance",
        title: "State Agency Assistance",
        text: "Contact the district office about an existing matter involving a New Jersey state agency.",
        icon: ClipboardList,
        href: "/contact"
      },
      {
        id: "fresh-start-clinics",
        title: "Public Service Events",
        text: "Watch district notices for verified office hours, clinics, and community events.",
        icon: ShieldCheck,
        href: "/news"
      },
      {
        id: "downloadable-forms",
        title: "Official New Jersey Services",
        text: "Browse the State of New Jersey department and service directory for direct government resources.",
        icon: FileText,
        href: "https://www.nj.gov/nj/gov/deptserv/"
      }
    ]
  },
  {
    href: "/news",
    slug: "news",
    navLabel: "News",
    title: "Legislative and District Updates",
    eyebrow: "Official Sources",
    description:
      "Use the New Jersey Legislature record for current bills, votes, committees, and public proceedings. Site-managed posts are not yet available.",
    imageKey: "voteBoard",
    cards: [
      {
        id: "voting-rights-update",
        title: "Sponsored Bills and Votes",
        text: "Review the Assemblywoman's official roster page for current sponsored bills and member votes.",
        icon: Vote,
        tag: "Legislature",
        href: siteConfig.officialProfileUrl
      },
      {
        id: "expanded-coverage",
        title: "Committee Work",
        text: "Check current committee assignments and schedules through the New Jersey Legislature.",
        icon: Bell,
        tag: "Committees",
        href: "https://www.njleg.state.nj.us/committees/assembly-committees"
      },
      {
        id: "district-events",
        title: "District Notices",
        text: "For current office hours and district event information, call the district office.",
        icon: CalendarDays,
        tag: "District",
        href: `tel:${siteConfig.phoneE164}`
      }
    ]
  },
  {
    href: "/community",
    slug: "community",
    navLabel: "Community",
    title: "Around District 34",
    eyebrow: "Community",
    description:
      "District 34 includes Belleville, Bloomfield, East Orange, Glen Ridge, Nutley, and Orange in Essex County.",
    imageKey: "business",
    cards: [
      {
        id: "small-business-roundtables",
        title: "Small Business Conversations",
        text: "District conversations can help residents and business owners identify state resources and share policy concerns.",
        icon: Handshake,
        href: "/contact"
      },
      {
        id: "graduation-youth",
        title: "Schools and Youth",
        text: "The official roster lists Assemblywoman Morales as Chair of the Assembly Higher Education Committee.",
        icon: BookOpenCheck,
        href: siteConfig.officialProfileUrl
      },
      {
        id: "constituent-conversations",
        title: "Constituent Conversations",
        text: "Contact the district office to share a concern, ask a question, or request help with a state matter.",
        icon: MessageSquareText,
        href: "/contact"
      }
    ]
  },
  {
    href: "/voting",
    slug: "voting",
    navLabel: "Voting",
    title: "Official New Jersey Voting Information",
    eyebrow: "Civic Access",
    description:
      "Use official New Jersey election resources for registration, vote-by-mail, early voting, polling locations, and election dates.",
    imageKey: "outreach",
    cards: [
      {
        id: "register-update",
        title: "Register or Update Your Record",
        text: "Visit the New Jersey Division of Elections for registration and voter information.",
        icon: Vote,
        href: "https://www.nj.gov/state/elections/voter-registration.shtml"
      },
      {
        id: "polling-information",
        title: "Find Polling Information",
        text: "Use the state's voter information portal for polling places and election resources.",
        icon: MapPin,
        href: "https://www.nj.gov/state/elections/vote.shtml"
      },
      {
        id: "voter-rights",
        title: "Voting Questions",
        text: "For authoritative election guidance, use the Division of Elections contact and help resources.",
        icon: ShieldCheck,
        href: "https://www.nj.gov/state/elections/index.shtml"
      }
    ]
  },
  {
    href: "/contact",
    slug: "contact",
    navLabel: "Contact",
    title: "Contact the District Office",
    eyebrow: "Office Access",
    description:
      `${siteConfig.officeAddress}. Call ${siteConfig.phoneDisplay} for district office assistance.`,
    imageKey: "meeting",
    cards: [
      {
        id: "send-message",
        title: "Call the Office",
        text: `Speak with the district office at ${siteConfig.phoneDisplay}.`,
        icon: Mail,
        href: `tel:${siteConfig.phoneE164}`
      },
      {
        id: "district-office",
        title: "District Office",
        text: siteConfig.officeAddress,
        icon: Building2
      },
      {
        id: "community-requests",
        title: "Legislative Contact Form",
        text: "You can also use the official New Jersey Legislature contact form for the Assemblywoman.",
        icon: MessageSquareText,
        href: siteConfig.officialProfileUrl
      }
    ]
  },
  {
    href: "/newsletter",
    slug: "newsletter",
    navLabel: "Newsletter",
    title: "District Newsletter",
    eyebrow: "Stay Informed",
    description:
      "A newsletter signup will be available after the district office approves the subscription policy and publishing workflow.",
    imageKey: "eventGroup",
    cards: [
      {
        id: "district-updates",
        title: "District Updates",
        text: "The planned newsletter will cover legislative information, public services, and district events.",
        icon: Megaphone
      },
      {
        id: "subscriber-preferences",
        title: "Consent and Preferences",
        text: "Signup requires explicit email consent and a published privacy policy before submissions can be accepted.",
        icon: CheckCircle2
      }
    ]
  },
  {
    href: "/survey",
    slug: "survey",
    navLabel: "Survey",
    title: "Share a District Priority",
    eyebrow: "Resident Voice",
    description:
      "The online survey is not accepting responses. Residents can share priorities directly with the district office by phone or through the official contact form.",
    imageKey: "outdoorVisit",
    cards: [
      {
        id: "issue-priorities",
        title: "Legislative Priorities",
        text: "Share an issue or legislative concern through the district office contact options.",
        icon: ClipboardList,
        href: "/contact"
      },
      {
        id: "neighborhood-context",
        title: "Local Context",
        text: "Include your municipality and the state matter involved when asking the office for assistance.",
        icon: MapPin,
        href: "/contact"
      }
    ]
  },
  {
    href: "/social",
    slug: "social",
    navLabel: "Social",
    title: "Public Information and Media",
    eyebrow: "Official Updates",
    description:
      "Site-managed social posts are not yet available. Use the official legislative profile for current public records and contact information.",
    imageKey: "capitol",
    cards: [
      {
        id: "post-highlights",
        title: "Official Legislative Profile",
        text: "Find sponsored bills, votes, committee assignments, biography, and contact information.",
        icon: Newspaper,
        href: siteConfig.officialProfileUrl
      },
      {
        id: "local-photos",
        title: "District Media",
        text: "This site uses the local image collection supplied with the website; no image is presented as proof of a specific service outcome.",
        icon: Users
      }
    ]
  }
];

export function getImage(key: string) {
  const asset = imageAssets.find((item) => item.key === key);
  if (!asset) throw new Error(`Missing image asset: ${key}`);
  return asset;
}

export function getPageBySlug(slug: string) {
  return pages.find((page) => page.slug === slug);
}
