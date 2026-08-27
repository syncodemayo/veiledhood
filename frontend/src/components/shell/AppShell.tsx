import { useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Rail } from "./Rail";
import { Top } from "./Top";
import { MobileTabs } from "./MobileTabs";
import type { RouteId } from "./navConfig";
import { useAuth } from "../../context/AuthContext";
import { usePrivacy } from "../../context/PrivacyContext";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { WalletContextFull } from "../../types/api";

export function AppShell() {
  const { address, token } = useAuth();
  const { visible, toggle } = usePrivacy();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const route = (location.pathname.split("/")[2] || "portfolio") as RouteId;

  const { data } = useQuery({
    queryKey: ["context-full"],
    queryFn: () => api.post<WalletContextFull>("/context/full", {}),
    enabled: Boolean(token),
    staleTime: 30_000,
  });

  if (!token || !address) return <Navigate to="/onboarding" replace />;

  function go(id: RouteId) {
    navigate(`/app/${id}`);
  }

  return (
    <div className="app">
      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}
      <Rail route={route} go={go} open={drawer} onClose={() => setDrawer(false)} wallet={address} totalUsd={data?.totalUsd ?? 0} />
      <div className="main">
        <Top route={route} onMenu={() => setDrawer(true)} visible={visible} toggleVisible={toggle} />
        <div className="content">
          <Outlet />
        </div>
      </div>
      <MobileTabs route={route} go={go} />
    </div>
  );
}
