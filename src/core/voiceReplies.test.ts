import { describe, expect, it } from "vitest";
import { spokenReply } from "./voiceReplies";

describe("spoken replies", () => {
  it.each(["Preparando audio…", "Reanudando", "Siguiente canción", "Reproduciendo Bailarina", "Mix de Miranda!"])(
    "stays silent when the music already answers: %s", (answer) => expect(spokenReply(answer)).toBeUndefined());
  it.each([
    ["En pausa", "En pausa"],
    ["Suena «Afuera» de Caifanes", "Suena «Afuera» de Caifanes"],
    ["La música se apagará en 20 minutos", "La música se apagará en 20 minutos"],
    ["Error: Sin conexión", "Sin conexión"],
  ])("says %s", (answer, said) => expect(spokenReply(answer)).toBe(said));
});
