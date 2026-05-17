import { useEffect, useState } from "react";
import { Plugs, Shield, TerminalWindow, Warning } from "@phosphor-icons/react";
import { ipc, type EnvironmentWarning } from "../lib/ipc";
import "./EnvironmentWarnings.css";

type SecretWarning = {
  kind: string;
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  paths: string[];
};

const SEVERITY_FILL: Record<"low" | "medium" | "high", number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const SEVERITY_COLOR: Record<"low" | "medium" | "high", string> = {
  low: "var(--color-accent-green)",
  medium: "var(--color-accent-amber)",
  high: "var(--color-accent-red)",
};

/** Three-bullet severity glyph: filled count = severity rank, unfilled bullets
 *  fade to muted. Sentence case dominates the rest of the app — these glyphs
 *  carry the severity weight that all-caps badges used to. */
function SeverityGlyph({ severity }: { severity: "low" | "medium" | "high" }) {
  const filled = SEVERITY_FILL[severity];
  const color = SEVERITY_COLOR[severity];
  return (
    <span
      className="environment-severity-glyph"
      aria-label={`Severity: ${severity}`}
      title={`Severity: ${severity}`}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="environment-severity-bullet"
          style={{ color: i < filled ? color : "var(--color-text-muted)" }}
        >
          {i < filled ? "●" : "○"}
        </span>
      ))}
    </span>
  );
}

type TestCommand = {
  command: string;
  kind: string;
  confidence: "low" | "medium" | "high";
  reason: string;
  paths: string[];
};

type GitStatusSignals = {
  environmentWarnings?: EnvironmentWarning[];
  secretWarnings?: SecretWarning[];
  testCommands?: TestCommand[];
};

export function EnvironmentWarnings({ repoPath }: { repoPath: string }) {
  const [warnings, setWarnings] = useState<EnvironmentWarning[]>([]);
  const [secretWarnings, setSecretWarnings] = useState<SecretWarning[]>([]);
  const [testCommands, setTestCommands] = useState<TestCommand[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ipc
      .getGitStatus(repoPath, { mode: "health" })
      .then((status) => {
        if (!cancelled) {
          const signals = status as GitStatusSignals;
          setWarnings(signals.environmentWarnings ?? []);
          setSecretWarnings(signals.secretWarnings ?? []);
          setTestCommands(signals.testCommands ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWarnings([]);
          setSecretWarnings([]);
          setTestCommands([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  const totalSignals = warnings.length + secretWarnings.length + testCommands.length;

  return (
    <section className="environment-warnings">
      <header className="environment-header">
        <span className="section-label">Dev environment</span>
        <span className="environment-count">{totalSignals}</span>
      </header>
      {loading ? (
        <div className="empty">Scanning…</div>
      ) : totalSignals === 0 ? (
        <div className="environment-clear">
          <Plugs size={14} aria-hidden="true" />
          <span>No environment, security, or validation signals detected</span>
        </div>
      ) : (
        <div className="environment-list">
          {warnings.map((warning) => (
            <article
              key={`${warning.kind}:${warning.title}:${warning.paths.join(",")}`}
              className={`environment-item environment-${warning.severity}`}
            >
              <div className="environment-item-head">
                <Warning size={13} aria-hidden="true" />
                <span>{warning.kind}</span>
                <SeverityGlyph severity={warning.severity} />
                <strong>{warning.title}</strong>
              </div>
              <p>{warning.detail}</p>
              {warning.paths.length > 0 && (
                <div className="environment-paths">
                  {warning.paths.map((path) => (
                    <code key={path}>{path}</code>
                  ))}
                </div>
              )}
            </article>
          ))}
          {secretWarnings.map((warning) => (
            <article
              key={`secret:${warning.kind}:${warning.title}:${warning.paths.join(",")}`}
              className={`environment-item environment-secret environment-${warning.severity}`}
            >
              <div className="environment-item-head">
                <Shield size={13} aria-hidden="true" />
                <span>security</span>
                <SeverityGlyph severity={warning.severity} />
                <strong>{maskSecretText(warning.title)}</strong>
              </div>
              <p>{maskSecretText(warning.detail)}</p>
              {warning.paths.length > 0 && (
                <div className="environment-paths">
                  {warning.paths.map((path) => (
                    <code key={path}>{path}</code>
                  ))}
                </div>
              )}
            </article>
          ))}
          {testCommands.length > 0 && (
            <div className="validation-commands" aria-label="Suggested validation commands">
              <div className="validation-title">
                <TerminalWindow size={13} aria-hidden="true" />
                <span>Validation commands</span>
              </div>
              {testCommands.map((command) => (
                <article
                  key={`${command.kind}:${command.command}:${command.paths.join(",")}`}
                  className={`validation-command validation-${command.confidence}`}
                >
                  <div className="validation-command-head">
                    <code>{command.command}</code>
                    <span>{command.confidence}</span>
                  </div>
                  <p>{command.reason}</p>
                  {command.paths.length > 0 && (
                    <div className="environment-paths">
                      {command.paths.map((path) => (
                        <code key={path}>{path}</code>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function maskSecretText(text: string): string {
  const masked = text
    .replace(/([A-Za-z0-9_]*KEY[A-Za-z0-9_]*\s*[:=]\s*)[^\s,;]+/gi, "$1****")
    .replace(/([A-Za-z0-9_]*TOKEN[A-Za-z0-9_]*\s*[:=]\s*)[^\s,;]+/gi, "$1****")
    .replace(/([A-Za-z0-9_]*SECRET[A-Za-z0-9_]*\s*[:=]\s*)[^\s,;]+/gi, "$1****")
    .replace(/([A-Za-z0-9_]*PASSWORD[A-Za-z0-9_]*\s*[:=]\s*)[^\s,;]+/gi, "$1****");
  return masked === text ? text : masked;
}
