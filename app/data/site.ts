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
  src: string;
  alt: string;
};

export type Stat = {
  value: string;
  label: string;
};

export type Card = {
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
  officeName: "Office of Assemblywoman Carmen Morales",
  representativeName: "Carmen Morales",
  githubPagesRepo: "Official-Assembly-Website-V2",
  githubHttps: "https://github.com/Reuben-Williams/Official-Assembly-Website-V2.git",
  githubSsh: "git@github.com:Reuben-Williams/Official-Assembly-Website-V2.git",
  tagline:
    "A constituent-first district website for services, civic updates, voting information, and community connection.",
  demoNotice:
    "Demo preview while final domain, Vercel hosting, and Supabase data connections are being confirmed."
};

export const imageAssets: ImageAsset[] = [
  {
    key: "hero",
    src: "/images/carmen-capitol-portrait.jpg",
    alt: "Assemblywoman Carmen Morales with colleagues at the State House"
  },
  {
    key: "about",
    src: "/images/carmen-capitol-colleagues.jpg",
    alt: "Assemblywoman Carmen Morales meeting with legislative colleagues"
  },
  {
    key: "graduation",
    src: "/images/graduation-community.jpg",
    alt: "A graduate at a district graduation ceremony"
  },
  {
    key: "voteBoard",
    src: "/images/assembly-vote-board.jpg",
    alt: "New Jersey Assembly vote board showing the John R. Lewis Voter Empowerment Act"
  },
  {
    key: "clinic",
    src: "/images/expungement-clinic.jpg",
    alt: "Fresh Start expungement clinic event flyer"
  },
  {
    key: "coverage",
    src: "/images/rosy-bagolie-coverage.jpg",
    alt: "Graphic announcing expanded coverage legislation"
  },
  {
    key: "eventGroup",
    src: "/images/community-event-group.jpg",
    alt: "Community members gathered at an official district event"
  },
  {
    key: "outdoorVisit",
    src: "/images/outdoor-district-visit.jpg",
    alt: "Assemblywoman Carmen Morales visiting constituents outdoors"
  },
  {
    key: "business",
    src: "/images/small-business-roundtable.jpg",
    alt: "Small business roundtable with constituents at a local restaurant"
  },
  {
    key: "meeting",
    src: "/images/constituent-meeting.jpg",
    alt: "Constituent meeting in a local community space"
  },
  {
    key: "outreach",
    src: "/images/district-outreach.jpg",
    alt: "District outreach event with community supporters"
  },
  {
    key: "capitol",
    src: "/images/capitol-visit.jpg",
    alt: "Constituents and officials during a capitol visit"
  }
];

export const stats: Stat[] = [
  { value: "Services", label: "State agency help, forms, referrals" },
  { value: "Updates", label: "Legislation, alerts, and local events" },
  { value: "Access", label: "Voting, office contact, and newsletter tools" }
];

export const pages: PageContent[] = [
  {
    href: "/",
    navLabel: "Home",
    title: "Constituent Services, Legislative Updates, and Community Access",
    eyebrow: "Official District Demo",
    description:
      "A polished public-facing hub for residents to request help, follow Assembly updates, find civic resources, and stay connected with the district office.",
    imageKey: "hero",
    cards: [
      {
        title: "Get Help From the Office",
        text: "Route constituent questions to the right office workflow and prepare future Supabase-backed case intake.",
        icon: HeartHandshake,
        href: "/contact"
      },
      {
        title: "Track Community Updates",
        text: "Publish news, event announcements, service clinics, and urgent district notices in one consistent feed.",
        icon: Newspaper,
        href: "/news"
      },
      {
        title: "Find Civic Resources",
        text: "Give residents quick paths to voting, agency support, newsletter signup, and district feedback.",
        icon: Landmark,
        href: "/resources"
      }
    ]
  },
  {
    href: "/about",
    slug: "about",
    navLabel: "About",
    title: "About the Assemblywoman",
    eyebrow: "Public Service",
    description:
      "Introduce Assemblywoman Carmen Morales with a professional biography, district priorities, committee work, and a record of community engagement.",
    imageKey: "about",
    cards: [
      {
        title: "District-Focused Leadership",
        text: "Center local families, working people, schools, seniors, and small businesses in every public-facing message.",
        icon: Users
      },
      {
        title: "Legislative Priorities",
        text: "Highlight voting access, affordability, public safety, infrastructure, and responsive state services.",
        icon: Scale
      },
      {
        title: "Community Presence",
        text: "Use real event photography from the project folder instead of generated representative art.",
        icon: BadgeCheck
      }
    ],
    secondaryCards: [
      {
        title: "Prepared for the final biography",
        text: "The page is structured so confirmed biography, district number, committees, and office information can be edited in one data file.",
        icon: FileText
      }
    ]
  },
  {
    href: "/resources",
    slug: "resources",
    navLabel: "Resources",
    title: "District Resources and Services",
    eyebrow: "Constituent Support",
    description:
      "Organize common resident needs into clear service paths for agency navigation, forms, benefits, legal support, and local referrals.",
    imageKey: "clinic",
    cards: [
      {
        title: "State Agency Assistance",
        text: "Help residents prepare requests around unemployment, licensing, benefits, housing, and other state agency issues.",
        icon: ClipboardList
      },
      {
        title: "Fresh Start Clinics",
        text: "Promote expungement clinics and other public-service events with verified local event graphics.",
        icon: ShieldCheck
      },
      {
        title: "Downloadable Forms",
        text: "Reserve a future file library for consent forms, office request packets, and multilingual resources.",
        icon: FileText
      }
    ]
  },
  {
    href: "/news",
    slug: "news",
    navLabel: "News",
    title: "Community News and Legislative Alerts",
    eyebrow: "Updates",
    description:
      "A clean alert and news page for office statements, bill updates, district visits, community programs, and urgent service notices.",
    imageKey: "voteBoard",
    cards: [
      {
        title: "Voting Rights Update",
        text: "Feature legislative votes and explain what each measure means for district residents.",
        icon: Vote,
        tag: "Legislation"
      },
      {
        title: "Expanded Coverage",
        text: "Show public health and affordability announcements with a short resident-centered summary.",
        icon: Bell,
        tag: "Service Alert"
      },
      {
        title: "District Events",
        text: "Collect office hours, clinics, roundtables, and public meetings in a format ready for database-backed publishing.",
        icon: CalendarDays,
        tag: "Events"
      }
    ]
  },
  {
    href: "/community",
    slug: "community",
    navLabel: "Community",
    title: "Community Spotlight",
    eyebrow: "Around the District",
    description:
      "Use real district photos to showcase local businesses, graduates, families, civic partners, and neighborhood events.",
    imageKey: "business",
    cards: [
      {
        title: "Small Business Roundtables",
        text: "Share visits with business owners and residents, then connect them to resources and policy follow-up.",
        icon: Handshake
      },
      {
        title: "Graduation and Youth",
        text: "Highlight student milestones, school visits, and youth leadership moments from the district.",
        icon: BookOpenCheck
      },
      {
        title: "Constituent Conversations",
        text: "Document listening sessions and recurring community meetings with clear next steps.",
        icon: MessageSquareText
      }
    ]
  },
  {
    href: "/voting",
    slug: "voting",
    navLabel: "Voting",
    title: "Voting Information Portal",
    eyebrow: "Civic Access",
    description:
      "Give residents a direct place to find registration guidance, election deadlines, polling information, and ballot education links.",
    imageKey: "outreach",
    cards: [
      {
        title: "Register or Update",
        text: "Point voters to official registration and address-update resources.",
        icon: Vote
      },
      {
        title: "Find Polling Information",
        text: "Prepare links for early voting, vote-by-mail, and election day polling locations.",
        icon: MapPin
      },
      {
        title: "Know Your Rights",
        text: "Explain voter access protections and support options in plain language.",
        icon: ShieldCheck
      }
    ]
  },
  {
    href: "/contact",
    slug: "contact",
    navLabel: "Contact",
    title: "Contact the Assemblywoman",
    eyebrow: "Office Access",
    description:
      "A clear contact page for resident messages, office locations, service requests, social channels, and future Supabase intake.",
    imageKey: "meeting",
    cards: [
      {
        title: "Send a Message",
        text: "Static demo form today; ready to connect to `contact_messages` in Supabase.",
        icon: Mail
      },
      {
        title: "District Office",
        text: "Office address, phone, and hours are isolated for quick replacement once confirmed.",
        icon: Building2
      },
      {
        title: "Community Requests",
        text: "Prepare routing for event invitations, agency assistance, and legislative feedback.",
        icon: MessageSquareText
      }
    ]
  },
  {
    href: "/newsletter",
    slug: "newsletter",
    navLabel: "Newsletter",
    title: "Newsletter Signup",
    eyebrow: "Stay Informed",
    description:
      "Collect opt-ins for district updates, event reminders, legislative notes, and emergency alerts after Supabase is enabled.",
    imageKey: "eventGroup",
    cards: [
      {
        title: "District Updates",
        text: "Let residents choose updates on legislation, community services, and events.",
        icon: Megaphone
      },
      {
        title: "Future Supabase Table",
        text: "Prepared for a `newsletter_subscribers` table with email, ZIP code, topics, and consent timestamp.",
        icon: CheckCircle2
      }
    ]
  },
  {
    href: "/survey",
    slug: "survey",
    navLabel: "Survey",
    title: "District Feedback Survey",
    eyebrow: "Resident Voice",
    description:
      "Invite residents to share priorities and service concerns in a form that can later persist to Supabase.",
    imageKey: "outdoorVisit",
    cards: [
      {
        title: "Issue Priorities",
        text: "Capture resident interest in affordability, public safety, schools, transportation, and healthcare.",
        icon: ClipboardList
      },
      {
        title: "Neighborhood Context",
        text: "Add local context without requiring residents to navigate multiple office channels.",
        icon: MapPin
      }
    ]
  },
  {
    href: "/social",
    slug: "social",
    navLabel: "Social",
    title: "Social Media Feed",
    eyebrow: "Digital Updates",
    description:
      "A demo feed layout for short posts, event photos, public-service graphics, and legislative media.",
    imageKey: "capitol",
    cards: [
      {
        title: "Post Highlights",
        text: "Use a structured content feed now, then replace with CMS or Supabase rows later.",
        icon: Newspaper
      },
      {
        title: "Local Photos",
        text: "Photos are served from the repository so the GitHub Pages demo remains self-contained.",
        icon: Users
      }
    ]
  }
];

export function getImage(key: string) {
  const asset = imageAssets.find((item) => item.key === key);
  if (!asset) {
    throw new Error(`Missing image asset: ${key}`);
  }
  return asset;
}

export function getPageBySlug(slug: string) {
  return pages.find((page) => page.slug === slug);
}
