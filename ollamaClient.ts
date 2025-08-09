import OpenAI from 'openai';

export const OLLAMA_BASE_URL = 'http://localhost:11434/v1/';
export const OLLAMA_API_KEY = 'ollama';
export const DEFAULT_OLLAMA_MODEL = 'gpt-oss:20b';

let cachedClient: OpenAI | null = null;

export type OllamaClientOptions = {
	baseURL?: string;
	apiKey?: string;
};

export function getOllamaClient(options?: OllamaClientOptions): OpenAI {
	if (cachedClient) return cachedClient;

	cachedClient = new OpenAI({
		baseURL: options?.baseURL ?? OLLAMA_BASE_URL,
		apiKey: options?.apiKey ?? OLLAMA_API_KEY,
		dangerouslyAllowBrowser: true,
	});

	return cachedClient;
}

export function getDefaultModel(): string {
  return DEFAULT_OLLAMA_MODEL;
}

export default getOllamaClient;
