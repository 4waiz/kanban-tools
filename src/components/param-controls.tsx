"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OutputParamSpec } from "@/lib/types";

type ParamValue = string | number | boolean;

/**
 * Renders the declarative parameter controls an output option exposes
 * (width/height/quality/preset/…). Fully controlled by the parent.
 */
export function ParamControls({
  specs,
  values,
  onChange,
}: {
  specs: OutputParamSpec[];
  values: Record<string, ParamValue>;
  onChange: (key: string, value: ParamValue) => void;
}) {
  if (!specs || specs.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {specs.map((spec) => (
        <div key={spec.key} className="space-y-2">
          <Label htmlFor={`param-${spec.key}`} className="text-xs text-muted-foreground">
            {spec.label}
            {"unit" in spec && spec.unit ? ` (${spec.unit})` : ""}
          </Label>

          {spec.type === "number" && (
            <Input
              id={`param-${spec.key}`}
              type="number"
              min={spec.min}
              max={spec.max}
              step={spec.step ?? 1}
              placeholder={spec.default != null ? String(spec.default) : "auto"}
              value={values[spec.key] === undefined ? "" : String(values[spec.key])}
              onChange={(e) =>
                onChange(
                  spec.key,
                  e.target.value === "" ? "" : Number(e.target.value),
                )
              }
            />
          )}

          {spec.type === "select" && (
            <Select
              value={
                values[spec.key] !== undefined
                  ? String(values[spec.key])
                  : spec.default
              }
              onValueChange={(v) => onChange(spec.key, v)}
            >
              <SelectTrigger id={`param-${spec.key}`}>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {spec.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {spec.type === "boolean" && (
            <div className="flex h-10 items-center">
              <Switch
                id={`param-${spec.key}`}
                checked={
                  values[spec.key] !== undefined
                    ? Boolean(values[spec.key])
                    : Boolean(spec.default)
                }
                onCheckedChange={(c) => onChange(spec.key, c)}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
