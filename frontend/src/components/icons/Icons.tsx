interface IconProps {
  size?: number;
  w?: number;
  style?: React.CSSProperties;
}

const S = ({ d, w = 1.85, children, size = 18, style }: IconProps & { d?: string; children?: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" style={style}>
    {children || (d && <path d={d} />)}
  </svg>
);

export const Mark = ({ size = 28, compact = false }: { size?: number; compact?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={{ display: "block" }}>
    {compact ? (
      <path d="M14 88V52a36 36 0 0 1 72 0v36H72V52a22 22 0 0 0-44 0v36z" fill="currentColor" />
    ) : (
      <>
        <path d="M14 88V52a36 36 0 0 1 72 0v36H75V52a25 25 0 0 0-50 0v36z" fill="currentColor" />
        <path d="M37 88V52a13 13 0 0 1 26 0v36z" fill="currentColor" />
      </>
    )}
  </svg>
);

export const IcSwap = (p: IconProps) => <S {...p}><path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" /></S>;
export const IcBridge = (p: IconProps) => <S {...p}><path d="M3 16h18M6 16V9M18 16V9M3 9c0-3 4-5 9-5s9 2 9 5" /></S>;
export const IcVault = (p: IconProps) => <S {...p}><rect x="4" y="10" width="16" height="10" rx="2.5" /><path d="M8 10V7.5a4 4 0 0 1 8 0V10" /><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none" /></S>;
export const IcPortfolio = (p: IconProps) => <S {...p}><path d="M21 12a9 9 0 1 1-9-9" /><path d="M12 12l6-3M12 12v6" /></S>;
export const IcStake = (p: IconProps) => <S {...p}><path d="M12 3l8 4.5-8 4.5-8-4.5z" /><path d="M4 12l8 4.5 8-4.5M4 16.5L12 21l8-4.5" /></S>;
export const IcData = (p: IconProps) => <S {...p}><path d="M4 7c0-1.5 3.6-2.6 8-2.6S20 5.5 20 7v10c0 1.5-3.6 2.6-8 2.6S4 18.5 4 17z" /><path d="M4 7c0 1.5 3.6 2.6 8 2.6S20 8.5 20 7M4 12c0 1.5 3.6 2.6 8 2.6s8-1.1 8-2.6" /></S>;
export const IcAgent = (p: IconProps) => <S {...p}><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M12 7V3.5M9 3.5h6" /><circle cx="9" cy="13" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="13" r="1.2" fill="currentColor" stroke="none" /></S>;
export const IcMcp = (p: IconProps) => <S {...p}><path d="M8 4v6M16 4v6" /><rect x="5" y="10" width="14" height="5" rx="2" /><path d="M12 15v5" /></S>;
export const IcPay = (p: IconProps) => <S {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v9M9.7 9.6c0-1 .9-1.8 2.3-1.8s2.3.7 2.3 1.7c0 2.3-4.6 1.3-4.6 3.7 0 1 .9 1.8 2.3 1.8" /></S>;
export const IcSettings = (p: IconProps) => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.4 5.4l2 2M16.6 16.6l2 2M18.6 5.4l-2 2M7.4 16.6l-2 2" /></S>;
export const IcLock = (p: IconProps) => <S {...p}><rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></S>;
export const IcEye = (p: IconProps) => <S {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.6" /></S>;
export const IcEyeOff = (p: IconProps) => <S {...p}><path d="M3 3l18 18M10.6 6c.45-.07.92-.1 1.4-.1 6 0 9.5 6.1 9.5 6.1s-1 1.8-2.8 3.5M6.5 8.3C4.2 10 2.5 12 2.5 12S6 18.1 12 18.1c1 0 1.9-.15 2.7-.4" /></S>;
export const IcArrow = (p: IconProps) => <S {...p}><path d="M5 12h14M13 6l6 6-6 6" /></S>;
export const IcDown = (p: IconProps) => <S {...p}><path d="M12 5v14M6 13l6 6 6-6" /></S>;
export const IcCheck = (p: IconProps) => <S {...p}><path d="M4.5 12.5l5 5 10-11" /></S>;
export const IcClose = (p: IconProps) => <S {...p}><path d="M6 6l12 12M18 6L6 18" /></S>;
export const IcPlus = (p: IconProps) => <S {...p}><path d="M12 5v14M5 12h14" /></S>;
export const IcCopy = (p: IconProps) => <S {...p}><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4H6.5A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9" /></S>;
export const IcMenu = (p: IconProps) => <S {...p}><path d="M4 7h16M4 12h16M4 17h16" /></S>;
export const IcSearch = (p: IconProps) => <S {...p}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.7-4.7" /></S>;
export const IcShield = (p: IconProps) => <S {...p}><path d="M12 3l7.5 3v5.5c0 4.6-3.1 7.7-7.5 9.2-4.4-1.5-7.5-4.6-7.5-9.2V6z" /><path d="M9.3 12l1.9 1.9L15 9.8" /></S>;
export const IcSpark = (p: IconProps) => <S {...p}><path d="M12 3l2.2 4.6L19 8.3l-3.7 3.6.9 5.1L12 14.6l-4.2 2.4.9-5.1L5 8.3l4.8-.7z" /></S>;
export const IcHistory = (p: IconProps) => <S {...p}><path d="M3.5 12a8.5 8.5 0 1 1 8.5 8.5" /><path d="M3.5 12V7.5M3.5 12H8" /><path d="M12 8v4.5l3.5 2" /></S>;
export const IcExternal = (p: IconProps) => <S {...p}><path d="M14 4h6v6M20 4l-8.5 8.5" /><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" /></S>;
export const IcWallet = (p: IconProps) => <S {...p}><rect x="3.5" y="6" width="17" height="13" rx="2.5" /><path d="M3.5 10.5h17" /><circle cx="16.5" cy="14.5" r="1.1" fill="currentColor" stroke="none" /></S>;
export const IcAlert = (p: IconProps) => <S {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 8v4.5" /><circle cx="12" cy="16" r=".9" fill="currentColor" stroke="none" /></S>;

export const IcTokenEth = ({ size = 26 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="16" fill="#627EEA" />
    <path d="M16.3 4v8.9l7.5 3.4z" fill="#fff" fillOpacity=".6" />
    <path d="M16.3 4L8.7 16.3l7.6-3.4z" fill="#fff" />
    <path d="M16.3 21.9v6.1l7.5-10.4z" fill="#fff" fillOpacity=".6" />
    <path d="M16.3 28v-6.1L8.7 17.6z" fill="#fff" />
    <path d="M16.3 20.5l7.5-4.4-7.5-3.4z" fill="#fff" fillOpacity=".2" />
    <path d="M8.7 16.1l7.6 4.4v-7.8z" fill="#fff" fillOpacity=".6" />
  </svg>
);

export const IcTokenUsdc = ({ size = 26 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="16" fill="#2775CA" />
    <path
      d="M20.2 18.5c0-2.3-1.4-3.1-4.2-3.4-2-.3-2.4-.8-2.4-1.7s.7-1.5 2.1-1.5c1.3 0 2 .4 2.3 1.5.1.2.3.4.5.4h1.1c.3 0 .5-.2.5-.5v-.1c-.3-1.6-1.6-2.8-3.2-2.9v-1.7c0-.3-.2-.5-.6-.6h-1c-.3 0-.5.2-.6.6v1.7c-2 .3-3.2 1.6-3.2 3.2 0 2.2 1.3 3.1 4.1 3.4 1.9.3 2.5.7 2.5 1.8s-.9 1.8-2.2 1.8c-1.7 0-2.3-.7-2.5-1.7-.1-.3-.3-.5-.6-.5h-1.1c-.3 0-.5.2-.5.5v.1c.3 1.8 1.4 3.1 3.7 3.4v1.7c0 .3.2.5.6.6h1c.3 0 .5-.2.6-.6v-1.7c2-.4 3.3-1.7 3.3-3.4z"
      fill="#fff"
    />
    <path
      d="M13 24.4C8.4 22.7 6 17.6 7.8 13.1 8.7 10.6 10.6 8.7 13 7.9c.3-.1.4-.3.4-.6v-.9c0-.3-.1-.5-.4-.6-.1 0-.3 0-.4.1-5.5 1.7-8.5 7.5-6.8 13 1 3.2 3.5 5.8 6.8 6.8.3.1.5 0 .6-.3v-.9c0-.2-.2-.5-.4-.6z"
      fill="#fff"
    />
    <path
      d="M19 6.8c-.1-.1-.3 0-.4.3v.9c0 .3.1.5.4.6 4.6 1.7 7 6.8 5.2 11.3-.9 2.5-2.8 4.4-5.2 5.2-.3.1-.4.3-.4.6v.9c0 .3.1.5.4.6.1 0 .3 0 .4-.1 5.5-1.7 8.5-7.5 6.8-13-1-3.3-3.5-5.9-6.8-6.9z"
      fill="#fff"
    />
  </svg>
);

export const IcTokenUsdg = ({ size = 26 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="16" fill="#000" />
    <text x="16" y="21" textAnchor="middle" fontSize="15" fontWeight="700" fill="#fff" fontFamily="sans-serif">
      $
    </text>
  </svg>
);

export const IcMetaMask = (p: IconProps) => <S {...p} style={{ color: "#E4761B", ...p.style }}><rect x="3.5" y="6" width="17" height="13" rx="2.5" /><path d="M3.5 10.5h17" /><circle cx="16.5" cy="14.5" r="1.1" fill="currentColor" stroke="none" /></S>;

export const IcRobinhood = ({ size = 18 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M12 2C7.5 5.2 5 9.3 5 13c0 3 2.5 5.5 5.5 6.2-.6-2.3-.9-4.6-.9-6.9 0-3.8 1.1-7.2 2.4-9.3 1.3 2.1 2.4 5.5 2.4 9.3 0 2.3-.3 4.6-.9 6.9C16.5 18.5 19 16 19 13c0-3.7-2.5-7.8-7-11z" fill="#00C805" />
  </svg>
);

export const IcWalletConnect = ({ size = 18 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M7 10.2c2.8-2.7 7.2-2.7 10 0l.4.3a.35.35 0 0 1 0 .5l-1.2 1.2a.18.18 0 0 1-.25 0l-.5-.5c-1.9-1.9-5-1.9-6.9 0l-.6.6a.18.18 0 0 1-.25 0L6.5 11a.35.35 0 0 1 0-.5z" fill="#3396FF" />
    <path d="M19.6 12.5l1.1 1.1a.35.35 0 0 1 0 .5l-4.9 4.8a.36.36 0 0 1-.5 0l-3.5-3.4a.09.09 0 0 0-.12 0l-3.5 3.4a.36.36 0 0 1-.5 0l-4.9-4.8a.35.35 0 0 1 0-.5l1.1-1.1a.36.36 0 0 1 .5 0l3.5 3.4c.03.04.09.04.12 0l3.5-3.4a.36.36 0 0 1 .5 0l3.5 3.4c.03.04.09.04.12 0l3.5-3.4a.36.36 0 0 1 .5 0z" fill="#3396FF" />
  </svg>
);
