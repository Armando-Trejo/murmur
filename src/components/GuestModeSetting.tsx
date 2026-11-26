import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { GUEST_HOURS, guestModeUntil, setGuestMode } from "../core/tasteGuard";

const time = (at: number) => new Date(at).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });

/** «Modo invitado»: friends pick the music (or you test something) without changing your taste. */
export function GuestModeSetting({ notify }: { notify: (message: string, kind?: "info" | "success" | "error") => void }) {
  const [until, setUntil] = useState(() => guestModeUntil());
  // Reflect the automatic switch-off while the screen stays open.
  useEffect(() => {
    if (!until) return;
    const t = setTimeout(() => setUntil(guestModeUntil()), Math.max(1000, until - Date.now() + 500));
    return () => clearTimeout(t);
  }, [until]);
  const change = (on: boolean) => {
    setGuestMode(on);
    const next = guestModeUntil();
    setUntil(next);
    notify(on ? `Modo invitado hasta las ${time(next)}. Lo que suene no cambia tus gustos.` : "Modo invitado apagado. MURMUR vuelve a aprender de lo que escuchas.", "success");
  };
  return (
    <label className="glow-option">
      <UserRound size={20} />
      <span>
        Modo invitado
        <small>
          {until
            ? `Activo hasta las ${time(until)}: lo que suene no cambia tus gustos ni tus mixes.`
            : `Para pruebas o cuando otros eligen la música. Se apaga solo en ${GUEST_HOURS} h. Aunque no lo actives, MURMUR ya ignora lo que no se parece a ti hasta que lo vuelves a escuchar otros días.`}
        </small>
      </span>
      <input type="checkbox" checked={!!until} onChange={(e) => change(e.target.checked)} />
    </label>
  );
}
