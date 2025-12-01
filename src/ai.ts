import {
    Effect,
    Context,
    Layer,
    Schema,
    JSONSchema,
    ParseResult,
} from "effect";
import { createOpenAI } from "@ai-sdk/openai";
import {
    generateText as aiGenerateText,
    generateObject as aiGenerateObject,
    jsonSchema,
} from "ai";
import { CopilotAuth, COPILOT_HEADERS, COPILOT_API_URL } from "./copilotAuth";
import { MODEL_STRINGS } from "./utils";

// Model key types
type FreeModelKey = keyof typeof MODEL_STRINGS.free;
type PaidModelKey = keyof typeof MODEL_STRINGS.paid;
export type ModelKey = FreeModelKey | PaidModelKey;

// Resolve model key to model string
const resolveModel = (key: ModelKey): string => {
    if (key in MODEL_STRINGS.free) {
        return MODEL_STRINGS.free[key as FreeModelKey];
    }
    return MODEL_STRINGS.paid[key as PaidModelKey];
};

// Create OpenAI provider with token
const createProviderWithToken = (token: string) =>
    createOpenAI({
        baseURL: COPILOT_API_URL,
        apiKey: "",
        fetch: (async (url, options) => {
            let isAgentCall = false;
            try {
                const body =
                    typeof options?.body === "string"
                        ? JSON.parse(options.body)
                        : options?.body;

                if (body?.messages) {
                    isAgentCall = body.messages.some(
                        (msg: { role?: string }) =>
                            msg.role && ["tool", "assistant"].includes(msg.role)
                    );
                }
            } catch {
                // Ignore parse errors
            }

            const headers: Record<string, string> = {
                ...(options?.headers as Record<string, string>),
                ...COPILOT_HEADERS,
                Authorization: `Bearer ${token}`,
                "Openai-Intent": "conversation-edits",
                "X-Initiator": isAgentCall ? "agent" : "user",
            };

            delete headers["x-api-key"];
            delete headers["authorization"];

            return fetch(url, {
                ...options,
                headers,
            });
        }) as typeof fetch,
    });

// Token error type from CopilotAuth
type TokenError = Effect.Effect.Error<CopilotAuth["getToken"]>;

// AI service interface
export interface AIService {
    readonly generateText: (
        prompt: string
    ) => Effect.Effect<string, TokenError>;
    readonly generateObject: <A, I>(
        prompt: string,
        schema: Schema.Schema<A, I>,
        options?: { system?: string; schemaName?: string }
    ) => Effect.Effect<A, TokenError | ParseResult.ParseError>;
}

// AI tag
export class AI extends Context.Tag("ais/AI")<AI, AIService>() {}

// Models that don't support Responses API
const CHAT_ONLY_MODELS: ModelKey[] = ["gpt4o"];

// AI layer factory
export const make = (modelKey: ModelKey): Layer.Layer<AI, never, CopilotAuth> =>
    Layer.effect(
        AI,
        Effect.gen(function* () {
            const copilotAuth = yield* CopilotAuth;
            const modelString = resolveModel(modelKey);
            const useChatApi = CHAT_ONLY_MODELS.includes(modelKey);

            const getModel = (
                provider: ReturnType<typeof createProviderWithToken>
            ) =>
                useChatApi
                    ? provider.chat(modelString)
                    : provider.responses(modelString);

            return {
                generateText: (prompt: string) =>
                    Effect.gen(function* () {
                        const token = yield* copilotAuth.getToken;
                        const provider = createProviderWithToken(token);
                        const result = yield* Effect.promise(() =>
                            aiGenerateText({
                                model: getModel(provider),
                                prompt,
                            })
                        );
                        return result.text;
                    }),

                generateObject: <A, I>(
                    prompt: string,
                    schema: Schema.Schema<A, I>,
                    options?: { system?: string; schemaName?: string }
                ) =>
                    Effect.gen(function* () {
                        const token = yield* copilotAuth.getToken;
                        const provider = createProviderWithToken(token);
                        const result = yield* Effect.promise(() =>
                            aiGenerateObject({
                                model: getModel(provider),
                                schema: jsonSchema(JSONSchema.make(schema)),
                                schemaName: options?.schemaName,
                                prompt,
                                system: options?.system,
                            })
                        );
                        return yield* Schema.decodeUnknown(schema)(
                            result.object
                        );
                    }),
            };
        })
    );

// Default AI layer using gpt51
export const Default = make("gpt51").pipe(Layer.provide(CopilotAuth.Default));
