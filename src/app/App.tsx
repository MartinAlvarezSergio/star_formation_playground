import { useMemo } from "react";
import { AppletHostAdapter } from "../core/host";
import { StarFormationCanvas } from "../applets/star_formation/StarFormationCanvas";

export function App(): JSX.Element {
  const host: AppletHostAdapter = useMemo(
    () => ({
      onClose: () => {},
      readReducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
    }),
    []
  );

  return (
    <div className="app-shell">
      <main id="main-content">
        <section className="modal card">
          <StarFormationCanvas host={host} />
        </section>
      </main>
    </div>
  );
}
