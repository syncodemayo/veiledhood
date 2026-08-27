import { Panel, Empty } from "../components/primitives/primitives";
import { IcStake } from "../components/icons/Icons";

export function Staking() {
  return (
    <div className="wrap">
      <Panel title="Staking">
        <Empty icon={<IcStake size={22} />} title="Coming soon" desc="Staking isn't live yet." />
      </Panel>
    </div>
  );
}
