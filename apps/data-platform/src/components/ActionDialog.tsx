import { useState } from "react";
import {
  Button,
  Callout,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
  HTMLSelect,
  InputGroup,
  Intent,
  NumericInput,
} from "@blueprintjs/core";
import { DateInput, TimePrecision } from "@blueprintjs/datetime";
import "@blueprintjs/datetime/lib/css/blueprint-datetime.css";
import { postAction } from "../api.ts";
import type { ActionType } from "../api.ts";

/* ------------------------------------------------------------------ */
/*  JSON Schema helpers                                                */
/* ------------------------------------------------------------------ */

interface FieldSchema {
  type: string;
  format?: string;
  enum?: string[];
  description?: string;
}

interface ParamSchema {
  type: "object";
  required?: string[];
  properties?: Record<string, FieldSchema>;
}

type FieldKind = "datetime" | "string" | "enum" | "number";

function inferKind(schema: FieldSchema): FieldKind {
  if (schema.enum) return "enum";
  if (schema.type === "number" || schema.type === "integer") return "number";
  if (schema.type === "string" && schema.format === "date-time") return "datetime";
  return "string";
}

function camelToTitle(s: string): string {
  return s
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ActionDialogProps {
  action: ActionType;
  typeApiName: string;
  instanceId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ActionDialog({
  action,
  typeApiName,
  instanceId,
  isOpen,
  onClose,
  onSuccess,
}: ActionDialogProps) {
  const schema = (action.parameter_schema ?? {
    type: "object",
    properties: {},
  }) as ParamSchema;

  const fields = Object.entries(schema.properties ?? {}).map(
    ([name, fieldSchema]) => ({
      name,
      schema: fieldSchema,
      kind: inferKind(fieldSchema),
      required: schema.required?.includes(name) ?? false,
      label: camelToTitle(name),
    }),
  );

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    data: unknown;
  } | null>(null);

  function setValue(name: string, value: unknown) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function handleClose() {
    setValues({});
    setResult(null);
    onClose();
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      // Normalize datetime values to full ISO 8601 (with timezone offset)
      const payload: Record<string, unknown> = { ...values };
      for (const field of fields) {
        if (field.kind === "datetime" && typeof payload[field.name] === "string") {
          payload[field.name] = new Date(payload[field.name] as string).toISOString();
        }
      }

      const data = await postAction(
        typeApiName,
        instanceId,
        action.api_name,
        payload,
      );
      setResult({ ok: true, data });
    } catch (err) {
      setResult({
        ok: false,
        data: err instanceof Error ? err.message : "Action failed",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function handleDone() {
    if (result?.ok) onSuccess();
    handleClose();
  }

  return (
    <Dialog isOpen={isOpen} onClose={handleClose} title={action.name}>
      <DialogBody>
        {result ? (
          result.ok ? (
            <Callout intent={Intent.SUCCESS} title="Action completed">
              <pre className="action-result-json">
                {JSON.stringify(result.data, null, 2)}
              </pre>
            </Callout>
          ) : (
            <Callout intent={Intent.DANGER} title="Action failed">
              {String(result.data)}
            </Callout>
          )
        ) : (
          <>
            {action.description && (
              <p className="bp5-text-muted" style={{ marginTop: 0 }}>
                {action.description}
              </p>
            )}
            {fields.map((field) => (
              <FormGroup
                key={field.name}
                label={field.label}
                labelInfo={field.required ? "(required)" : undefined}
                helperText={field.schema.description}
              >
                <FieldInput
                  kind={field.kind}
                  enumValues={field.schema.enum}
                  value={values[field.name]}
                  onChange={(v) => setValue(field.name, v)}
                />
              </FormGroup>
            ))}
          </>
        )}
      </DialogBody>
      <DialogFooter
        actions={
          result ? (
            <Button text="Done" intent={Intent.PRIMARY} onClick={handleDone} />
          ) : (
            <>
              <Button text="Cancel" onClick={handleClose} />
              <Button
                text="Execute"
                intent={Intent.PRIMARY}
                onClick={handleSubmit}
                loading={submitting}
              />
            </>
          )
        }
      />
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Field renderer                                                     */
/* ------------------------------------------------------------------ */

interface FieldInputProps {
  kind: FieldKind;
  enumValues?: string[];
  value: unknown;
  onChange: (value: unknown) => void;
}

function FieldInput({ kind, enumValues, value, onChange }: FieldInputProps) {
  switch (kind) {
    case "datetime":
      return (
        <DateInput
          value={(value as string) ?? null}
          onChange={(newDate, isUserChange) => {
            if (isUserChange) onChange(newDate);
          }}
          dateFnsFormat="yyyy-MM-dd HH:mm"
          timePrecision={TimePrecision.MINUTE}
          showTimezoneSelect={false}
          fill
        />
      );

    case "enum":
      return (
        <HTMLSelect
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          fill
          options={[
            { value: "", label: "Select…" },
            ...(enumValues ?? []).map((v) => ({ value: v, label: v })),
          ]}
        />
      );

    case "number":
      return (
        <NumericInput
          value={value as number | undefined}
          onValueChange={(num) => onChange(num)}
          fill
        />
      );

    case "string":
    default:
      return (
        <InputGroup
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          fill
        />
      );
  }
}
