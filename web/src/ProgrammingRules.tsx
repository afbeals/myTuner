import { useEffect, useId, useState } from "react";
import type { Programming, Source, Rules as BreakRules } from "./types";
import { DirectoryTree, catalogDirectoryLoader } from "./DirectoryTree";
import { Field, Select } from "./ui";
import { Info } from "./Info";
import type { ProgrammingOption } from "./SelectionPicker";
import { CommercialEligibility } from "./CommercialEligibility";
export function ProgrammingRules({
  config,
  sources,
  onChange,
  pools = [],
  onChoosePool,
  onValidityChange,
}: {
  config: Programming;
  sources: Source[];
  onChange: (next: Programming) => void;
  pools?: ProgrammingOption[];
  onChoosePool?: () => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const errorId = useId();
  const [tree, setTree] = useState(false),
    [positions, setPositions] = useState(
      config.rules.positions
        .map((position) =>
          position.kind === "timestamp"
            ? position.value / 1000
            : position.value,
        )
        .join(", "),
    ),
    [unit, setUnit] = useState(config.rules.positions[0]?.kind ?? "percent");
  const rules = config.rules,
    patch = (next: Partial<BreakRules>) =>
      onChange({ ...config, rules: { ...rules, ...next } }),
    selection = config.commercialSelection,
    sourceId = selection?.type === "folder" ? selection.sourceId : "";
  const positionError = (text: string, kind: typeof unit) => {
    const values = text
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map(Number);
    return values.some(
      (value) =>
        !Number.isFinite(value) ||
        value <= 0 ||
        (kind === "percent"
          ? value >= 100
          : !Number.isSafeInteger(Math.round(value * 1000)) ||
            Math.round(value * 1000) <= 0),
    )
      ? kind === "percent"
        ? "Enter comma-separated numbers greater than 0 and less than 100, such as 25, 50, 75."
        : "Enter comma-separated positive seconds (at least 0.001), such as 30, 90.5."
      : "";
  };
  const error = positionError(positions, unit);
  useEffect(() => {
    onValidityChange?.(!selection || !error);
  }, [error, Boolean(selection), onValidityChange]);
  const updatePositions = (text: string, kind: typeof unit) => {
    setPositions(text);
    if (positionError(text, kind)) {
      onChange(config);
      return;
    }
    const values = text
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map(Number);
    patch({
      positions: values.map((value) => ({
        kind,
        value: kind === "timestamp" ? Math.round(value * 1000) : value,
      })),
    });
  };
  const selectedPool = selection ? JSON.stringify(selection) : "";
  const sourceLabel = (sourceId: string | null) =>
    sources.find((source) => source.id === sourceId)?.name ??
    "Saved collections";
  const eligiblePools = pools.filter(
    (pool) =>
      pool.kind === "collection" ||
      (pool.kind === "folder" &&
        sources.some(
          (source) =>
            source.id === pool.sourceId &&
            ["commercials", "videos"].includes(source.kind),
        )) ||
      (pool.kind === "movie" &&
        sources.some(
          (source) =>
            source.id === pool.sourceId &&
            ["commercials", "videos"].includes(source.kind),
        )),
  );
  return (
    <>
      <h3>
        Commercials{" "}
        <Info title="Optional commercial breaks">
          Leave the pool empty for uninterrupted programming. Truncate can use a
          longer commercial to fill the last part of a break. Under the minimum
          remaining time, programming resumes immediately.
        </Info>
      </h3>
      <Select
        label="Commercial pool"
        value={selectedPool}
        onChange={(event) => {
          const { commercialSelection: _, ...base } = config;
          onChange({
            ...base,
            disabledCommercialIds: [],
            ...(event.target.value
              ? { commercialSelection: JSON.parse(event.target.value) }
              : {}),
          });
        }}
      >
        <option value="">No commercials</option>
        {selection && (
          <option value={selectedPool}>
            {selection.type === "folder"
              ? `${sourceLabel(selection.sourceId)} · ${selection.directory || "Entire source"}`
              : (eligiblePools.find(
                  (pool) => JSON.stringify(pool.selection) === selectedPool,
                )?.title ??
                (selection.type === "media"
                  ? `${selection.ids.length} selected commercial ${selection.ids.length === 1 ? "file" : "files"}`
                  : "Saved commercial selection"))}
          </option>
        )}
        {sources
          .filter((source) => source.kind === "commercials")
          .map((source) => {
            const value = JSON.stringify({
              type: "folder",
              sourceId: source.id,
              directory: "",
              recursive: true,
            });
            return value === selectedPool ? null : (
              <option key={source.id} value={value}>
                {source.name} · Entire source
              </option>
            );
          })}
        {eligiblePools
          .filter(
            (pool) =>
              JSON.stringify(pool.selection) !== selectedPool &&
              !(
                pool.selection.type === "folder" &&
                !pool.selection.directory &&
                sources.some(
                  (source) =>
                    source.id === pool.sourceId &&
                    source.kind === "commercials",
                )
              ),
          )
          .map((pool) => (
            <option
              key={JSON.stringify(pool.selection)}
              value={JSON.stringify(pool.selection)}
            >
              {sourceLabel(pool.sourceId)} · {pool.title}
            </option>
          ))}
      </Select>
      {onChoosePool && (
        <button type="button" className="secondary" onClick={onChoosePool}>
          Find another commercial pool
        </button>
      )}
      <p role="status">{commercialSummary(config)}</p>
      {selection && (
        <>
          <div className="actions">
            <span>
              Pool: {sourceId ? `${sourceLabel(sourceId)} · ` : ""}
              {selection?.type === "folder"
                ? selection.directory || "Entire source"
                : "Saved selection"}
            </span>
            {sourceId && (
              <button
                type="button"
                className="secondary"
                onClick={() => setTree(true)}
              >
                Choose commercial folder
              </button>
            )}
            <button
              type="button"
              className="secondary"
              onClick={() => {
                const { commercialSelection: _, ...base } = config;
                onChange({ ...base, disabledCommercialIds: [] });
              }}
            >
              Remove commercials
            </button>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={rules.between}
              onChange={(event) => patch({ between: event.target.checked })}
            />
            Breaks between programs
          </label>
          <div className="two-col">
            <Select
              label="Break position unit"
              value={unit}
              onChange={(event) => {
                const next = event.target.value as typeof unit;
                setUnit(next);
                updatePositions(positions, next);
              }}
            >
              <option value="percent">Percent of program</option>
              <option value="timestamp">Seconds into program</option>
            </Select>
            <Field
              label="Break positions"
              value={positions}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => {
                updatePositions(event.target.value, unit);
              }}
              placeholder="25, 50, 75"
              hint={
                unit === "percent"
                  ? "Optional percentages greater than 0 and less than 100"
                  : "Optional positive seconds into each program"
              }
            />
            {error && (
              <p className="error" id={errorId} role="alert">
                {error}
              </p>
            )}
            <Field
              label="Maximum break length (seconds)"
              type="number"
              step={0.001}
              value={rules.maxDurationMs / 1000}
              min={0}
              max={3600}
              required
              onChange={(event) =>
                patch({
                  maxDurationMs: Math.round(Number(event.target.value) * 1000),
                })
              }
            />
            <Field
              label="Maximum commercials per break"
              type="number"
              value={rules.maxClips}
              min={0}
              max={100}
              required
              onChange={(event) =>
                patch({ maxClips: Number(event.target.value) })
              }
            />
            <Select
              label="When a commercial is too long"
              value={rules.overflowPolicy ?? "truncate"}
              onChange={(event) =>
                patch({
                  overflowPolicy: event.target.value as "skip" | "truncate",
                })
              }
            >
              <option value="truncate">Play and cut off at break end</option>
              <option value="skip">Skip this commercial</option>
            </Select>
            <Field
              label="Minimum remaining break time (seconds)"
              type="number"
              step={0.001}
              min={0}
              max={3600}
              value={(rules.minRemainingMs ?? 6000) / 1000}
              required
              onChange={(event) =>
                patch({
                  minRemainingMs: Math.round(Number(event.target.value) * 1000),
                })
              }
            />
          </div>
          <details>
            <summary>Advanced variation and random breaks</summary>
            <div className="two-col">
              <Field
                label="Repeat allowance in rotation"
                type="number"
                min={1}
                max={100}
                value={rules.repeatAllowance}
                required
                onChange={(event) =>
                  patch({ repeatAllowance: Number(event.target.value) })
                }
              />
              <Field
                label="Same commercial per break"
                type="number"
                min={1}
                max={100}
                value={rules.maxPerBreak}
                required
                onChange={(event) =>
                  patch({ maxPerBreak: Number(event.target.value) })
                }
              />
              <Field
                label="Commercial cooldown (seconds)"
                type="number"
                step={0.001}
                min={0}
                max={604800}
                value={rules.cooldownMs / 1000}
                required
                onChange={(event) =>
                  patch({
                    cooldownMs: Math.round(Number(event.target.value) * 1000),
                  })
                }
              />
              <Field
                label="Random breaks per program"
                type="number"
                min={0}
                max={100}
                value={rules.random?.count ?? 0}
                onChange={(event) => {
                  const count = Number(event.target.value),
                    { random: _, ...base } = rules;
                  onChange({
                    ...config,
                    rules: count
                      ? {
                          ...rules,
                          random: {
                            count,
                            minPercent: rules.random?.minPercent ?? 20,
                            maxPercent: rules.random?.maxPercent ?? 80,
                          },
                        }
                      : base,
                  });
                }}
              />
              {rules.random && (
                <>
                  <Field
                    label="Earliest random break (%)"
                    type="number"
                    min={1}
                    max={98}
                    value={rules.random.minPercent}
                    required
                    onChange={(event) =>
                      patch({
                        random: {
                          ...rules.random!,
                          minPercent: Number(event.target.value),
                        },
                      })
                    }
                  />
                  <Field
                    label="Latest random break (%)"
                    type="number"
                    min={2}
                    max={99}
                    value={rules.random.maxPercent}
                    required
                    onChange={(event) =>
                      patch({
                        random: {
                          ...rules.random!,
                          maxPercent: Number(event.target.value),
                        },
                      })
                    }
                  />
                </>
              )}
            </div>
          </details>
          <CommercialEligibility
            config={config}
            profileId={config.profileId}
            update={onChange}
          />
        </>
      )}
      {tree && (
        <DirectoryTree
          identity={`${config.profileId}:${sourceId}`}
          title="Commercial pool folder"
          rootLabel={
            sources.find((source) => source.id === sourceId)?.name ??
            "Commercials"
          }
          load={catalogDirectoryLoader(config.profileId, sourceId)}
          initial={[selection?.type === "folder" ? selection.directory : ""]}
          onApply={(paths) => {
            onChange({
              ...config,
              commercialSelection: {
                type: "folder",
                sourceId,
                directory: paths[0] ?? "",
                recursive: true,
              },
              disabledCommercialIds: [],
            });
            setTree(false);
          }}
          onClose={() => setTree(false)}
        />
      )}
    </>
  );
}

export function commercialSummary(config: Programming) {
  if (!config.commercialSelection) return "No commercials";
  const enabled =
    config.rules.between ||
    config.rules.positions.length > 0 ||
    Boolean(config.rules.random?.count);
  return !enabled
    ? "Commercial pool selected · no break placements enabled"
    : config.rules.maxClips <= 0 || config.rules.maxDurationMs <= 0
      ? "Commercial pool selected · break limits currently allow no commercials"
      : "Commercial breaks enabled";
}
