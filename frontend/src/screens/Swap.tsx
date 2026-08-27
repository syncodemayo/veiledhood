import { Panel, Empty } from "../components/primitives/primitives";
import { IcSwap } from "../components/icons/Icons";

export function Swap() {
  return (
    <div className="wrap-n">
      <Panel title="Swap">
        <Empty icon={<IcSwap size={22} />} title="Coming soon" desc="Private swap isn't live yet." />
      </Panel>
    </div>
  );
}
