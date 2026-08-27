import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/shell/AppShell";
import { Onboarding } from "./screens/Onboarding";
import { Portfolio } from "./screens/Portfolio";
import { Swap } from "./screens/Swap";
import { Bridge } from "./screens/Bridge";
import { Vault } from "./screens/Vault";
import { Transfer } from "./screens/Transfer";
import { Staking } from "./screens/Staking";
import { DataScreen } from "./screens/Data";
import { Agent } from "./screens/Agent";
import { Mcp } from "./screens/Mcp";
import { Payments } from "./screens/Payments";
import { Settings } from "./screens/Settings";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/onboarding" replace />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/app" element={<AppShell />}>
        <Route index element={<Navigate to="portfolio" replace />} />
        <Route path="portfolio" element={<Portfolio />} />
        <Route path="swap" element={<Swap />} />
        <Route path="bridge" element={<Bridge />} />
        <Route path="vault" element={<Vault />} />
        <Route path="transfer" element={<Transfer />} />
        <Route path="staking" element={<Staking />} />
        <Route path="data" element={<DataScreen />} />
        <Route path="agent" element={<Agent />} />
        <Route path="mcp" element={<Mcp />} />
        <Route path="payments" element={<Payments />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
