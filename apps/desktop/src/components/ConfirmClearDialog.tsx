import { useState } from "react";
import { useT } from "../i18n";
import { Trans } from "../i18n/Trans";

/**
 * Generic "type the name to confirm" modal for irreversible actions — first
 * (and, as of spec 0014, only) use is Storage's "Clear"/"Clear table", the
 * one destructive action in the app with no undo. Deliberately requires an
 * exact match against `target` (not just any non-empty input) so a reflexive
 * double-click can't fire it — see `StorageView`'s call sites for what
 * `target` is (the engine's display label, or `table.name`).
 */
export function ConfirmClearDialog({
  target,
  onConfirm,
  onCancel,
}: {
  target: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [input, setInput] = useState("");
  const canConfirm = input === target;

  return (
    <div className="confirm-clear-overlay" onClick={onCancel}>
      <div className="confirm-clear-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{t("storage.clear.confirmTitle", { target })}</h3>
        <p>{t("storage.clear.confirmBody", { target })}</p>
        <p>
          <Trans k="storage.clear.confirmPrompt" values={{ target: <code>{target}</code> }} />
        </p>
        <input
          className="confirm-clear-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canConfirm) onConfirm();
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className="confirm-clear-actions">
          <button type="button" className="confirm-clear-cancel" onClick={onCancel}>
            {t("storage.clear.cancelButton")}
          </button>
          <button type="button" className="confirm-clear-confirm" disabled={!canConfirm} onClick={onConfirm}>
            {t("storage.clear.confirmButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
