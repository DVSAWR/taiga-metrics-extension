import type { SVGProps } from "react";

interface IconDefinition {
  viewBox: string;
  paths: string[];
  strokes?: string[];
  strokeWidth?: number;
}

const STROKE_WIDTH = 1.75;

const ICONS = {
  bulb: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7",
      "M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3",
      "M9.7 17l4.6 0",
    ],
  },
  horse: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M3.5 17.5c5.667 4.667 11.333 4.667 17 0",
      "M19 18.5l-2 -8.5l1 -2l2 1l1.5 -1.5l-2.5 -4.5c-5.052 .218 -5.99 3.133 -7 6h-6a3 3 0 0 0 -3 3",
      "M5 18.5l2 -9.5",
      "M8 20l2 -5h4l2 5",
    ],
  },
  backpack: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M5 18v-6a6 6 0 0 1 6 -6h2a6 6 0 0 1 6 6v6a3 3 0 0 1 -3 3h-8a3 3 0 0 1 -3 -3",
      "M10 6v-1a2 2 0 1 1 4 0v1",
      "M9 21v-4a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v4",
      "M11 10h2",
    ],
  },
  message: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M8 9h8",
      "M8 13h6",
      "M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12",
    ],
  },
  reload: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: ["M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4", "M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"],
  },
  person: {
    viewBox: "0 0 24 24",
    paths: [
      "M12 2a5 5 0 1 1 -5 5l.005 -.217a5 5 0 0 1 4.995 -4.783z",
      "M14 14a5 5 0 0 1 5 5v1a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-1a5 5 0 0 1 5 -5h4z",
    ],
  },
  briefcase: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M3 9a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -9",
      "M8 7v-2a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2",
      "M12 12l0 .01",
      "M3 13a20 20 0 0 0 18 0",
    ],
  },
  iocaine: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M9 3l6 0",
      "M10 9l4 0",
      "M10 3v6l-4 11a.7 .7 0 0 0 .5 1h11a.7 .7 0 0 0 .5 -1l-4 -11v-6",
    ],
  },
  edit: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: ["M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4", "M13.5 6.5l4 4"],
  },
  bug: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M9 9v-1a3 3 0 0 1 6 0v1",
      "M8 9h8a6 6 0 0 1 1 3v3a5 5 0 0 1 -10 0v-3a6 6 0 0 1 1 -3",
      "M3 13l4 0",
      "M17 13l4 0",
      "M12 20l0 -6",
      "M4 19l3.35 -2",
      "M20 19l-3.35 -2",
      "M4 7l3.75 2.4",
      "M20 7l-3.75 2.4",
    ],
  },
  task: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M9 11l3 3l8 -8",
      "M20 12v6a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h9",
    ],
  },
  badge: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M7 12h3v4h-3l0 -4",
      "M10 6h-6a1 1 0 0 0 -1 1v12a1 1 0 0 0 1 1h16a1 1 0 0 0 1 -1v-12a1 1 0 0 0 -1 -1h-6",
      "M10 4a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -3",
      "M14 16h2",
      "M14 12h4",
    ],
  },
  moduleUserStories: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M14 3v4a1 1 0 0 0 1 1h4",
      "M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2",
      "M9 9l1 0",
      "M9 13l6 0",
      "M9 17l6 0",
    ],
  },
  moduleTasks: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M3.5 5.5l1.5 1.5l2.5 -2.5",
      "M3.5 11.5l1.5 1.5l2.5 -2.5",
      "M3.5 17.5l1.5 1.5l2.5 -2.5",
      "M11 6l9 0",
      "M11 12l9 0",
      "M11 18l9 0",
    ],
  },
  bell: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6",
      "M9 17v1a3 3 0 0 0 6 0v-1",
    ],
  },
  helpCircle: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0",
      "M12 16v.01",
      "M12 13a2 2 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483",
    ],
  },
  resources: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0",
      "M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0",
      "M3 6l0 13",
      "M12 6l0 13",
      "M21 6l0 13",
    ],
  },
  github: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M9 19c-4.3 1.4 -4.3 -2.5 -6 -3m12 5v-3.5c0 -1 .1 -1.4 -.5 -2c2.8 -.3 5.5 -1.4 5.5 -6a4.6 4.6 0 0 0 -1.3 -3.2a4.2 4.2 0 0 0 -.1 -3.2s-1.1 -.3 -3.5 1.3a12.3 12.3 0 0 0 -6.2 0c-2.4 -1.6 -3.5 -1.3 -3.5 -1.3a4.2 4.2 0 0 0 -.1 3.2a4.6 4.6 0 0 0 -1.3 3.2c0 4.6 2.7 5.7 5.5 6c-.6 .6 -.6 1.2 -.5 2v3.5",
    ],
  },
  moduleEpics: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: ["M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11"],
  },
  moduleScrum: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3",
      "M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3",
    ],
  },
  moduleKanban: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M4 4l6 0",
      "M14 4l6 0",
      "M4 10a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2l0 -8",
      "M14 10a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2l0 -2",
    ],
  },
  moduleIssues: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: ["M18 7v14l-6 -4l-6 4v-14a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4"],
  },
  settings: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065",
      "M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0",
    ],
  },
  user: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: ["M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0", "M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"],
  },
  chevronDown: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: ["M6 9l6 6l6 -6"],
  },
  folder: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2",
    ],
  },
  graph: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M3 3v18h18",
      "M20 18v3",
      "M16 16v5",
      "M12 13v8",
      "M8 16v5",
      "M3 11c6 0 5 -5 9 -5s3 5 9 5",
    ],
  },
  sidebarSettings: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065",
      "M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0",
    ],
  },
  chevronsLeft: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: ["M11 7l-5 5l5 5", "M17 7l-5 5l5 5"],
  },
  search: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: ["M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0", "M21 21l-6 -6"],
  },
  users: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0",
      "M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2",
      "M16 3.13a4 4 0 0 1 0 7.75",
      "M21 21v-2a4 4 0 0 0 -3 -3.85",
    ],
  },
  filters: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M12 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
      "M4 6l8 0",
      "M16 6l4 0",
      "M6 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
      "M4 12l2 0",
      "M10 12l10 0",
      "M15 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
      "M4 18l11 0",
      "M19 18l1 0",
    ],
  },
  arrowRight: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: ["M9 6l6 6l-6 6"],
  },
  arrowDown: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: ["M6 9l6 6l6 -6"],
  },
  close: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: ["M18 6l-12 12", "M6 6l12 12"],
  },
  trash: {
    viewBox: "0 0 24 24",
    paths: [],
    strokes: [
      "M4 7l16 0",
      "M10 11l0 6",
      "M14 11l0 6",
      "M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12",
      "M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3",
    ],
  },
} satisfies Record<string, IconDefinition>;

export type IconName = keyof typeof ICONS;

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  title?: string;
}

export function Icon({ name, title, className, ...rest }: IconProps) {
  const icon: IconDefinition = ICONS[name];
  return (
    <svg
      viewBox={icon.viewBox}
      className={`icon icon-${name}${className ? ` ${className}` : ""}`}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...rest}
    >
      {title && <title>{title}</title>}
      {icon.paths.map((path) => (
        <path key={path} d={path} />
      ))}
      {icon.strokes?.map((path) => (
        <path
          key={path}
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={icon.strokeWidth ?? STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
