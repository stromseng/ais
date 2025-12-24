import { Effect } from "effect";
import { input } from "@inquirer/prompts";
import { getTtyInput } from "./selectInput";

type InputConfig = Pick<
    Parameters<typeof input>[0],
    "message" | "default" | "prefill" | "required"
>;

export class TextInput extends Effect.Service<TextInput>()("ais/TextInput", {
    effect: Effect.gen(function* () {
        const ttyInput = getTtyInput();

        return {
            input: (config: InputConfig): Effect.Effect<string, never, never> =>
                Effect.promise(() => input(config, { input: ttyInput })),
        };
    }),
}) {}
