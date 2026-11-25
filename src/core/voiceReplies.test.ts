import { describe, expect, it } from "vitest";
import { heardLabel, spokenReply } from "./voiceReplies";

describe("spoken replies", () => {
  it.each(["Preparando audio…", "Reanudando", "Siguiente canción", "Reproduciendo Bailarina", "Mix de Miranda!", "Otra de Misfits", "Lo mejor de Ween", "Lo más nuevo de Enjambre: «Daltónico»", "Tus guardadas en aleatorio"])(
    "stays silent when the music already answers: %s", (answer) => expect(spokenReply(answer)).toBeUndefined());
  it.each([
    ["En pausa", "En pausa"],
    ["Suena «Afuera» de Caifanes", "Suena «Afuera» de Caifanes"],
    ["La música se apagará en 20 minutos", "La música se apagará en 20 minutos"],
    ["Error: Sin conexión", "Sin conexión"],
    ["Te escucho: dime qué pongo", "Te escucho: dime qué pongo"],
    ["No estoy seguro de qué es «los backs». ¿Es alguna de estas?", "No estoy seguro de qué es «los backs». ¿Es alguna de estas?"],
  ])("says %s", (answer, said) => expect(spokenReply(answer)).toBe(said));
});

describe("what the status shows while MURMUR works on a request", () => {
  it("uses the first alternative", () => expect(heardLabel(["Pon misfits", "Pon misfit"].join(String.fromCharCode(10)))).toBe("Pon misfits"));
  it("drops the wake phrase and courtesy", () => expect(heardLabel("Ok MURMUR, pon algo de Enjambre por favor")).toBe("pon algo de Enjambre"));
  it("fits one line", () => {
    const label = heardLabel("Reproduce King Gizzard and the Lizard Wizard en YouTube Music ahora");
    expect(label.length).toBeLessThanOrEqual(38);
    expect(label.endsWith("…")).toBe(true);
  });
  it("never empty", () => expect(heardLabel("  ")).toBe("tu petición"));
});
