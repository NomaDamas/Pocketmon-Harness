import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchEmulators,
  fetchRunEvents,
  fetchRuns,
  fetchRunTokens,
  fetchStrategyBook,
} from "./api";
import type {
  AgentViewerEvent,
  ObservationViewerEvent,
  PokemonStateObservation,
  StrategyBook,
  TokenUsageMetric,
  TokenUsageSnapshot,
  TurnTrace,
  ViewerEmulatorSlot,
  ViewerEvent,
  ViewerEventSummary,
  ViewerRun,
} from "./types";

type LoadState = "idle" | "loading" | "ready" | "error";

const POLL_INTERVAL_MS = 1800;

interface DetailState {
  error?: string;
  events: ViewerEvent[];
  loadState: LoadState;
  tokens: TokenUsageMetric[];
}

const emptyDetailState: DetailState = {
  events: [],
  loadState: "idle",
  tokens: [],
};

type ParallelDetailState = Record<string, DetailState>;

export default function App() {
  const [runs, setRuns] = useState<ViewerRun[]>([]);
  const [emulators, setEmulators] = useState<ViewerEmulatorSlot[]>([]);
  const [strategyBook, setStrategyBook] = useState<StrategyBook>();
  const [runsError, setRunsError] = useState<string>();
  const [emulatorsError, setEmulatorsError] = useState<string>();
  const [strategyBookError, setStrategyBookError] = useState<string>();
  const [runsLoadState, setRunsLoadState] = useState<LoadState>("loading");
  const [emulatorsLoadState, setEmulatorsLoadState] =
    useState<LoadState>("loading");
  const [strategyBookLoadState, setStrategyBookLoadState] =
    useState<LoadState>("loading");
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [detail, setDetail] = useState<DetailState>(emptyDetailState);
  const [parallelDetails, setParallelDetails] = useState<ParallelDetailState>(
    {}
  );
  const [liveReloadEnabled, setLiveReloadEnabled] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>();
  const [refreshing, setRefreshing] = useState(false);
  const selectedRunIdRef = useRef<string | undefined>(selectedRunId);
  const liveReloadEnabledRef = useRef(liveReloadEnabled);
  const runsRequestRef = useRef(0);
  const emulatorsRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const livePollControllerRef = useRef<AbortController | undefined>(undefined);
  const manualRefreshControllerRef = useRef<AbortController | undefined>(
    undefined
  );
  const refreshRequestRef = useRef(0);

  useEffect(() => {
    document.title = "mGBA 추적 관제실";
  }, []);

  const abortLivePoll = useCallback(() => {
    livePollControllerRef.current?.abort();
    livePollControllerRef.current = undefined;
  }, []);

  const abortManualRefresh = useCallback(() => {
    manualRefreshControllerRef.current?.abort();
    manualRefreshControllerRef.current = undefined;
  }, []);

  const clearRefreshing = useCallback(() => {
    refreshRequestRef.current += 1;
    setRefreshing(false);
  }, []);

  const loadRuns = useCallback(
    async ({
      requireLive = false,
      signal,
      silent = false,
    }: {
      requireLive?: boolean;
      signal?: AbortSignal;
      silent?: boolean;
    } = {}) => {
      const requestId = runsRequestRef.current + 1;
      runsRequestRef.current = requestId;
      if (!silent) {
        setRunsLoadState("loading");
      }

      try {
        const nextRuns = await fetchRuns(signal);
        if (
          runsRequestRef.current !== requestId ||
          (requireLive && !liveReloadEnabledRef.current)
        ) {
          return;
        }

        const currentRunId = selectedRunIdRef.current;
        let nextSelectedRunId: string | undefined = nextRuns[0]?.runId;
        if (currentRunId) {
          nextSelectedRunId = nextRuns.some((run) => run.runId === currentRunId)
            ? currentRunId
            : undefined;
        }

        selectedRunIdRef.current = nextSelectedRunId;
        setRuns(nextRuns);
        setRunsError(undefined);
        setRunsLoadState("ready");
        setSelectedRunId(nextSelectedRunId);
        if (!nextSelectedRunId) {
          setLastRefreshedAt(Date.now());
        }
      } catch (error: unknown) {
        if (
          isAbortError(error) ||
          runsRequestRef.current !== requestId ||
          (requireLive && !liveReloadEnabledRef.current)
        ) {
          return;
        }
        setRunsError(errorMessage(error));
        setRunsLoadState("error");
      }
    },
    []
  );

  const loadEmulators = useCallback(
    async ({
      requireLive = false,
      signal,
      silent = false,
    }: {
      requireLive?: boolean;
      signal?: AbortSignal;
      silent?: boolean;
    } = {}) => {
      const requestId = emulatorsRequestRef.current + 1;
      emulatorsRequestRef.current = requestId;
      if (!silent) {
        setEmulatorsLoadState("loading");
      }

      try {
        const nextEmulators = await fetchEmulators(signal);
        if (
          emulatorsRequestRef.current !== requestId ||
          (requireLive && !liveReloadEnabledRef.current)
        ) {
          return;
        }
        setEmulators(nextEmulators);
        setEmulatorsError(undefined);
        setEmulatorsLoadState("ready");
      } catch (error: unknown) {
        if (
          isAbortError(error) ||
          emulatorsRequestRef.current !== requestId ||
          (requireLive && !liveReloadEnabledRef.current)
        ) {
          return;
        }
        setEmulatorsError(errorMessage(error));
        setEmulatorsLoadState("error");
      }
    },
    []
  );

  const loadStrategyBook = useCallback(
    async ({
      requireLive = false,
      signal,
      silent = false,
    }: {
      requireLive?: boolean;
      signal?: AbortSignal;
      silent?: boolean;
    } = {}) => {
      if (!silent) {
        setStrategyBookLoadState("loading");
      }

      try {
        const nextStrategyBook = await fetchStrategyBook(signal);
        if (requireLive && !liveReloadEnabledRef.current) {
          return;
        }
        setStrategyBook(nextStrategyBook);
        setStrategyBookError(undefined);
        setStrategyBookLoadState("ready");
      } catch (error: unknown) {
        if (
          isAbortError(error) ||
          (requireLive && !liveReloadEnabledRef.current)
        ) {
          return;
        }
        setStrategyBookError(errorMessage(error));
        setStrategyBookLoadState("error");
      }
    },
    []
  );

  const loadRunDetail = useCallback(
    async (
      runId: string,
      {
        requireLive = false,
        signal,
        silent = false,
      }: {
        requireLive?: boolean;
        signal?: AbortSignal;
        silent?: boolean;
      } = {}
    ) => {
      const requestId = detailRequestRef.current + 1;
      detailRequestRef.current = requestId;
      if (!silent) {
        setDetail({ events: [], loadState: "loading", tokens: [] });
      }

      try {
        const [events, tokens] = await Promise.all([
          fetchRunEvents(runId, signal),
          fetchRunTokens(runId, signal),
        ]);
        if (
          detailRequestRef.current !== requestId ||
          selectedRunIdRef.current !== runId ||
          (requireLive && !liveReloadEnabledRef.current)
        ) {
          return;
        }
        setDetail({ events, loadState: "ready", tokens });
        setLastRefreshedAt(Date.now());
      } catch (error: unknown) {
        if (
          isAbortError(error) ||
          detailRequestRef.current !== requestId ||
          selectedRunIdRef.current !== runId ||
          (requireLive && !liveReloadEnabledRef.current)
        ) {
          return;
        }

        const message = errorMessage(error);
        setDetail((current) =>
          silent
            ? { ...current, error: message, loadState: "error" }
            : {
                events: [],
                error: message,
                loadState: "error",
                tokens: [],
              }
        );
      }
    },
    []
  );

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    liveReloadEnabledRef.current = liveReloadEnabled;
  }, [liveReloadEnabled]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      loadEmulators({ signal: controller.signal }),
      loadRuns({ signal: controller.signal }),
      loadStrategyBook({ signal: controller.signal }),
    ]).catch(() => undefined);
    return () => controller.abort();
  }, [loadEmulators, loadRuns, loadStrategyBook]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
    if (!selectedRunId) {
      setDetail(emptyDetailState);
      return;
    }

    const controller = new AbortController();
    loadRunDetail(selectedRunId, { signal: controller.signal }).catch(
      () => undefined
    );
    return () => controller.abort();
  }, [loadRunDetail, selectedRunId]);

  useEffect(() => {
    if (runs.length === 0) {
      setParallelDetails({});
      return;
    }

    const controller = new AbortController();
    const boardRuns = runs.slice(0, 6);
    Promise.all(
      boardRuns.map(async (run) => {
        const [events, tokens] = await Promise.all([
          fetchRunEvents(run.runId, controller.signal),
          fetchRunTokens(run.runId, controller.signal),
        ]);
        return [run.runId, { events, loadState: "ready", tokens }] as const;
      })
    )
      .then((entries) => {
        setParallelDetails(Object.fromEntries(entries));
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return;
        }
        setParallelDetails(
          Object.fromEntries(
            boardRuns.map((run) => [
              run.runId,
              {
                ...emptyDetailState,
                error: errorMessage(error),
                loadState: "error",
              },
            ])
          )
        );
      });

    return () => controller.abort();
  }, [runs]);

  useEffect(() => {
    if (!liveReloadEnabled) {
      abortLivePoll();
      clearRefreshing();
      return;
    }

    const poll = () => {
      abortLivePoll();
      const currentController = new AbortController();
      livePollControllerRef.current = currentController;
      const refreshId = refreshRequestRef.current + 1;
      refreshRequestRef.current = refreshId;
      const runId = selectedRunIdRef.current;
      setRefreshing(true);
      Promise.all([
        loadEmulators({
          requireLive: true,
          signal: currentController.signal,
          silent: true,
        }),
        loadRuns({
          requireLive: true,
          signal: currentController.signal,
          silent: true,
        }),
        loadStrategyBook({
          requireLive: true,
          signal: currentController.signal,
          silent: true,
        }),
        runId
          ? loadRunDetail(runId, {
              requireLive: true,
              signal: currentController.signal,
              silent: true,
            })
          : Promise.resolve(),
      ])
        .finally(() => {
          if (livePollControllerRef.current === currentController) {
            livePollControllerRef.current = undefined;
          }
          if (
            refreshRequestRef.current === refreshId &&
            !currentController.signal.aborted
          ) {
            setRefreshing(false);
          }
        })
        .catch(() => undefined);
    };

    const intervalId = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
      abortLivePoll();
      clearRefreshing();
    };
  }, [
    abortLivePoll,
    clearRefreshing,
    liveReloadEnabled,
    loadRunDetail,
    loadRuns,
    loadStrategyBook,
    loadEmulators,
  ]);

  const handleSelectRun = useCallback((runId: string) => {
    selectedRunIdRef.current = runId;
    setSelectedRunId(runId);
  }, []);

  const handleToggleLiveReload = useCallback(() => {
    const next = !liveReloadEnabledRef.current;
    liveReloadEnabledRef.current = next;
    setLiveReloadEnabled(next);
    if (!next) {
      abortLivePoll();
      abortManualRefresh();
      clearRefreshing();
    }
  }, [abortLivePoll, abortManualRefresh, clearRefreshing]);

  const handleRefreshNow = useCallback(() => {
    abortManualRefresh();
    const controller = new AbortController();
    manualRefreshControllerRef.current = controller;
    const refreshId = refreshRequestRef.current + 1;
    refreshRequestRef.current = refreshId;
    const runId = selectedRunIdRef.current;
    setRefreshing(true);
    Promise.all([
      loadEmulators({ signal: controller.signal, silent: true }),
      loadRuns({ signal: controller.signal, silent: true }),
      loadStrategyBook({ signal: controller.signal, silent: true }),
      runId
        ? loadRunDetail(runId, { signal: controller.signal, silent: true })
        : Promise.resolve(),
    ])
      .finally(() => {
        if (manualRefreshControllerRef.current === controller) {
          manualRefreshControllerRef.current = undefined;
        }
        if (
          refreshRequestRef.current === refreshId &&
          !controller.signal.aborted
        ) {
          setRefreshing(false);
        }
      })
      .catch(() => undefined);
  }, [
    abortManualRefresh,
    loadEmulators,
    loadRunDetail,
    loadRuns,
    loadStrategyBook,
  ]);

  const selectedRun = runs.find((run) => run.runId === selectedRunId);
  const turns = useMemo(
    () => groupTurns(detail.events, detail.tokens),
    [detail.events, detail.tokens]
  );
  const totalTokenUsage = useMemo(
    () => sumTurnSummaries(detail.tokens),
    [detail.tokens]
  );

  return (
    <main className="app-shell">
      <header className="hero-panel">
        <div>
          <p className="eyebrow">로컬 텔레메트리 업링크</p>
          <h1>mGBA 추적 관제실</h1>
          <p className="hero-copy">
            로컬 포켓몬 실험 실행의 모델 결정, 렌더링된 게임보이 관측, 감독
            개입, 토큰 소모를 점검합니다.
          </p>
        </div>
        <div className="hero-readout" role="status">
          <span className="pulse-dot" />
          <span>{runs.length}개 실행 색인됨</span>
          <strong>
            {selectedRun ? formatRunMode(selectedRun.mode) : "대기 중"}
          </strong>
        </div>
      </header>

      <EmulatorLiveBoard
        emulators={emulators}
        error={emulatorsError}
        loadState={emulatorsLoadState}
      />

      <StrategyBookBoard
        error={strategyBookError}
        loadState={strategyBookLoadState}
        strategyBook={strategyBook}
      />

      <ParallelRunBoard
        details={parallelDetails}
        onSelectRun={handleSelectRun}
        runs={runs.slice(0, 6)}
        selectedRunId={selectedRunId}
      />

      <section className="workspace-grid">
        <aside className="run-rail">
          <div className="panel-heading">
            <p className="eyebrow">추적 보관소</p>
            <h2>실행 목록</h2>
          </div>
          {runsLoadState === "loading" ? <SkeletonRows /> : null}
          {runsError ? (
            <Notice text={runsError} title="실행 API 오프라인" tone="danger" />
          ) : null}
          {runsLoadState === "ready" && runs.length === 0 ? (
            <Notice
              text="뷰어 API는 응답 중이지만 아직 추적 실행 디렉터리가 없습니다."
              title="기록된 실행 없음"
              tone="muted"
            />
          ) : null}
          <div className="run-list">
            {runs.map((run) => (
              <button
                className={`run-card ${run.runId === selectedRunId ? "selected" : ""}`}
                key={run.runId}
                onClick={() => handleSelectRun(run.runId)}
                type="button"
              >
                <span className="run-card-topline">
                  <span>{formatIteration(run.iteration)}</span>
                  <span>{formatRunMode(run.mode)}</span>
                </span>
                <strong>{run.runId}</strong>
                <span className="run-card-meta">
                  {run.experimentId ?? "실험 id 없음"}
                </span>
                <span className="flag-row">
                  <AvailabilityFlag active={run.hasEvents} label="이벤트" />
                  <AvailabilityFlag active={run.hasTokenUsage} label="토큰" />
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section aria-live="polite" className="detail-deck">
          {selectedRun ? (
            <>
              <RunMetadata
                run={selectedRun}
                totalTokenUsage={totalTokenUsage}
              />
              <LiveReloadControls
                lastRefreshedAt={lastRefreshedAt}
                liveReloadEnabled={liveReloadEnabled}
                onRefresh={handleRefreshNow}
                onToggleLiveReload={handleToggleLiveReload}
                refreshing={refreshing}
              />
              {detail.loadState === "loading" ? <TraceLoading /> : null}
              {detail.error ? (
                <Notice
                  text={detail.error}
                  title="추적 로드 실패"
                  tone="danger"
                />
              ) : null}
              {detail.loadState === "ready" && detail.events.length === 0 ? (
                <EmptyEventsState run={selectedRun} tokens={detail.tokens} />
              ) : null}
              {detail.events.length > 0 && turns.length > 0 ? (
                <TurnTimeline turns={turns} />
              ) : null}
            </>
          ) : (
            <Notice
              text="왼쪽 레일에서 실행을 선택하면 뷰어 패널이 활성화됩니다."
              title="추적 선택 대기 중"
              tone="muted"
            />
          )}
        </section>
      </section>
    </main>
  );
}

function RunMetadata({
  run,
  totalTokenUsage,
}: {
  run: ViewerRun;
  totalTokenUsage: TokenUsageSnapshot | undefined;
}) {
  return (
    <section className="metadata-panel">
      <div>
        <p className="eyebrow">선택한 실행</p>
        <h2>{run.runId}</h2>
      </div>
      <dl className="metadata-grid">
        <MetaItem label="반복" value={formatIteration(run.iteration)} />
        <MetaItem label="모드" value={formatRunMode(run.mode)} />
        <MetaItem label="실험" value={run.experimentId ?? "태그 없음"} />
        <MetaItem
          label="마일스톤"
          value={run.milestoneCurrent ?? run.milestone ?? "없음"}
        />
        <MetaItem label="최장 도달" value={run.milestoneFurthest ?? "없음"} />
        <MetaItem label="이벤트" value={run.hasEvents ? "있음" : "없음"} />
        <MetaItem label="토큰" value={run.hasTokenUsage ? "있음" : "없음"} />
        <MetaItem
          label="검증 실패"
          value={`${formatNumber(run.verificationFailuresTotal ?? 0)}회`}
        />
        <MetaItem
          label="반복 차단"
          value={`${formatNumber(run.blockedRepeatedActionsTotal ?? 0)}회`}
        />
        <MetaItem
          label="토큰 소모"
          value={
            totalTokenUsage
              ? `${formatNumber(totalTokenUsage.totalTokens)} 총합`
              : "요약 없음"
          }
        />
      </dl>
    </section>
  );
}

function EmulatorLiveBoard({
  emulators,
  error,
  loadState,
}: {
  emulators: ViewerEmulatorSlot[];
  error: string | undefined;
  loadState: LoadState;
}) {
  return (
    <section aria-label="실시간 에뮬레이터 보드" className="emulator-board">
      <div className="panel-heading">
        <p className="eyebrow">실시간 병렬 에뮬레이터</p>
        <h2>눈으로 보는 mGBA 슬롯</h2>
      </div>
      {loadState === "loading" ? <TraceLoading /> : null}
      {error ? (
        <Notice text={error} title="에뮬레이터 API 오프라인" tone="danger" />
      ) : null}
      <div className="emulator-grid">
        {emulators.map((emulator) => (
          <article
            className={`emulator-card ${emulator.reachable ? "online" : "offline"}`}
            key={emulator.baseUrl}
          >
            <header className="emulator-card-header">
              <div>
                <p className="eyebrow">slot {emulator.index + 1}</p>
                <h3>{emulator.baseUrl}</h3>
              </div>
              <span className="emulator-status">
                {emulator.reachable ? "online" : "offline"}
              </span>
            </header>
            <div className="emulator-screen-frame">
              {emulator.screenshot ? (
                <img
                  alt={`${emulator.baseUrl} live emulator screen`}
                  className="emulator-screen"
                  height={224}
                  src={`data:${emulator.screenshot.mediaType};base64,${emulator.screenshot.data}`}
                  width={256}
                />
              ) : (
                <div className="emulator-screen-placeholder">
                  Lua script / bridge 대기
                </div>
              )}
            </div>
            <dl className="parallel-card-grid">
              <MetaItem
                label="프레임"
                value={formatNullableNumber(emulator.frame)}
              />
              <MetaItem
                label="타이틀"
                value={emulator.gameTitle || "연결 안 됨"}
              />
              <MetaItem
                label="코드"
                value={emulator.gameCode || "알 수 없음"}
              />
              <MetaItem
                label="상태"
                value={
                  emulator.reachable
                    ? "조작 가능"
                    : emulator.error || "bridge 대기"
                }
              />
            </dl>
          </article>
        ))}
      </div>
      <p className="board-footnote">
        실제 병렬 최적화는 각 카드가 별도 mGBA + Lua socket + mGBA-http 포트에
        연결될 때 활성화됩니다.
      </p>
    </section>
  );
}

function StrategyBookBoard({
  error,
  loadState,
  strategyBook,
}: {
  error: string | undefined;
  loadState: LoadState;
  strategyBook: StrategyBook | undefined;
}) {
  const promotedCount =
    strategyBook?.strategies.filter((strategy) => strategy.promoted).length ??
    0;
  return (
    <section aria-label="자가개선 전략집" className="strategy-board">
      <div className="panel-heading">
        <p className="eyebrow">자가개선 전략집</p>
        <h2>증거로 승격된 공략 패치</h2>
      </div>
      {loadState === "loading" ? <TraceLoading /> : null}
      {error ? (
        <Notice text={error} title="전략집 API 오프라인" tone="danger" />
      ) : null}
      {strategyBook?.error ? (
        <Notice
          text={strategyBook.error}
          title="전략집 파싱 실패"
          tone="danger"
        />
      ) : null}
      <div className="strategy-summary">
        <MetaItem label="승격 전략" value={formatNumber(promotedCount)} />
        <MetaItem
          label="전체 후보"
          value={formatNumber(strategyBook?.strategies.length ?? 0)}
        />
        <MetaItem
          label="임계값"
          value={
            strategyBook?.promotionThreshold === null ||
            strategyBook?.promotionThreshold === undefined
              ? "없음"
              : formatNumber(strategyBook.promotionThreshold)
          }
        />
        <MetaItem
          label="갱신"
          value={
            strategyBook?.generatedAt
              ? new Date(strategyBook.generatedAt).toLocaleTimeString()
              : "대기"
          }
        />
      </div>
      <div className="strategy-list">
        {(strategyBook?.strategies ?? []).slice(0, 4).map((strategy) => (
          <article className="strategy-card" key={strategy.action}>
            <header className="strategy-card-header">
              <strong>{strategy.action}</strong>
              <span
                className={`strategy-status ${strategy.promoted ? "promoted" : "candidate"}`}
              >
                {strategy.promoted ? "promoted" : "candidate"}
              </span>
            </header>
            <p>{strategy.recommendation}</p>
            <dl className="parallel-card-grid">
              <MetaItem
                label="증거"
                value={formatNumber(strategy.evidenceCount)}
              />
              <MetaItem
                label="실행"
                value={formatNumber(strategy.sourceRuns.length)}
              />
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function ParallelRunBoard({
  details,
  onSelectRun,
  runs,
  selectedRunId,
}: {
  details: ParallelDetailState;
  onSelectRun: (runId: string) => void;
  runs: ViewerRun[];
  selectedRunId: string | undefined;
}) {
  return (
    <section aria-label="병렬 실행 관측 보드" className="parallel-board">
      <div className="panel-heading">
        <p className="eyebrow">병렬 하네스 보드</p>
        <h2>여러 시도 동시 관측</h2>
      </div>
      {runs.length === 0 ? (
        <Notice
          text="실행 기록이 생기면 최신 6개 run을 같은 보드에서 폴링합니다."
          title="병렬 카드 대기 중"
          tone="muted"
        />
      ) : (
        <div className="parallel-grid">
          {runs.map((run) => (
            <ParallelRunCard
              detail={details[run.runId]}
              key={run.runId}
              onSelectRun={onSelectRun}
              run={run}
              selected={run.runId === selectedRunId}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ParallelRunCard({
  detail,
  onSelectRun,
  run,
  selected,
}: {
  detail: DetailState | undefined;
  onSelectRun: (runId: string) => void;
  run: ViewerRun;
  selected: boolean;
}) {
  const observation = latestObservation(detail?.events ?? []);
  const action = latestAction(detail?.events ?? []);
  const totalTokenUsage =
    detail?.tokens.length === 0
      ? run.totalTokens
      : sumTurnSummaries(detail?.tokens ?? []);
  return (
    <button
      className={`parallel-card ${selected ? "selected" : ""}`}
      onClick={() => onSelectRun(run.runId)}
      type="button"
    >
      <span className="run-card-topline">
        <span>{run.experimentId ?? formatIteration(run.iteration)}</span>
        <span>{formatRunMode(run.mode)}</span>
      </span>
      <strong>{run.runId}</strong>
      <dl className="parallel-card-grid">
        <MetaItem
          label="맵/위치"
          value={
            observation?.pokemonState
              ? `map=${formatNullableNumber(observation.pokemonState.mapId)} x=${formatNullableNumber(observation.pokemonState.position.x)} y=${formatNullableNumber(observation.pokemonState.position.y)}`
              : "관측 없음"
          }
        />
        <MetaItem
          label="프레임"
          value={
            observation
              ? formatNullableNumber(observation.status.frame)
              : "알 수 없음"
          }
        />
        <MetaItem
          label="최근 액션"
          value={action?.toolName ?? action?.text ?? "없음"}
        />
        <MetaItem
          label="토큰"
          value={
            totalTokenUsage
              ? formatNumber(totalTokenUsage.totalTokens)
              : "요약 없음"
          }
        />
        <MetaItem
          label="반복 차단"
          value={`${formatNumber(run.blockedRepeatedActionsTotal ?? 0)}회`}
        />
        <MetaItem
          label="검증 실패"
          value={`${formatNumber(run.verificationFailuresTotal ?? 0)}회`}
        />
        <MetaItem
          label="막힘 이벤트"
          value={`${formatNumber(run.stuckEvents ?? 0)}회`}
        />
        <MetaItem
          label="상태"
          value={detail?.error ?? formatParallelLoadState(detail?.loadState)}
        />
      </dl>
    </button>
  );
}

function latestObservation(
  events: ViewerEvent[]
): ObservationViewerEvent | undefined {
  return [...events]
    .reverse()
    .find(
      (event): event is ObservationViewerEvent => event.type === "observation"
    );
}

function latestAction(events: ViewerEvent[]): ViewerEventSummary | undefined {
  return [...events]
    .reverse()
    .find(
      (event): event is AgentViewerEvent =>
        event.type === "agent-event" &&
        event.summary?.kind === "action_tool_call"
    )?.summary;
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LiveReloadControls({
  lastRefreshedAt,
  liveReloadEnabled,
  onRefresh,
  onToggleLiveReload,
  refreshing,
}: {
  lastRefreshedAt: number | undefined;
  liveReloadEnabled: boolean;
  onRefresh: () => void;
  onToggleLiveReload: () => void;
  refreshing: boolean;
}) {
  return (
    <section aria-label="추적 새로고침 제어" className="live-controls">
      <div className="control-cluster">
        <button
          className={`control-button ${liveReloadEnabled ? "active" : ""}`}
          onClick={onToggleLiveReload}
          type="button"
        >
          {liveReloadEnabled
            ? "실시간 새로고침 일시정지"
            : "실시간 새로고침 재개"}
        </button>
        <button
          className="control-button"
          disabled={refreshing}
          onClick={onRefresh}
          type="button"
        >
          지금 새로고침
        </button>
      </div>
      <div className="control-readout" role="status">
        <span>{refreshing ? "새로고침 중" : "대기"}</span>
        <strong>마지막 새로고침 {formatLastRefreshed(lastRefreshedAt)}</strong>
      </div>
      <span className="order-pill">최신 턴 먼저</span>
    </section>
  );
}

function TurnTimeline({ turns }: { turns: TurnTrace[] }) {
  return (
    <div className="turn-stack">
      {turns.map((turn) => (
        <article className="turn-panel" key={turn.turn}>
          <header className="turn-header">
            <div>
              <p className="eyebrow">턴 {turn.turn}</p>
              <h3>{turn.observation ? "관측 연결됨" : "에이전트 전용 턴"}</h3>
            </div>
            <TokenBadge turn={turn} />
          </header>
          <div className="turn-grid">
            <ObservationPanel observation={turn.observation} />
            <DecisionPanel turn={turn} />
          </div>
        </article>
      ))}
    </div>
  );
}

function ObservationPanel({
  observation,
}: {
  observation: ObservationViewerEvent | undefined;
}) {
  if (!observation) {
    return (
      <section className="screen-panel empty-screen">
        <p className="eyebrow">비디오 버스</p>
        <h4>관측 프레임 없음</h4>
        <p>이 턴에는 스크린샷 앵커 없이 에이전트 이벤트만 기록되었습니다.</p>
      </section>
    );
  }

  const { status } = observation;
  const pokemonState = observation.pokemonState;

  return (
    <section className="screen-panel">
      <div className="screen-bezel">
        <img
          alt={`${observation.turn}턴 게임보이 스크린샷`}
          className="game-screen"
          height={144}
          src={`data:${observation.screenshot.mediaType};base64,${observation.screenshot.data}`}
          width={160}
        />
      </div>
      <dl className="telemetry-grid">
        <MetaItem label="프레임" value={formatNullableNumber(status.frame)} />
        <MetaItem label="타이틀" value={status.gameTitle || "알 수 없음"} />
        <MetaItem label="코드" value={status.gameCode || "알 수 없음"} />
        <MetaItem
          label="버튼"
          value={
            status.activeButtons.length > 0
              ? status.activeButtons.join(" + ")
              : "활성 없음"
          }
        />
      </dl>
      {pokemonState ? <PokemonStatePanel state={pokemonState} /> : null}
    </section>
  );
}

function PokemonStatePanel({ state }: { state: PokemonStateObservation }) {
  return (
    <div className="pokemon-state">
      <p className="eyebrow">포켓몬 RAM 상태</p>
      <dl>
        <MetaItem label="읽기" value={formatReadStatus(state.readStatus)} />
        <MetaItem label="맵" value={formatNullableNumber(state.mapId)} />
        <MetaItem
          label="위치"
          value={`x=${formatNullableNumber(state.position.x)} y=${formatNullableNumber(state.position.y)}`}
        />
        <MetaItem label="방향" value={formatDirection(state.direction)} />
        <MetaItem label="배틀" value={state.battle ? "예" : "아니요"} />
        <MetaItem
          label="배틀 유형"
          value={formatNullableNumber(state.battleType)}
        />
        <MetaItem label="대화" value={formatSignal(state.dialogueLike)} />
        <MetaItem label="메뉴" value={formatSignal(state.menuLike)} />
      </dl>
    </div>
  );
}

function DecisionPanel({ turn }: { turn: TurnTrace }) {
  return (
    <section className="decision-panel">
      <div className="action-plan-bank">
        <p className="eyebrow">행동 계획</p>
        {turn.actionPlans.length > 0 ? (
          turn.actionPlans.map((summary) => (
            <blockquote key={summaryKey(turn.turn, summary)}>
              {summary.text}
            </blockquote>
          ))
        ) : (
          <p className="empty-copy">요약된 action_plan 블록이 없습니다.</p>
        )}
      </div>

      {turn.supervisorInterventions.length > 0 ? (
        <EventGroup title="감독 개입" tone="warning">
          {turn.supervisorInterventions.map((summary) => (
            <SummaryCard
              key={summaryKey(turn.turn, summary)}
              summary={summary}
            />
          ))}
        </EventGroup>
      ) : null}

      <EventGroup title="행동 도구 호출" tone="green">
        {turn.toolCalls.length > 0 ? (
          turn.toolCalls.map((summary) => (
            <SummaryCard
              key={summaryKey(turn.turn, summary)}
              summary={summary}
            />
          ))
        ) : (
          <p className="empty-copy">이 턴에는 제어 도구 호출이 없습니다.</p>
        )}
      </EventGroup>

      <EventGroup title="행동 도구 결과" tone="amber">
        {turn.toolResults.length > 0 ? (
          turn.toolResults.map((summary) => (
            <SummaryCard
              key={summaryKey(turn.turn, summary)}
              summary={summary}
            />
          ))
        ) : (
          <p className="empty-copy">기록된 제어 도구 결과가 없습니다.</p>
        )}
      </EventGroup>

      <TokenPanel turn={turn} />
    </section>
  );
}

function summaryKey(turn: number, summary: ViewerEventSummary): string {
  const stablePart =
    summary.toolCallId ?? summary.text ?? summary.toolName ?? summary.kind;
  return `${turn}-${summary.kind}-${stablePart}`;
}

function EventGroup({
  children,
  title,
  tone,
}: {
  children: ReactNode;
  title: string;
  tone: "amber" | "green" | "warning";
}) {
  return (
    <div className={`event-group ${tone}`}>
      <h4>{title}</h4>
      {children}
    </div>
  );
}

function SummaryCard({ summary }: { summary: ViewerEventSummary }) {
  return (
    <div className="summary-card">
      <div className="summary-title">
        <strong>{summary.toolName ?? formatSummaryKind(summary.kind)}</strong>
        {summary.toolCallId ? <span>{summary.toolCallId}</span> : null}
      </div>
      {summary.text ? <p>{summary.text}</p> : null}
      {summary.input === undefined ? null : (
        <JsonBlock label="입력" value={summary.input} />
      )}
      {summary.output === undefined ? null : (
        <JsonBlock label="출력" value={summary.output} />
      )}
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="json-block">
      <span>{label}</span>
      <pre>{formatJson(value)}</pre>
    </div>
  );
}

function TokenPanel({ turn }: { turn: TurnTrace }) {
  if (!turn.tokenSummary && turn.tokenSteps.length === 0) {
    return (
      <div className="token-panel muted-token">
        <h4>토큰 텔레메트리</h4>
        <p>이 턴에는 토큰 지표가 기록되지 않았습니다.</p>
      </div>
    );
  }

  const summary = turn.tokenSummary;
  return (
    <div className="token-panel">
      <h4>토큰 텔레메트리</h4>
      {summary ? (
        <dl className="token-grid">
          <MetaItem label="단계" value={formatNumber(summary.steps)} />
          <MetaItem
            label="총합"
            value={formatNumber(summary.usage.totalTokens)}
          />
          <MetaItem
            label="입력"
            value={formatNumber(summary.usage.inputTokens)}
          />
          <MetaItem
            label="출력"
            value={formatNumber(summary.usage.outputTokens)}
          />
          <MetaItem
            label="추론"
            value={formatNumber(summary.usage.reasoningTokens)}
          />
          <MetaItem
            label="캐시 읽기"
            value={formatNumber(summary.usage.cacheReadTokens)}
          />
        </dl>
      ) : null}
      {turn.tokenSteps.length > 0 ? (
        <div className="step-strip">
          {turn.tokenSteps.map((step) => (
            <span key={`${step.turn}-${step.step}`}>
              단계 {step.step}: {formatNumber(step.usage.totalTokens)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TokenBadge({ turn }: { turn: TurnTrace }) {
  const total = turn.tokenSummary?.usage.totalTokens;
  return (
    <div className="token-badge">
      <span>{turn.tokenSummary?.steps ?? turn.tokenSteps.length}단계</span>
      <strong>
        {total === undefined ? "토큰 없음" : `${formatNumber(total)} 토큰`}
      </strong>
    </div>
  );
}

function EmptyEventsState({
  run,
  tokens,
}: {
  run: ViewerRun;
  tokens: TokenUsageMetric[];
}) {
  return (
    <section className="empty-events">
      <p className="eyebrow">레거시 추적 감지됨</p>
      <h3>이 실행에는 뷰어 이벤트가 없습니다</h3>
      <p>
        이 실행에는 <code>events.jsonl</code>이 없어 이전 토큰 전용 추적은
        스크린샷을 표시할 수 없습니다. 스크린샷 이벤트를 기록하려면 이 뷰어 구현
        이후 새 harness 실행을 시작하세요.
      </p>
      <div className="legacy-meter">
        <AvailabilityFlag active={run.hasTokenUsage} label="토큰 파일" />
        <span>{tokens.length}개 토큰 기록 로드됨</span>
      </div>
    </section>
  );
}

function AvailabilityFlag({
  active,
  label,
}: {
  active: boolean;
  label: string;
}) {
  return (
    <span className={`availability ${active ? "active" : "inactive"}`}>
      {label}
    </span>
  );
}

function Notice({
  text,
  title,
  tone,
}: {
  text: string;
  title: string;
  tone: "danger" | "muted";
}) {
  return (
    <div className={`notice ${tone}`}>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="skeleton-stack" role="status">
      <span />
      <span />
      <span />
    </div>
  );
}

function TraceLoading() {
  return (
    <div className="trace-loading">
      <span className="pulse-dot" />
      추적 페이로드 로드 중...
    </div>
  );
}

function groupTurns(
  events: ViewerEvent[],
  tokens: TokenUsageMetric[]
): TurnTrace[] {
  const turns = new Map<number, TurnTrace>();

  for (const event of events) {
    const turnNumber = event.turn ?? -1;
    const turn = ensureTurn(turns, turnNumber);
    if (event.type === "observation") {
      turn.observation = event;
      continue;
    }
    turn.agentEvents.push(event);
    addSummaryToTurn(turn, event.summary);
  }

  for (const metric of tokens) {
    const turn = ensureTurn(turns, metric.turn);
    if (metric.type === "turn-summary") {
      turn.tokenSummary = metric;
    } else {
      turn.tokenSteps.push(metric);
    }
  }

  return [...turns.values()].sort((left, right) => right.turn - left.turn);
}

function ensureTurn(
  turns: Map<number, TurnTrace>,
  turnNumber: number
): TurnTrace {
  const existing = turns.get(turnNumber);
  if (existing) {
    return existing;
  }
  const next: TurnTrace = {
    actionPlans: [],
    agentEvents: [],
    supervisorInterventions: [],
    tokenSteps: [],
    toolCalls: [],
    toolResults: [],
    turn: turnNumber,
  };
  turns.set(turnNumber, next);
  return next;
}

function addSummaryToTurn(
  turn: TurnTrace,
  summary: ViewerEventSummary | undefined
) {
  if (!summary) {
    return;
  }
  if (summary.kind === "action_plan") {
    turn.actionPlans.push(summary);
    return;
  }
  if (summary.kind === "action_tool_call") {
    turn.toolCalls.push(summary);
    return;
  }
  if (summary.kind === "action_tool_result") {
    turn.toolResults.push(summary);
    return;
  }
  if (summary.kind === "supervisor_intervention") {
    turn.supervisorInterventions.push(summary);
  }
}

function sumTurnSummaries(
  tokens: TokenUsageMetric[]
): TokenUsageSnapshot | undefined {
  const summaries = tokens.filter((metric) => metric.type === "turn-summary");
  if (summaries.length === 0) {
    return;
  }
  return summaries.reduce<TokenUsageSnapshot>(
    (total, metric) => ({
      cacheReadTokens: total.cacheReadTokens + metric.usage.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + metric.usage.cacheWriteTokens,
      inputTokens: total.inputTokens + metric.usage.inputTokens,
      noCacheTokens: total.noCacheTokens + metric.usage.noCacheTokens,
      outputTokens: total.outputTokens + metric.usage.outputTokens,
      reasoningTokens: total.reasoningTokens + metric.usage.reasoningTokens,
      textTokens: total.textTokens + metric.usage.textTokens,
      totalTokens: total.totalTokens + metric.usage.totalTokens,
    }),
    {
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputTokens: 0,
      noCacheTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      textTokens: 0,
      totalTokens: 0,
    }
  );
}

function formatIteration(iteration: number | undefined): string {
  return iteration === undefined ? "반복 ?" : `반복 ${iteration}`;
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "알 수 없음" : formatNumber(value);
}

function formatBoolean(value: boolean): string {
  return value ? "예" : "아니요";
}

function formatSignal(value: boolean | "visual-fallback"): string {
  return value === "visual-fallback" ? "시각 추정" : formatBoolean(value);
}

function formatReadStatus(value: string): string {
  if (value === "available") {
    return "가능";
  }
  if (value === "unavailable") {
    return "불가";
  }
  return value;
}

function formatDirection(value: string): string {
  switch (value) {
    case "down":
      return "아래";
    case "up":
      return "위";
    case "left":
      return "왼쪽";
    case "right":
      return "오른쪽";
    case "unknown":
      return "알 수 없음";
    default:
      return value;
  }
}

function formatRunMode(value: string | undefined): string {
  switch (value) {
    case "fresh":
      return "신규";
    case "resumed":
      return "재개";
    case "recovery":
      return "복구";
    case "deterministic-replay":
      return "결정적 재생";
    case "exploratory":
      return "탐색";
    case undefined:
      return "알 수 없음";
    default:
      return value;
  }
}

function formatParallelLoadState(value: LoadState | undefined): string {
  switch (value) {
    case "error":
      return "오류";
    case "loading":
      return "로딩";
    case "ready":
      return "폴링 중";
    case "idle":
    case undefined:
      return "대기";
    default:
      return value;
  }
}

function formatSummaryKind(value: string): string {
  switch (value) {
    case "action_plan":
      return "행동 계획";
    case "action_tool_call":
      return "행동 도구 호출";
    case "action_tool_result":
      return "행동 도구 결과";
    case "supervisor_intervention":
      return "감독 개입";
    case "assistant_text":
      return "어시스턴트 텍스트";
    case "assistant_reasoning":
      return "어시스턴트 추론";
    case "lifecycle":
      return "수명 주기";
    case "other":
      return "기타";
    default:
      return value;
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatLastRefreshed(value: number | undefined): string {
  if (value === undefined) {
    return "없음";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

function formatJson(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
