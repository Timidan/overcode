import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowsClockwise,
  Database,
  Eraser,
  Gauge,
  ShieldCheck,
  Sparkle,
} from "@phosphor-icons/react";
import { AIProviderLogo } from "../components/AIProviderLogo";
import { Sidebar } from "../components/Sidebar";
import {
  COGNEE_MEMORY_LEDGER_CHANGED_EVENT,
  loadCogneeMemoryLedger,
  type CogneeMemoryLedgerEvent,
  type CogneeMemoryLedgerSnapshot,
} from "../lib/cognee-memory-ledger";
import { ipc, type MemoryStatus, type MemoryUsageResult } from "../lib/ipc";
import {
  describeCogneeStatusPill,
  formatBytes,
  formatCloudStorage,
  formatCogneeEventDataLabel,
  formatEventCount,
  formatNumber,
  formatRecordCount,
} from "./cognee-dashboard-format";
import "./CogneeDashboard.css";

const DEFAULT_DATASET = "overcode_memory";

export function CogneeDashboard() {
  const [ledger, setLedger] = useState<CogneeMemoryLedgerSnapshot>(() =>
    loadCogneeMemoryLedger(),
  );
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [usage, setUsage] = useState<MemoryUsageResult | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [improving, setImproving] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [confirmingForget, setConfirmingForget] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  const primaryDataset = useMemo(
    () => ledger.breakdownByDataset[0]?.datasetName ?? DEFAULT_DATASET,
    [ledger.breakdownByDataset],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setLedger(await ipc.hydrateMemoryLedger());
    try {
      setStatus(await ipc.getMemoryStatus());
      setStatusError(null);
    } catch (error) {
      setStatus(null);
      setStatusError(error instanceof Error ? error.message : "Could not read Cognee status.");
    } finally {
      setRefreshing(false);
    }
    try {
      const usageResult = await ipc.getMemoryUsage();
      setUsage(usageResult.ok ? usageResult : null);
    } catch {
      setUsage(null);
    } finally {
      // Both live reads have settled; only now may the strip claim real values.
      setStatusLoading(false);
      setConfirmingForget(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    function onLedgerChanged() {
      setLedger(loadCogneeMemoryLedger());
    }

    window.addEventListener(COGNEE_MEMORY_LEDGER_CHANGED_EVENT, onLedgerChanged);
    return () => {
      window.removeEventListener(COGNEE_MEMORY_LEDGER_CHANGED_EVENT, onLedgerChanged);
    };
  }, [refresh]);

  async function improveDataset() {
    setImproving(true);
    setMessage(null);
    try {
      const result = await ipc.improveMemory({
        datasetName: primaryDataset,
        feedback: "Dashboard-triggered improvement pass for Overcode memory.",
        accepted: true,
      });
      setMessage(
        result.ok
          ? { text: "Cognee improve request accepted.", tone: "ok" }
          : {
              text: result.reason ?? result.error ?? "Cognee improve request did not complete.",
              tone: "error",
            },
      );
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Cognee improve request failed.",
        tone: "error",
      });
    } finally {
      setImproving(false);
      await refresh();
    }
  }

  async function forgetDataset() {
    setConfirmingForget(false);
    setForgetting(true);
    setMessage(null);
    try {
      const result = await ipc.forgetMemory({ datasetName: primaryDataset });
      setMessage(
        result.ok
          ? { text: "Cognee forget request completed.", tone: "ok" }
          : {
              text: result.reason ?? result.error ?? "Cognee forget request did not complete.",
              tone: "error",
            },
      );
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Cognee forget request failed.",
        tone: "error",
      });
    } finally {
      setForgetting(false);
      await refresh();
    }
  }

  async function clearLocalTelemetry() {
    setLedger(await ipc.clearMemoryLedger());
    setMessage({ text: "Local Cognee dashboard telemetry cleared.", tone: "ok" });
  }

  const summary = ledger.summary;
  const lastEvent = summary.lastEvent;

  return (
    <div className="cognee-dashboard-container">
      <Sidebar />

      <main className="cognee-dashboard-main">
        <header className="cognee-dashboard-header">
          <div className="cognee-dashboard-titleblock">
            <div className="cognee-dashboard-mark">
              <AIProviderLogo providerId="cognee" size="lg" />
              <span>powered by Cognee</span>
            </div>
            <h1 className="cognee-dashboard-title">Cognee memory</h1>
          </div>

          <div className="cognee-dashboard-actions">
            <StatusPill status={status} error={statusError} loading={statusLoading} />
            <button
              type="button"
              className="cognee-dashboard-button"
              onClick={() => void refresh()}
              disabled={refreshing}
              title="Refresh Cognee status and local memory telemetry"
            >
              <ArrowsClockwise
                size={13}
                weight="bold"
                className={refreshing ? "motion-spin" : ""}
              />
              {refreshing ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </header>

        {statusError && (
          <div className="cognee-dashboard-status-error" role="alert">
            {statusError}
          </div>
        )}
        {!statusError && status && !status.endpointVerified && status.reason && (
          <div className="cognee-dashboard-status-error" role="alert">
            {status.reason}
          </div>
        )}

        <section className="cognee-status-strip" aria-label="Cognee current status">
          <StatusDatum
            label="Endpoint"
            value={statusLoading ? "…" : status?.endpoint ?? "Not configured"}
          />
          <StatusDatum
            label="Auth"
            value={statusLoading ? "…" : status?.auth === "api-key" ? "API key" : "None"}
            tone={status?.auth === "api-key" ? "good" : "muted"}
          />
          <StatusDatum label="Dataset" value={primaryDataset} />
          <StatusDatum
            label="Cloud storage"
            value={statusLoading ? "…" : formatCloudStorage(usage)}
            tone={usage ? "good" : "muted"}
          />
          <StatusDatum
            label="Last local event"
            value={lastEvent ? relativeTime(lastEvent.startedAt) : "No events"}
          />
        </section>

        <div className="cognee-telemetry-note" role="note">
          <span className="section-label">Local telemetry</span>
          <span>
            Metrics and events below are recorded on this device by Overcode. The status
            pill and endpoint details come from the live Cognee server.
          </span>
        </div>

        <section className="cognee-metric-grid" aria-label="Cognee memory metrics">
          <MetricTile
            icon={<Database size={16} weight="bold" />}
            label="Records remembered"
            value={formatNumber(summary.ingestedRecords)}
            detail={`across ${formatNumber(ledger.breakdownBySource.length)} source${
              ledger.breakdownBySource.length === 1 ? "" : "s"
            }`}
          />
          <MetricTile
            icon={<Gauge size={16} weight="bold" />}
            label="Data ingested"
            value={formatBytes(summary.sanitizedBytesIngested)}
            detail={`~${formatNumber(summary.estimatedTokensIngested)} tokens estimated`}
          />
          <MetricTile
            icon={<Sparkle size={16} weight="bold" />}
            label="Recall hit rate"
            value={summary.recallQueries === 0 ? "—" : `${summary.recallHitRate}%`}
            detail={
              summary.recallQueries === 0
                ? "no recalls yet"
                : `${formatNumber(summary.recallHits)} / ${formatNumber(summary.recallQueries)} recalls`
            }
          />
        </section>

        <section className="cognee-dashboard-grid">
          <div className="cognee-panel cognee-panel-pipeline">
            <div className="cognee-panel-header">
              <span className="section-label">Memory pipeline</span>
              <span className="cognee-panel-meta">{formatEventCount(summary.totalEvents)}</span>
              <div className="cognee-panel-actions">
                <button
                  type="button"
                  className="cognee-dashboard-button"
                  onClick={() => void improveDataset()}
                  disabled={improving || forgetting || confirmingForget}
                  title={`Ask Cognee to refine the ${primaryDataset} dataset`}
                >
                  {improving ? "Improving" : "Improve memory"}
                </button>
                {confirmingForget ? (
                  <>
                    <button
                      type="button"
                      className="cognee-dashboard-button is-danger"
                      onClick={() => void forgetDataset()}
                      disabled={forgetting || improving}
                      title={`Permanently clear the ${primaryDataset} dataset on the Cognee server`}
                    >
                      Confirm forget
                    </button>
                    <button
                      type="button"
                      className="cognee-dashboard-button is-muted"
                      onClick={() => setConfirmingForget(false)}
                      disabled={forgetting}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="cognee-dashboard-button is-danger"
                    onClick={() => setConfirmingForget(true)}
                    disabled={improving || forgetting}
                    title={`Clear the ${primaryDataset} dataset (asks to confirm)`}
                  >
                    <Eraser size={13} weight="bold" />
                    {forgetting ? "Forgetting" : "Forget dataset"}
                  </button>
                )}
              </div>
            </div>
            <div className="cognee-pipeline">
              <PipelineStep label="Remember" value={summary.remembered} />
              <PipelineStep label="Recall" value={summary.recalled} />
              <PipelineStep label="Improve" value={summary.improved} />
              <PipelineStep label="Forget" value={summary.forgotten} />
              <PipelineStep label="Skipped" value={summary.skipped} tone="muted" />
              <PipelineStep label="Failed" value={summary.failed} tone="danger" />
            </div>
          </div>

          <div className="cognee-panel">
            <div className="cognee-panel-header">
              <span className="section-label">Source breakdown</span>
              <span className="cognee-panel-meta">accepted remembers</span>
            </div>
            <BreakdownList
              emptyLabel="No ingested records yet"
              rows={ledger.breakdownBySource.map((entry) => ({
                label: entry.source,
                value: formatRecordCount(entry.records),
                meta: `${formatBytes(entry.bytes)} across ${formatEventCount(entry.events)}`,
              }))}
            />
          </div>

          {ledger.breakdownByDataset.length > 1 ? (
            <div className="cognee-panel">
              <div className="cognee-panel-header">
                <span className="section-label">Dataset volume</span>
                <span className="cognee-panel-meta">local ledger view</span>
              </div>
              <BreakdownList
                emptyLabel="No dataset activity yet"
                rows={ledger.breakdownByDataset.map((entry) => ({
                  label: entry.datasetName,
                  value: formatRecordCount(entry.records),
                  meta: `${formatBytes(entry.bytes)} across ${formatEventCount(entry.events)}`,
                }))}
              />
            </div>
          ) : (
            <div className="cognee-panel">
              <div className="cognee-panel-header">
                <span className="section-label">What memory holds</span>
                <span className="cognee-panel-meta">latest remembered titles</span>
              </div>
              <BreakdownList
                emptyLabel="Nothing remembered yet"
                rows={rememberedTitles(ledger).map((entry) => ({
                  label: entry.title,
                  value: entry.repo ?? "",
                  meta: relativeTime(entry.startedAt),
                }))}
              />
            </div>
          )}

          <div className="cognee-panel cognee-panel-safety">
            <div className="cognee-panel-header">
              <span className="section-label">Safety boundary</span>
              <ShieldCheck size={14} weight="bold" />
            </div>
            <ul className="cognee-safety-list">
              <li>Raw source and full diffs stay outside dashboard ingestion counts.</li>
              <li>Provider keys and secrets are excluded before memory events are recorded.</li>
              <li>Skipped and failed calls stay visible in the ledger.</li>
            </ul>
          </div>
        </section>

        <section className="cognee-events-section">
          <div className="cognee-events-header">
            <div>
              <span className="section-label">Recent Cognee events</span>
              {message && (
                <div
                  className={`cognee-dashboard-message${message.tone === "error" ? " is-error" : ""}`}
                  role="status"
                >
                  {message.text}
                </div>
              )}
            </div>
            <div className="cognee-event-actions">
              <button
                type="button"
                className="cognee-dashboard-button is-muted"
                onClick={() => void clearLocalTelemetry()}
                title="Clear local dashboard event telemetry"
              >
                Clear local telemetry
              </button>
            </div>
          </div>

          {ledger.events.length === 0 ? (
            <div className="cognee-empty">
              <div className="cognee-empty-title">No Cognee memory events yet</div>
              <div className="cognee-empty-hint">
                Run impact analysis, worktree compare, or Cognee recall to populate this view.
              </div>
            </div>
          ) : (
            <div className="cognee-events-table" role="table" aria-label="Recent Cognee events">
              <div className="cognee-events-row is-heading" role="row">
                <span role="columnheader">Time</span>
                <span role="columnheader">Operation</span>
                <span role="columnheader">Source</span>
                <span role="columnheader">Scope</span>
                <span role="columnheader">Data</span>
                <span role="columnheader">Status</span>
              </div>
              {ledger.events.slice(0, 40).map((event) => (
                <CogneeEventRow key={event.id} event={event} />
              ))}
            </div>
          )}
          {ledger.events.length > 40 && (
            <div className="cognee-events-footer">
              Showing latest 40 of {formatEventCount(summary.totalEvents)}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function StatusPill({
  status,
  error,
  loading,
}: {
  status: MemoryStatus | null;
  error: string | null;
  loading: boolean;
}) {
  // Never render a resolved-looking claim while the first fetch is in flight.
  const pill = loading
    ? { label: "Checking", tone: "muted" as const }
    : describeCogneeStatusPill(status, error);

  return (
    <span
      className={`cognee-status-pill is-${pill.tone}`}
      title={error ?? status?.reason ?? pill.label}
    >
      {pill.label}
    </span>
  );
}

function StatusDatum({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "muted";
}) {
  return (
    <div className={`cognee-status-datum is-${tone}`}>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function MetricTile({
  icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "amber";
}) {
  return (
    <div className={`cognee-metric-tile is-${tone}`}>
      <div className="cognee-metric-icon">{icon}</div>
      <div className="cognee-metric-value">{value}</div>
      <div className="cognee-metric-label">{label}</div>
      <div className="cognee-metric-detail">{detail}</div>
    </div>
  );
}

function PipelineStep({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "muted" | "danger";
}) {
  return (
    <div className={`cognee-pipeline-step is-${tone}`}>
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

function BreakdownList({
  rows,
  emptyLabel,
}: {
  rows: Array<{ label: string; value: string; meta: string }>;
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <div className="cognee-breakdown-empty">{emptyLabel}</div>;
  }

  return (
    <div className="cognee-breakdown-list">
      {rows.map((row) => (
        <div key={row.label} className="cognee-breakdown-row">
          <div>
            <strong>{row.label}</strong>
            <span>{row.meta}</span>
          </div>
          <em>{row.value}</em>
        </div>
      ))}
    </div>
  );
}

function CogneeEventRow({ event }: { event: CogneeMemoryLedgerEvent }) {
  const dataLabel = formatCogneeEventDataLabel(event);
  const scope = [event.repo, event.branch].filter(Boolean).join(" / ") || event.datasetName || "-";

  return (
    <div className="cognee-events-row" role="row">
      <span role="cell" title={event.startedAt}>
        {formatTime(event.startedAt)}
      </span>
      <span role="cell">{event.operation}</span>
      <span role="cell" title={event.titles.join("\n") || event.query || event.source}>
        {event.source}
      </span>
      <span role="cell" title={scope}>
        {scope}
      </span>
      <span role="cell">{dataLabel}</span>
      <span
        role="cell"
        className={`cognee-event-status is-${event.status}`}
        title={event.reason ?? event.error ?? event.status}
      >
        {event.status}
      </span>
    </div>
  );
}

/** Latest remembered titles (one per event) so the panel shows WHAT memory
 * holds, not just byte counts. */
function rememberedTitles(
  ledger: CogneeMemoryLedgerSnapshot,
): Array<{ title: string; repo?: string; startedAt: string }> {
  const rows: Array<{ title: string; repo?: string; startedAt: string }> = [];
  for (const event of ledger.events) {
    if (event.operation !== "remember" || event.titles.length === 0) continue;
    rows.push({ title: event.titles[0], repo: event.repo, startedAt: event.startedAt });
    if (rows.length >= 5) break;
  }
  return rows;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function relativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return date.toLocaleDateString();
}
