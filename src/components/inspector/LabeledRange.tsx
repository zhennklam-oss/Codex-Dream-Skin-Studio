import { useEffect, useId, useState } from "react";

export interface LabeledRangeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  resetValue: number;
  disabled?: boolean;
  onChange(value: number): void;
}

export function LabeledRange({ label, value, min, max, step, unit, resetValue, disabled = false, onChange }: LabeledRangeProps) {
  const id = useId();
  const [typedValue, setTypedValue] = useState(String(value));

  useEffect(() => setTypedValue(String(value)), [value]);

  const parsed = Number(typedValue);
  const valid = typedValue.trim() !== "" && Number.isFinite(parsed) && parsed >= min && parsed <= max;

  function commit(next: string) {
    setTypedValue(next);
    const numeric = Number(next);
    if (next.trim() !== "" && Number.isFinite(numeric) && numeric >= min && numeric <= max) onChange(numeric);
  }

  return (
    <div className="labeled-range">
      <div className="labeled-range__header">
        <label htmlFor={`${id}-range`}>{label}</label>
        <button type="button" disabled={disabled} aria-label={`重置${label}`} onClick={() => commit(String(resetValue))}>重置</button>
      </div>
      <input
        id={`${id}-range`}
        type="range"
        aria-label={label}
        value={valid ? parsed : value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => commit(event.target.value)}
      />
      <div className="labeled-range__readout">
        <input
          type="number"
          aria-label={`${label}数值`}
          aria-invalid={!valid}
          value={typedValue}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => commit(event.target.value)}
        />
        <span aria-hidden="true">{unit}</span>
      </div>
    </div>
  );
}
