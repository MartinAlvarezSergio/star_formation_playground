import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isMp4SupportedSync } from "../../core/canvasRecorder";
import { AppletHostAdapter } from "../../core/host";
import { exportOfflineVideo } from "../../core/offlineVideoExport";
import { AppletStage } from "../../ui/stage/AppletStage";
import {
  StageDivider,
  StageIconButton,
  StagePillButton,
  StagePills,
  StageReadout,
  StageSection,
  StageSegmented,
  StageSelect,
  StageSlider,
  StageToggle
} from "../../ui/stage/StageControls";
import { renderStarScene, SCENE_H, SCENE_W, SceneOptions } from "./scene";
import {
  chapterIndexAt,
  CHAPTERS,
  formatAtoms,
  formatLength,
  formatSuns,
  formatTemperature,
  formatYears,
  stateAt,
  STORY_DURATION
} from "./timeline";

type Props = {
  host?: AppletHostAdapter;
};

const TIP = {
  play: "Play or pause the film (Space).",
  prev: "Back to the start of this chapter, or the previous one (← or Page Up).",
  next: "Continue, or skip to the next chapter (→ or Page Down). Presentation clickers send these keys.",
  restart: "Back to the very beginning.",
  playback: "Playback speed. Only the pace on screen changes.",
  cinematic:
    "Hide the controls, captions and labels (C); the clock shrinks to time and temperature. Click the film to play or pause; the corner button or C brings the controls back.",
  chapter: "Jump to a chapter.",
  story: "Scrub through the film.",
  captions: "Chapter titles and explanations, bottom left.",
  clock: "Time, temperature, density and field of view, top right.",
  labels: "Short labels naming what is on screen (disk, jets, fusion reactions...).",
  timeline: "Chapter timeline along the bottom edge.",
  scale: "Scale bar and a powers-of-ten ruler, bottom right: how far the camera has zoomed, from clouds down to nuclei.",
  graph: "While the star piles on mass: atoms gathered and core temperature over time, right.",
  pauseBetween: "Hold just before each chapter ends, so you can talk; → or Page Down continues.",
  resolution: "Video size. 1080p is best for a talk; 720p exports faster and works on more browsers.",
  fps: "Frames per second of the video.",
  videoSpeed: "½× renders the film in slow motion: twice as long, every frame newly drawn (no repeated frames).",
  cleanVideo: "Video without captions, labels or timeline, as in cinematic mode.",
  exportBtn: "Render the whole film off-screen and download it. Uses the on-screen options above.",
  cancel: "Stop exporting; nothing is downloaded."
} as const;

const PLAYBACK_OPTIONS = [
  { value: 0.5, label: "½×" },
  { value: 1, label: "1×" },
  { value: 2, label: "2×" }
];

/** Pause this long before a chapter ends, while its caption is still fully visible. */
const HOLD_BEFORE_END = 0.55;

type ExportMessage = { short: string; detail: string };
type ExportState = { running: boolean; done: number; total: number; message: ExportMessage | null };

export function StarFormationCanvas({ host }: Props): JSX.Element {
  const sceneRef = useRef<HTMLCanvasElement | null>(null);
  const reducedMotion = host?.readReducedMotion?.() ?? false;

  const [playing, setPlaying] = useState(false);
  const [playback, setPlayback] = useState<number>(reducedMotion ? 0.5 : 1);
  const [pauseBetween, setPauseBetween] = useState(false);
  const [scene, setScene] = useState<SceneOptions>({
    captions: true,
    clock: true,
    labels: true,
    timeline: false,
    scale: true,
    graph: true,
    gentle: reducedMotion,
    minimal: false
  });
  const [cinematic, setCinematic] = useState(false);
  const [story, setStory] = useState(0);
  const [resolution, setResolution] = useState<1080 | 720>(1080);
  const [fps, setFps] = useState<30 | 60>(30);
  const [videoSpeed, setVideoSpeed] = useState<0.5 | 1>(1);
  const [cleanVideo, setCleanVideo] = useState(false);
  const [exporting, setExporting] = useState<ExportState>({ running: false, done: 0, total: 0, message: null });
  const exportCancel = useRef(false);

  const storyRef = useRef(0);
  const shownScene: SceneOptions = cinematic ? { ...scene, minimal: true } : scene;
  const live = useRef({ playing, playback, pauseBetween, scene: shownScene, exporting: false });
  live.current = { playing, playback, pauseBetween, scene: shownScene, exporting: exporting.running };

  const drawNow = useCallback(() => {
    const sctx = sceneRef.current?.getContext("2d");
    if (sctx && !live.current.exporting) {
      renderStarScene(sctx, storyRef.current, live.current.scene);
    }
  }, []);

  useEffect(() => {
    let last = performance.now();
    let lastReadout = -Infinity;
    let raf = 0;
    const tick = (time: number): void => {
      const dt = Math.min(0.1, (time - last) / 1000);
      last = time;
      const now = live.current;
      if (now.playing && !now.exporting) {
        const s = storyRef.current;
        let next = s + dt * now.playback;
        let hold = false;
        if (now.pauseBetween) {
          const holdAt = CHAPTERS[chapterIndexAt(s)].end - HOLD_BEFORE_END;
          if (s < holdAt - 1e-6 && next >= holdAt) {
            next = holdAt;
            hold = true;
          }
        }
        storyRef.current = Math.min(STORY_DURATION, next);
        if (hold || storyRef.current >= STORY_DURATION) {
          setPlaying(false);
        }
      }
      drawNow();
      if (time - lastReadout > 200) {
        lastReadout = time;
        setStory(storyRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [drawNow]);

  const seek = useCallback(
    (to: number) => {
      storyRef.current = Math.min(STORY_DURATION, Math.max(0, to));
      setStory(storyRef.current);
      drawNow();
    },
    [drawNow]
  );

  const togglePlay = useCallback(() => {
    if (live.current.exporting) {
      return;
    }
    if (!live.current.playing && storyRef.current >= STORY_DURATION - 1e-6) {
      seek(0);
    }
    setPlaying((p) => !p);
  }, [seek]);

  const next = useCallback(() => {
    if (live.current.exporting) {
      return;
    }
    const s = storyRef.current;
    const index = chapterIndexAt(s);
    const holdAt = CHAPTERS[index].end - HOLD_BEFORE_END;
    if (!live.current.playing && Math.abs(s - holdAt) < 0.05 && index < CHAPTERS.length - 1) {
      seek(s + HOLD_BEFORE_END + 1e-3);
      setPlaying(true);
      return;
    }
    if (index < CHAPTERS.length - 1) {
      seek(CHAPTERS[index + 1].start);
      setPlaying(true);
    }
  }, [seek]);

  const prev = useCallback(() => {
    if (live.current.exporting) {
      return;
    }
    const s = storyRef.current;
    const index = chapterIndexAt(s);
    seek(s - CHAPTERS[index].start > 1.5 || index === 0 ? CHAPTERS[index].start : CHAPTERS[index - 1].start);
  }, [seek]);

  const restart = useCallback(() => {
    setPlaying(false);
    seek(0);
    host?.onResult?.({ event: "restart" });
  }, [seek, host]);

  const setCinematicMode = useCallback(
    (on: boolean) => {
      setCinematic(on);
      drawNow();
    },
    [drawNow]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.altKey || e.ctrlKey || e.metaKey) {
        return;
      }
      if (e.key === " " && tag !== "BUTTON") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        prev();
      } else if (e.key === "Home") {
        e.preventDefault();
        restart();
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        setCinematic((on) => !on);
      } else if (e.key === "Escape" && !document.fullscreenElement) {
        setCinematic(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, next, prev, restart]);

  function setOption<K extends keyof SceneOptions>(key: K, value: SceneOptions[K]): void {
    const nextScene = { ...scene, [key]: value };
    live.current.scene = cinematic ? { ...nextScene, minimal: true } : nextScene;
    setScene(nextScene);
    drawNow();
  }

  async function startExport(): Promise<void> {
    setPlaying(false);
    exportCancel.current = false;
    const height = resolution;
    const width = Math.round((height * SCENE_W) / SCENE_H);
    const total = Math.round((STORY_DURATION * fps) / videoSpeed);
    const videoScene = cleanVideo ? { ...scene, minimal: true } : scene;
    setExporting({ running: true, done: 0, total, message: null });
    live.current.exporting = true;
    const result = await exportOfflineVideo({
      width,
      height,
      fps,
      totalFrames: total,
      filenameStem: "star_formation",
      renderFrame: (ctx, i) => renderStarScene(ctx, (i * videoSpeed) / fps, videoScene),
      onProgress: (done, all, preview) => {
        setExporting({ running: true, done, total: all, message: null });
        const sctx = sceneRef.current?.getContext("2d");
        if (sctx && sceneRef.current) {
          sctx.setTransform(1, 0, 0, 1, 0, 0);
          sctx.drawImage(preview, 0, 0, sceneRef.current.width, sceneRef.current.height);
        }
      },
      isCancelled: () => exportCancel.current
    });
    live.current.exporting = false;
    const message: ExportMessage =
      result.status === "done"
        ? {
            short: result.format === "mp4" ? "saved MP4" : "saved zip",
            detail: `Saved as ${result.format === "mp4" ? "an MP4 video" : "a zip of frames"} in your downloads.`
          }
        : result.status === "cancelled"
          ? { short: "cancelled", detail: "Export cancelled; nothing was saved." }
          : { short: "failed", detail: `Export failed: ${result.message ?? "unknown error"}` };
    setExporting({ running: false, done: 0, total: 0, message });
    host?.onResult?.({ event: "export", status: result.status });
  }

  const now = stateAt(story);
  const chapterIndex = now.chapterIndex;
  const mp4 = useMemo(() => isMp4SupportedSync(), []);
  const exportProgress = exporting.total > 0 ? Math.round((100 * exporting.done) / exporting.total) : 0;

  const toolbar = (
    <>
      <StagePillButton label="‹" tip={TIP.prev} disabled={exporting.running} onClick={prev} />
      <StageIconButton
        icon={playing ? "pause" : "play"}
        label={playing ? "Pause" : "Play"}
        tip={TIP.play}
        disabled={exporting.running}
        onClick={togglePlay}
      />
      <StagePillButton label="›" tip={TIP.next} disabled={exporting.running} onClick={next} />
      <StageIconButton icon="reset" label="Restart" tip={TIP.restart} disabled={exporting.running} onClick={restart} />
      <StageDivider />
      <StageSegmented ariaLabel="Playback speed" tip={TIP.playback} value={playback} options={PLAYBACK_OPTIONS} onChange={setPlayback} />
      <StageDivider />
      <StagePillButton label="Cinematic" tip={TIP.cinematic} disabled={exporting.running} onClick={() => setCinematicMode(true)} />
    </>
  );

  const controls = (
    <>
      <StageSection title="Film">
        <StageSelect
          label="Chapter"
          tip={TIP.chapter}
          value={CHAPTERS[chapterIndex].id}
          options={CHAPTERS.map((c, i) => ({ value: c.id, label: `${i + 1}. ${c.title}` }))}
          disabled={exporting.running}
          onChange={(id) => seek(CHAPTERS.find((c) => c.id === id)?.start ?? 0)}
        />
        <StageSlider
          label="Position"
          display={`${story.toFixed(1)} / ${STORY_DURATION} s`}
          value={story}
          min={0}
          max={STORY_DURATION}
          step={0.1}
          tip={TIP.story}
          disabled={exporting.running}
          onChange={seek}
        />
      </StageSection>
      <StageSection title="On screen">
        <StagePills>
          <StageToggle label="Captions" tip={TIP.captions} on={scene.captions} onChange={(on) => setOption("captions", on)} />
          <StageToggle label="Clock" tip={TIP.clock} on={scene.clock} onChange={(on) => setOption("clock", on)} />
          <StageToggle label="Labels" tip={TIP.labels} on={scene.labels} onChange={(on) => setOption("labels", on)} />
          <StageToggle label="Timeline" tip={TIP.timeline} on={scene.timeline} onChange={(on) => setOption("timeline", on)} />
          <StageToggle label="Scale bar" tip={TIP.scale} on={scene.scale} onChange={(on) => setOption("scale", on)} />
          <StageToggle label="Graph" tip={TIP.graph} on={scene.graph} onChange={(on) => setOption("graph", on)} />
        </StagePills>
      </StageSection>
      <StageSection title="Presenting">
        <StagePills>
          <StageToggle label="Pause between chapters" tip={TIP.pauseBetween} on={pauseBetween} onChange={setPauseBetween} />
        </StagePills>
      </StageSection>
      <StageSection title="Export video" defaultOpen={false}>
        <StageSegmented
          ariaLabel="Resolution"
          label="Resolution"
          tip={TIP.resolution}
          value={resolution}
          options={[
            { value: 1080, label: "1080p" },
            { value: 720, label: "720p" }
          ]}
          disabled={exporting.running}
          onChange={setResolution}
        />
        <StageSegmented
          ariaLabel="Frame rate"
          label="Frame rate"
          tip={TIP.fps}
          value={fps}
          options={[
            { value: 30, label: "30 fps" },
            { value: 60, label: "60 fps" }
          ]}
          disabled={exporting.running}
          onChange={setFps}
        />
        <StageSegmented
          ariaLabel="Video speed"
          label="Video speed"
          tip={TIP.videoSpeed}
          value={videoSpeed}
          options={[
            { value: 0.5, label: "½×" },
            { value: 1, label: "1×" }
          ]}
          disabled={exporting.running}
          onChange={setVideoSpeed}
        />
        <StagePills>
          <StageToggle label="Clean video (no captions or labels)" tip={TIP.cleanVideo} on={cleanVideo} onChange={setCleanVideo} />
        </StagePills>
        <StagePills>
          {exporting.running ? (
            <StagePillButton label={`Cancel (${exportProgress}%)`} tip={TIP.cancel} onClick={() => (exportCancel.current = true)} />
          ) : (
            <StagePillButton
              label={mp4 ? "Export MP4" : "Export frames (zip)"}
              tip={mp4 ? TIP.exportBtn : `${TIP.exportBtn} This browser cannot encode MP4, so frames are saved as images in a zip.`}
              onClick={() => void startExport()}
            />
          )}
        </StagePills>
        {exporting.running ? (
          <StageReadout label="Rendering" value={`${exporting.done} / ${exporting.total} frames`} />
        ) : exporting.message ? (
          <StageReadout label="Export" value={exporting.message.short} tip={exporting.message.detail} />
        ) : null}
      </StageSection>
      <StageSection title="What is on screen" defaultOpen={false}>
        <StageReadout label="Time since collapse began" value={`≈ ${formatYears(now.years)}`} />
        <StageReadout label="Core temperature" value={`≈ ${formatTemperature(now.coreTempK)}`} />
        {now.surfaceTempK !== null ? <StageReadout label="Surface temperature" value={`≈ ${formatTemperature(now.surfaceTempK)}`} /> : null}
        {now.massSuns > 0 ? <StageReadout label="Mass gathered" value={`≈ ${formatSuns(now.massSuns)} (${formatAtoms(now.atoms)} atoms)`} /> : null}
        <StageReadout label="Field of view" value={`≈ ${formatLength(now.viewWidthM)}`} />
      </StageSection>
    </>
  );

  const info = (
    <>
      <h4>What you are seeing</h4>
      <ul>
        <li>
          A cinematic sketch of how a massive star forms, from a cold cloud to a blue star clearing its birthplace. The
          clock, temperatures and densities follow the standard picture of star formation; the pictures are illustrations.
        </li>
        <li>
          Key physics: while the collapsing gas is thin, compression heat radiates away and the core stays near 10 K. Once
          the core is opaque (about 10⁻¹³ g/cm³) the heat is trapped and it warms; at ~2,000 K hydrogen molecules split,
          triggering a second collapse into a protostar. Fusion starts near 10⁷ K.
        </li>
        <li>
          While the star piles on mass, the graph (right) counts the atoms it has gathered, up to some 3 × 10⁵⁸ (30 Suns),
          and tracks its core temperature climbing to the 10⁷ K where fusion starts.
        </li>
        <li>
          The inset (bottom right) looks inside the core. Below ~10⁷ K the protons' electric repulsion turns them back;
          hotter, a few get close enough to fuse (by quantum tunnelling).
        </li>
        <li>
          The scale bar gives the size of the main view; the ruler under it runs in powers of ten from a cloud to an atomic
          nucleus, with markers for the main view and the core inset.
        </li>
      </ul>
      <h4>Simplified on purpose</h4>
      <ul>
        <li>
          Nothing is to scale in time: the zoom shows gas falling in wherever you look, while really the collapse runs
          from the inside out over ~10⁵ years. Disk rotation, jets and fusion are animated at watchable speeds.
        </li>
        <li>
          A whole cloud forms a cluster of stars, not one; the film follows a single massive star (~30 M☉). Massive
          stars start fusing while still gathering gas, so their ignition is not a sharp moment.
        </li>
        <li>
          The core inset shows the proton–proton chain. A star this massive mostly fuses hydrogen through the CNO cycle,
          with carbon as a catalyst; the net result is the same: four protons become one helium nucleus. The first step is
          so rare that a given proton waits billions of years; the inset plays one chain in a few seconds. Nuclei are drawn
          about 30,000 times too big.
        </li>
        <li>The steady pile-up is a smooth stand-in for accretion, which really comes in fits and starts.</li>
        <li>
          The bubble colours follow astronomy's usual picture: pink-red from hydrogen at the rim, blue-green from oxygen
          inside. Diffraction spikes are a telescope effect, added for the look.
        </li>
        <li>Bloom, vignette, grain and the slow camera drift are style only.</li>
      </ul>
      <h4>Presenting</h4>
      <ul>
        <li>Space play/pause · → or Page Down next · ← or Page Up back · Home restart.</li>
        <li>C toggles cinematic mode: only time and temperature on screen; click the film to play or pause.</li>
      </ul>
    </>
  );

  return (
    <AppletStage
      logicalWidth={SCENE_W}
      logicalHeight={SCENE_H}
      canvasRef={sceneRef}
      canvasLabel={`Star formation, chapter ${chapterIndex + 1}: ${CHAPTERS[chapterIndex].title}`}
      onCanvasResize={drawNow}
      toolbar={toolbar}
      controls={controls}
      controlsWidth={280}
      controlsDefaultOpen={false}
      info={info}
      canvasProps={cinematic ? { onClick: togglePlay } : undefined}
      cinematic={cinematic ? { label: "Show controls (C)", onExit: () => setCinematicMode(false) } : undefined}
      play={{ visible: !playing && !exporting.running && story < 0.05, label: "Play the film", onClick: togglePlay }}
    />
  );
}
