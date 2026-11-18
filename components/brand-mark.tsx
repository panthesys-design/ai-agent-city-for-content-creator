/** The Creator City isometric logo mark, shared by the auth and onboarding pages. */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 32 32">
      <defs>
        <linearGradient id="cc-mark-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c4b5fd" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <path d="M16 3 28 10 16 17 4 10Z" fill="url(#cc-mark-top)" />
      <path d="M4 10 16 17v12L4 22Z" fill="#6d4ae0" />
      <path d="M28 10 16 17v12l12-7Z" fill="#4c2fb3" />
      <path d="M12.5 21.2v-3.1l1.8 1v3.1Zm7.2-3.2 1.8-1v3.1l-1.8 1Z" fill="#fde68a" />
    </svg>
  );
}
