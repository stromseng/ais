import { Effect, Schema } from "effect";
import { select } from "@inquirer/prompts";

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
            return {
                select: <T extends string>(
                    items: SelectItem<T>[]
                ): Effect.Effect<T, never, never> =>
                    Effect.promise(() =>
                        select({
                            message: "Select an option",
                            choices: items.map((item) => ({
                                name: item.label,
                                value: item.value,
                            })),
                        })
                    ),
            };
        }),
    }
) {}
