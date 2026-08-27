import { Panel, Empty } from "../components/primitives/primitives";
import { IcBridge } from "../components/icons/Icons";

export function Bridge() {
  return (
    <div className="wrap-n">
      <Panel title="Bridge">
        <Empty
          icon={<IcBridge size={22} />}
          title="Coming soon"
          desc="Bridging isn't live yet."
        />
      </Panel>
    </div>
  );
}
