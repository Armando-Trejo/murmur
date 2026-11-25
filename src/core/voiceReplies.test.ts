import { describe, expect, it } from "vitest";
import { spokenReply } from "./voiceReplies";

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
