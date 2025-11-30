import { Effect, Schema } from "effect";
import { select } from "@inquirer/prompts";
import * as fs from "node:fs";
import * as tty from "node:tty";

export class SelectInputError extends Schema.TaggedError<SelectInputError>()(
    "SelectInputError",
    {
        message: Schema.String,
    }
) {}

export interface SelectItem<T extends string = string> {
    label: string;
    value: T;
}

export class SelectInput extends Effect.Service<SelectInput>()(
    "ais/SelectInput",
    {
        effect: Effect.gen(function* () {
            // Use /dev/tty for input when stdin might be piped
            // Must use tty.ReadStream for proper raw mode support
            const ttyInput = process.stdin.isTTY
                ? process.stdin
                : new tty.ReadStream(fs.openSync("/dev/tty", "r"));

            return {
                select: <T extends string>(
                    items: SelectItem<T>[]
                ): Effect.Effect<T, never, never> =>
                    Effect.promise(() =>
                        select(
                            {
                                message: "Select an option",
                                choices: items.map((item) => ({
                                    name: item.label,
                                    value: item.value,
                                })),
                            },
                            { input: ttyInput }
                        )
                    ),
            };
        }),
    }
) {}
