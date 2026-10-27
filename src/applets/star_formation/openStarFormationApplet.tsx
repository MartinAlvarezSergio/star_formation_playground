import { OpenAppletOptions, OpenedApplet } from "../../core/host";
import { StarFormationCanvas } from "./StarFormationCanvas";

export function openStarFormationApplet(options?: OpenAppletOptions): OpenedApplet {
  return {
    id: "star-formation",
    title: "From cloud to star",
    description:
      "A cinematic birth of a massive star: a cold molecular cloud collapses, its core heats until hydrogen fuses, and the new blue star blows its birth cloud apart. Presenter keys and video export.",
    close: () => {
      options?.host?.onClose?.();
    },
    render: () => <StarFormationCanvas host={options?.host} />
  };
}
