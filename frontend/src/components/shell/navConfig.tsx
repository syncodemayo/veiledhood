import type { ComponentType } from "react";
import { IcSwap, IcBridge, IcVault, IcPortfolio, IcStake, IcData, IcAgent, IcMcp, IcPay, IcArrow } from "../icons/Icons";

export type RouteId = "portfolio" | "swap" | "bridge" | "vault" | "transfer" | "staking" | "data" | "agent" | "mcp" | "payments" | "settings";

interface NavItem {
  id: RouteId;
  label: string;
  icon: ComponentType<{ size?: number }>;
  badge?: string;
}

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Trade",
    items: [
      { id: "vault", label: "Vault", icon: IcVault },
      { id: "swap", label: "Swap", icon: IcSwap },
      { id: "bridge", label: "Bridge", icon: IcBridge },
      { id: "transfer", label: "Transfer", icon: IcArrow },
    ],
  },
  {
    group: "Assets",
    items: [
      { id: "portfolio", label: "Portfolio", icon: IcPortfolio },
      { id: "staking", label: "Staking", icon: IcStake },
    ],
  },
  {
    group: "Private",
    items: [
      { id: "data", label: "Data", icon: IcData },
      { id: "agent", label: "Agent", icon: IcAgent, badge: "AI" },
      { id: "mcp", label: "MCP", icon: IcMcp, badge: "2" },
      { id: "payments", label: "Payments", icon: IcPay },
    ],
  },
];

export const TITLES: Record<RouteId, [string, string]> = {
  portfolio: ["Portfolio", "Shielded and public balances in one view"],
  swap: ["Swap", "Trade without publishing the trail"],
  bridge: ["Bridge", "Move value in and out of the shielded pool"],
  vault: ["Vault", "Deposit to shield, withdraw to reveal"],
  transfer: ["Transfer", "Send shielded balance to another address, privately"],
  staking: ["Staking", "Earn on shielded positions"],
  data: ["Encrypted data", "Ciphertext at rest — your key never leaves"],
  agent: ["Agent", "Private inference over your own context"],
  mcp: ["MCP server", "Give agents tools without giving them plaintext"],
  payments: ["Agent payments", "Pay-per-call settlement on stealth addresses"],
  settings: ["Settings", "Privacy defaults and connected surfaces"],
};
