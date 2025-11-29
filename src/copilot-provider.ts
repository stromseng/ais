import { createOpenAI } from "@ai-sdk/openai";
import { Effect } from "effect";
import { Copilot, COPILOT_HEADERS, COPILOT_API_URL } from "./copilot";

/**
 * Creates an AI SDK compatible provider for GitHub Copilot.
 * Uses a custom fetch wrapper to inject dynamic auth tokens.
 */
export const createCopilotProvider = (copilot: Copilot) => {
    // Token promise for deduping concurrent requests
    let tokenPromise: Promise<string> | null = null;

    const getToken = async (): Promise<string> => {
        if (tokenPromise) return tokenPromise;

        tokenPromise = Effect.runPromise(copilot.getToken)
            .then((token) => {
                tokenPromise = null;
                return token;
            })
            .catch((err) => {
                tokenPromise = null;
                throw err;
            });

        return tokenPromise;
    };

    return createOpenAI({
        baseURL: COPILOT_API_URL,
        apiKey: "", // Empty - auth handled entirely in fetch wrapper
        // Don't pass headers here - handle everything in fetch to avoid conflicts
        fetch: (async (url, options) => {
            const token = await getToken();

            // Determine if this is an agent call or user call
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

            // Remove conflicting headers that AI SDK may have added
            delete headers["x-api-key"];
            delete headers["authorization"]; // lowercase version

            return fetch(url, {
                ...options,
                headers,
            });
        }) as typeof fetch,
    });
};

export type CopilotProvider = ReturnType<typeof createCopilotProvider>;
