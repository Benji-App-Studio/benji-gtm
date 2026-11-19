// Outline icons in the reference's style: 24-unit grid, 1.6 stroke, round caps (Lucide-compatible
// shapes, drawn inline so there's no icon dependency). Size with size-*, colour with text-*.
import type { ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function make(name: string, body: ReactNode) {
  const Icon = ({ className = "size-5", strokeWidth = 1.6, ...props }: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} {...props}>{body}</svg>
  );
  Icon.displayName = name;
  return Icon;
}

export const IconGrid = make("IconGrid", <><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></>);
export const IconHome = make("IconHome", <><path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-5v6h-4A1.5 1.5 0 0 1 4 19z" /></>);
export const IconList = make("IconList", <><path d="M9 6.5h11M9 12h11M9 17.5h11" /><circle cx="4.75" cy="6.5" r="1" /><circle cx="4.75" cy="12" r="1" /><circle cx="4.75" cy="17.5" r="1" /></>);
export const IconPlug = make("IconPlug", <><path d="M9 3.5v4M15 3.5v4" /><path d="M6.5 7.5h11V11a5.5 5.5 0 0 1-11 0z" /><path d="M12 16.5v4" /></>);
export const IconSearch = make("IconSearch", <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IconPanel = make("IconPanel", <><rect x="3.5" y="4" width="17" height="16" rx="4" /><path d="M9.5 4v16" /></>);
export const IconCompass = make("IconCompass", <><circle cx="12" cy="12" r="8.5" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>);
export const IconLayers = make("IconLayers", <><path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z" /><path d="m3.5 12 8.5 4.5 8.5-4.5" /><path d="m3.5 16 8.5 4.5 8.5-4.5" /></>);
export const IconSparkles = make("IconSparkles", <><path d="M10 3.5 11.6 8a2 2 0 0 0 1.3 1.3L17.5 11l-4.6 1.6a2 2 0 0 0-1.3 1.3L10 18.5l-1.6-4.6a2 2 0 0 0-1.3-1.3L2.5 11l4.6-1.6A2 2 0 0 0 8.4 8z" /><path d="M18.5 3v4M16.5 5h4M19 16.5v3M17.5 18h3" /></>);
export const IconRocket = make("IconRocket", <><path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9A2.2 2.2 0 0 0 5 15z" /><path d="m12 15-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z" /><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5" /></>);
export const IconChart = make("IconChart", <><path d="M3.5 3.5v15a2 2 0 0 0 2 2h15" /><path d="m7.5 14.5 4-4 3 3 5.5-6" /></>);
export const IconTarget = make("IconTarget", <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></>);
export const IconRadar = make("IconRadar", <><path d="M19.07 4.93A10 10 0 1 0 22 12" /><path d="M16.24 7.76A6 6 0 1 0 18 12" /><path d="m12 12 7-7" /><circle cx="12" cy="12" r="1.5" /></>);
export const IconUser = make("IconUser", <><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></>);
export const IconUsers = make("IconUsers", <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14a6.5 6.5 0 0 1 3 6" /></>);
export const IconMegaphone = make("IconMegaphone", <><path d="M3.5 10v4a1 1 0 0 0 1 1H7l7 4.5v-15L7 9H4.5a1 1 0 0 0-1 1z" /><path d="M17.5 9a4 4 0 0 1 0 6" /><path d="M7 15l1 5h2.5l-1-5" /></>);
export const IconBox = make("IconBox", <><path d="M20.5 7.5 12 3 3.5 7.5v9L12 21l8.5-4.5z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" /></>);
export const IconBell = make("IconBell", <><path d="M6 8.5a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 14.5 6 8.5" /><path d="M10.3 20a1.9 1.9 0 0 0 3.4 0" /></>);
export const IconSettings = make("IconSettings", <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>);
export const IconHelp = make("IconHelp", <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.3a2.5 2.5 0 0 1 4.9.8c0 1.7-2.5 2.4-2.5 2.4M12 16.5h.01" /></>);
export const IconCalendar = make("IconCalendar", <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" /></>);
export const IconPin = make("IconPin", <><path d="M19.5 10c0 5-7.5 11-7.5 11S4.5 15 4.5 10a7.5 7.5 0 0 1 15 0" /><circle cx="12" cy="10" r="2.5" /></>);
export const IconDownload = make("IconDownload", <><path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5" /><path d="M4 15.5v1.5a3.5 3.5 0 0 0 3.5 3.5h9a3.5 3.5 0 0 0 3.5-3.5v-1.5" /></>);
export const IconShare = make("IconShare", <><circle cx="17.5" cy="5.5" r="2.5" /><circle cx="6.5" cy="12" r="2.5" /><circle cx="17.5" cy="18.5" r="2.5" /><path d="m8.7 13.3 6.6 3.9M15.3 6.8l-6.6 3.9" /></>);
export const IconPlus = make("IconPlus", <path d="M12 5v14M5 12h14" />);
export const IconMore = make("IconMore", <><circle cx="6" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1" fill="currentColor" stroke="none" /></>);
export const IconChevronDown = make("IconChevronDown", <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />);
export const IconChevronRight = make("IconChevronRight", <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />);
export const IconChevronLeft = make("IconChevronLeft", <path d="m14.5 6.5-5.5 5.5 5.5 5.5" />);
export const IconX = make("IconX", <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />);
export const IconFilters = make("IconFilters", <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>);
export const IconAlert = make("IconAlert", <><path d="M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0" /><path d="M12 9.5v4M12 17h.01" /></>);
export const IconCheckCircle = make("IconCheckCircle", <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>);
export const IconRepeat = make("IconRepeat", <><path d="M4 11V9.5a3 3 0 0 1 3-3h12.5" /><path d="m16.5 3.5 3 3-3 3" /><path d="M20 13v1.5a3 3 0 0 1-3 3H4.5" /><path d="m7.5 20.5-3-3 3-3" /></>);
export const IconClock = make("IconClock", <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
export const IconTrendUp = make("IconTrendUp", <><path d="M3.5 3.5v15a2 2 0 0 0 2 2h15" /><path d="m7.5 15 4-4.5 3 2.5 5.5-6" /><path d="M15.5 7h4.5v4.5" /></>);
export const IconMenu = make("IconMenu", <path d="M4 7h16M4 12h16M4 17h16" />);
export const IconLogout = make("IconLogout", <><path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14" /><path d="M9.5 16.5 5 12l4.5-4.5M5 12h10" /></>);
export const IconArrowRight = make("IconArrowRight", <path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />);
export const IconFile = make("IconFile", <><path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-10z" /><path d="M14 3.5v5h5M9 13h6M9 16.5h4" /></>);
export const IconStack = make("IconStack", <><ellipse cx="12" cy="6" rx="7.5" ry="2.5" /><path d="M4.5 6v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5V6" /><path d="M4.5 12v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-6" /></>);
export const IconCopy = make("IconCopy", <><rect x="8.5" y="8.5" width="12" height="12" rx="2.5" /><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" /></>);
export const IconCheck = make("IconCheck", <path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconImage = make("IconImage", <><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><circle cx="9" cy="10" r="1.75" /><path d="m20.5 15.5-4.6-4.6a1.5 1.5 0 0 0-2.1 0L5.5 19.5" /></>);
export const IconVideo = make("IconVideo", <><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M10 9.3v5.4a.5.5 0 0 0 .76.43l4.4-2.7a.5.5 0 0 0 0-.86l-4.4-2.7a.5.5 0 0 0-.76.43z" /></>);
export const IconCarousel = make("IconCarousel", <><rect x="6.5" y="4.5" width="11" height="15" rx="2.5" /><path d="M3.5 7v10M20.5 7v10" /></>);
export const IconPlay = make("IconPlay", <path d="M8 5.8v12.4a.8.8 0 0 0 1.2.7l10-6.2a.8.8 0 0 0 0-1.4l-10-6.2a.8.8 0 0 0-1.2.7z" fill="currentColor" />);
export const IconUpload = make("IconUpload", <><path d="M12 15.5v-11M7.5 9 12 4.5 16.5 9" /><path d="M4 15.5v1.5a3.5 3.5 0 0 0 3.5 3.5h9a3.5 3.5 0 0 0 3.5-3.5v-1.5" /></>);
export const IconTrash = make("IconTrash", <><path d="M4 6.5h16M9.5 6.5v-2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" /><path d="m6 6.5.9 12.1a2 2 0 0 0 2 1.9h6.2a2 2 0 0 0 2-1.9L18 6.5M10 10.5v6M14 10.5v6" /></>);
export const IconEye = make("IconEye", <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12" /><circle cx="12" cy="12" r="3" /></>);
export const IconEyeOff = make("IconEyeOff", <><path d="M10.6 5.6q.7-.1 1.4-.1c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.4 3.2M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 5.4-1.7" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3.5 3.5l17 17" /></>);
export const IconWand = make("IconWand", <><path d="m14.5 6.5 3 3L7 20l-3-3z" /><path d="m12.5 8.5 3 3" /><path d="M19 3v3M17.5 4.5h3M20.5 10v2M19.5 11h2M10 2.5v2M9 3.5h2" /></>);
export const IconPencil = make("IconPencil", <><path d="M16.5 3.9a2.1 2.1 0 0 1 3 3L8 18.4l-4.5 1.1 1.1-4.5z" /><path d="m14.5 5.9 3 3" /></>);
export const IconExternal = make("IconExternal", <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></>);
export const IconLock = make("IconLock", <><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8 10.5v-3a4 4 0 0 1 8 0v3" /></>);
export const IconArrowLeft = make("IconArrowLeft", <path d="M19 12H5M10.5 6.5 5 12l5.5 5.5" />);
export const IconKey = make("IconKey", <><circle cx="8" cy="15" r="4.5" /><path d="m11.3 11.7 8.2-8.2M16 7l2.5 2.5M19 4l1.5 1.5" /></>);
export const IconSun = make("IconSun", <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.5 1.5M18.3 18.3l1.5 1.5M2.5 12h2M19.5 12h2M4.2 19.8l1.5-1.5M18.3 5.7l1.5-1.5" /></>);
export const IconMoon = make("IconMoon", <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />);
export const IconMonitor = make("IconMonitor", <><rect x="3" y="4.5" width="18" height="12" rx="2.5" /><path d="M8.5 20.5h7M12 16.5v4" /></>);
export const IconCompose = make("IconCompose", <><path d="M11.5 4.5H7a2.5 2.5 0 0 0-2.5 2.5v10A2.5 2.5 0 0 0 7 19.5h10a2.5 2.5 0 0 0 2.5-2.5v-4.5" /><path d="M17.6 3.9a1.9 1.9 0 0 1 2.7 2.7L12.5 14.4l-3.4.7.7-3.4z" /></>);
export const IconChip = make("IconChip", <><rect x="6.5" y="6.5" width="11" height="11" rx="2.5" /><rect x="10" y="10" width="4" height="4" rx="1" /><path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3" /></>);
export const IconRefresh = make("IconRefresh", <><path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9" /><path d="M18.5 3.5v4h-4M5.5 20.5v-4h4" /></>);
