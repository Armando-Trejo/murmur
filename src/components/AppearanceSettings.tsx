import { useEffect, useState } from "react";
import { db } from "../core/db";
import {
  validAccent,
  applyAppearance,
  DEFAULT_ACCENT,
  accentInk,
} from "../core/appearance";
import { Palette, Sparkles, Check } from "lucide-react";
export function useAppearance() {
  const [accent, setAccent] = useState(() =>
    validAccent(localStorage.getItem("murmur.accent")),
  );
  const [glows, setGlows] = useState(
    () => localStorage.getItem("murmur.glows") !== "false",
  );
  useEffect(() => {
    let live = true;
    void db.settings
      .bulkGet(["appearance.accent", "appearance.glows"])
      .then(([color, glow]) => {
        if (live) {
          if (color) setAccent(validAccent(color.value));
          if (glow) setGlows(glow.value !== false);
        }
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    applyAppearance(accent, glows);
  }, [accent, glows]);
  const choose = async (color: string) => {
    const next = validAccent(color);
    setAccent(next);
    localStorage.setItem("murmur.accent", next);
    await db.settings.put({ key: "appearance.accent", value: next });
  };
  const toggle = async (value: boolean) => {
    setGlows(value);
    localStorage.setItem("murmur.glows", String(value));
    await db.settings.put({ key: "appearance.glows", value });
  };
  return { accent, glows, choose, toggle };
}
export function AppearanceSettings({
  appearance,
  notify,
}: {
  appearance: ReturnType<typeof useAppearance>;
  notify: (message: string, kind?: "info" | "success" | "error") => void;
}) {
  const [draft, setDraft] = useState(appearance.accent);
  useEffect(() => setDraft(appearance.accent), [appearance.accent]);
  const save = async (color: string) => {
    try {
      await appearance.choose(color);
      notify("Acento guardado.", "success");
    } catch {
      notify("No se pudo guardar el acento. Reintenta.", "error");
    }
  };
  return (
    <section
      className="appearance-settings"
      aria-labelledby="appearance-heading"
    >
      <div className="section-heading">
        <h2 id="appearance-heading">
          <Palette size={20} /> Tu acento
        </h2>
      </div>
      <p className="help-copy">
        Color para controles, detalles y luz ambiental. Las carátulas mantienen
        sus colores.
      </p>
      <div
        className="accent-presets"
        role="group"
        aria-label="Colores de acento"
      >
        {[
          ["Amatista", DEFAULT_ACCENT],
          ["Menta", "#7BE2BB"],
          ["Ámbar", "#F9C66C"],
          ["Rosa", "#F49CC8"],
          ["Azul", "#8CBFFF"],
          ["Blanco", "#FFFFFF"],
        ].map(([name, color]) => (
          <button
            key={name}
            className="accent-swatch"
            aria-label={name}
            aria-pressed={appearance.accent === color}
            style={{ background: color, color: accentInk(color) }}
            onClick={() => void save(color)}
          >
            {appearance.accent === color && <Check size={20} />}
          </button>
        ))}
      </div>
      <div className="custom-accent">
        <label htmlFor="custom-accent">Color personalizado</label>
        <input
          type="color"
          id="custom-accent"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          className="button secondary"
          onClick={() => void save(draft)}
          disabled={draft === appearance.accent}
        >
          Aplicar
        </button>
      </div>
      <label className="glow-option">
        <Sparkles size={20} />
        <span>
          Luz ambiental
          <small>Un resplandor suave en el arte y el reproductor</small>
        </span>
        <input
          type="checkbox"
          checked={appearance.glows}
          onChange={(event) =>
            void appearance
              .toggle(event.target.checked)
              .catch(() =>
                notify("No se pudo guardar la luz ambiental.", "error"),
              )
          }
        />
      </label>
    </section>
  );
}
