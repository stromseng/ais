import { Effect, Schema, Data } from "effect";
import InkSelectInput from "ink-select-input";
import { render } from "ink";

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
                    Effect.async<T>((resume) => {
                        const SelectComponent = () => {
                            const handleSelect = (item: SelectItem<T>) => {
                                instance.clear();
                                instance.unmount();
                                resume(Effect.succeed(item.value));
                            };

                            return (
                                <InkSelectInput
                                    items={items}
                                    onSelect={handleSelect}
                                />
                            );
                        };

                        const instance = render(<SelectComponent />);
                    }),
            };
        }),
    }
) {}
