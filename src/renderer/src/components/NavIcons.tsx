/** Primary-navigation icons, inlined per the glass.html reference (18×18,
 *  stroke-width 1.8). Shared by the sidebar and the welcome setup. */
export function IconDashboard(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" />
      <rect x="3" y="15" width="7" height="6" rx="1.5" />
    </svg>
  )
}

export function IconHot(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.4-5.4 3.6-8.3.5 1.9 1.6 3 2.7 3.6C12 7 13 4.6 15 3c.2 3 3.5 5.6 3.5 10.6C18.5 18.2 15.9 21 12 21Z" />
      <path d="M12 21c-1.6 0-2.8-1.2-2.8-2.9 0-1.6 1.2-2.6 2-4 .9 1.4 3.6 2.3 3.6 4.4 0 1.5-1.2 2.5-2.8 2.5Z" />
    </svg>
  )
}

export function IconFriends(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.4-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 6.6a3 3 0 0 1 0 5.8" />
      <path d="M16.6 14c2.3.2 3.9 2 3.9 4.4" />
    </svg>
  )
}

/** A pulse line: friends coming and going. */
export function IconActivity(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />
    </svg>
  )
}

export function IconInbox(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <path d="M4 13.5 6.6 5.6A2 2 0 0 1 8.5 4.2h7a2 2 0 0 1 1.9 1.4L20 13.5" />
      <path d="M4 13.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.5h-4.6l-1.2 2.3h-4.4l-1.2-2.3Z" />
    </svg>
  )
}

export function IconExplore(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.6 2.4 2.6 14.6 0 17M12 3.5c-2.6 2.4-2.6 14.6 0 17" />
    </svg>
  )
}

/** A magnifier: find people and worlds. */
export function IconSearch(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </svg>
  )
}

/** Three people in a row: the groups a user belongs to. */
export function IconGroups(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <circle cx="12" cy="8" r="3" />
      <circle cx="5" cy="10" r="2.2" />
      <circle cx="19" cy="10" r="2.2" />
      <path d="M6.5 20c0-3.2 2.4-5.5 5.5-5.5s5.5 2.3 5.5 5.5" />
      <path d="M2 19c0-2.3 1.4-4 3.4-4.3M22 19c0-2.3-1.4-4-3.4-4.3" />
    </svg>
  )
}

/** A shirt: the avatars a user wears. */
export function IconAvatars(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <path d="M8.2 3.5 3.5 6.2l1.9 3.7 2.4-1.1v11.7h8.4V8.8l2.4 1.1 1.9-3.7-4.7-2.7c-.6 1.5-2 2.4-3.8 2.4s-3.2-.9-3.8-2.4Z" />
    </svg>
  )
}

export function IconSettings(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <line x1="4" y1="8" x2="20" y2="8" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="9" cy="8" r="2.4" />
      <circle cx="15" cy="16" r="2.4" />
    </svg>
  )
}

/** A VR headset: friends in a game right now. Not a page; the Dashboard's
 *  In game statistic uses it beside the Friends and Hot icons. */
export function IconInGame(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-[18px] h-[18px] flex-none"
    >
      <path d="M5.5 7h13A2.5 2.5 0 0 1 21 9.5v5a2.5 2.5 0 0 1-2.5 2.5h-3.1l-1.9-2.4a1.9 1.9 0 0 0-3 0L8.6 17H5.5A2.5 2.5 0 0 1 3 14.5v-5A2.5 2.5 0 0 1 5.5 7Z" />
      <circle cx="8" cy="11.6" r="1.6" />
      <circle cx="16" cy="11.6" r="1.6" />
    </svg>
  )
}
