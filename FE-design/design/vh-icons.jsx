// VeiledHood — mark + icon set
const S = ({d, w = 1.85, children, size = 18, fill }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || "none"} stroke={fill ? "none" : "currentColor"} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round">{children || <path d={d} />}</svg>
);

// The mark — Arch × Aperture. 14 units of padding built into the artboard.
const Mark = ({ size = 28, compact = false }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={{ display: 'block' }}>
    {compact
      ? <path d="M14 88V52a36 36 0 0 1 72 0v36H72V52a22 22 0 0 0-44 0v36z" fill="currentColor" />
      : <><path d="M14 88V52a36 36 0 0 1 72 0v36H75V52a25 25 0 0 0-50 0v36z" fill="currentColor" /><path d="M37 88V52a13 13 0 0 1 26 0v36z" fill="currentColor" /></>}
  </svg>
);

const IcSwap = p => <S {...p}><path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" /></S>;
const IcBridge = p => <S {...p}><path d="M3 16h18M6 16V9M18 16V9M3 9c0-3 4-5 9-5s9 2 9 5" /></S>;
const IcVault = p => <S {...p}><rect x="4" y="10" width="16" height="10" rx="2.5" /><path d="M8 10V7.5a4 4 0 0 1 8 0V10" /><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none" /></S>;
const IcPortfolio = p => <S {...p}><path d="M21 12a9 9 0 1 1-9-9" /><path d="M12 12l6-3M12 12v6" /></S>;
const IcStake = p => <S {...p}><path d="M12 3l8 4.5-8 4.5-8-4.5z" /><path d="M4 12l8 4.5 8-4.5M4 16.5L12 21l8-4.5" /></S>;
const IcData = p => <S {...p}><path d="M4 7c0-1.5 3.6-2.6 8-2.6S20 5.5 20 7v10c0 1.5-3.6 2.6-8 2.6S4 18.5 4 17z" /><path d="M4 7c0 1.5 3.6 2.6 8 2.6S20 8.5 20 7M4 12c0 1.5 3.6 2.6 8 2.6s8-1.1 8-2.6" /></S>;
const IcAgent = p => <S {...p}><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M12 7V3.5M9 3.5h6" /><circle cx="9" cy="13" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="13" r="1.2" fill="currentColor" stroke="none" /></S>;
const IcMcp = p => <S {...p}><path d="M8 4v6M16 4v6" /><rect x="5" y="10" width="14" height="5" rx="2" /><path d="M12 15v5" /></S>;
const IcPay = p => <S {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v9M9.7 9.6c0-1 .9-1.8 2.3-1.8s2.3.7 2.3 1.7c0 2.3-4.6 1.3-4.6 3.7 0 1 .9 1.8 2.3 1.8" /></S>;
const IcSettings = p => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.4 5.4l2 2M16.6 16.6l2 2M18.6 5.4l-2 2M7.4 16.6l-2 2" /></S>;
const IcLock = p => <S {...p}><rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></S>;
const IcEye = p => <S {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.6" /></S>;
const IcEyeOff = p => <S {...p}><path d="M3 3l18 18M10.6 6c.45-.07.92-.1 1.4-.1 6 0 9.5 6.1 9.5 6.1s-1 1.8-2.8 3.5M6.5 8.3C4.2 10 2.5 12 2.5 12S6 18.1 12 18.1c1 0 1.9-.15 2.7-.4" /></S>;
const IcArrow = p => <S {...p}><path d="M5 12h14M13 6l6 6-6 6" /></S>;
const IcDown = p => <S {...p}><path d="M12 5v14M6 13l6 6 6-6" /></S>;
const IcCheck = p => <S {...p}><path d="M4.5 12.5l5 5 10-11" /></S>;
const IcClose = p => <S {...p}><path d="M6 6l12 12M18 6L6 18" /></S>;
const IcPlus = p => <S {...p}><path d="M12 5v14M5 12h14" /></S>;
const IcCopy = p => <S {...p}><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4H6.5A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9" /></S>;
const IcMenu = p => <S {...p}><path d="M4 7h16M4 12h16M4 17h16" /></S>;
const IcSearch = p => <S {...p}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.7-4.7" /></S>;
const IcShield = p => <S {...p}><path d="M12 3l7.5 3v5.5c0 4.6-3.1 7.7-7.5 9.2-4.4-1.5-7.5-4.6-7.5-9.2V6z" /><path d="M9.3 12l1.9 1.9L15 9.8" /></S>;
const IcSpark = p => <S {...p}><path d="M12 3l2.2 4.6L19 8.3l-3.7 3.6.9 5.1L12 14.6l-4.2 2.4.9-5.1L5 8.3l4.8-.7z" /></S>;
const IcHistory = p => <S {...p}><path d="M3.5 12a8.5 8.5 0 1 1 8.5 8.5" /><path d="M3.5 12V7.5M3.5 12H8" /><path d="M12 8v4.5l3.5 2" /></S>;
const IcExternal = p => <S {...p}><path d="M14 4h6v6M20 4l-8.5 8.5" /><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" /></S>;
const IcWallet = p => <S {...p}><rect x="3.5" y="6" width="17" height="13" rx="2.5" /><path d="M3.5 10.5h17" /><circle cx="16.5" cy="14.5" r="1.1" fill="currentColor" stroke="none" /></S>;
const IcAlert = p => <S {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 8v4.5" /><circle cx="12" cy="16" r=".9" fill="currentColor" stroke="none" /></S>;

Object.assign(window, { Mark, IcSwap, IcBridge, IcVault, IcPortfolio, IcStake, IcData, IcAgent, IcMcp, IcPay, IcSettings, IcLock, IcEye, IcEyeOff, IcArrow, IcDown, IcCheck, IcClose, IcPlus, IcCopy, IcMenu, IcSearch, IcShield, IcSpark, IcHistory, IcExternal, IcWallet, IcAlert });
