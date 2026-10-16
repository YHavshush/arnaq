/**
 * The language model behind smart categorising is a provider: something that, given shop names and
 * the person's categories, says which category each shop belongs to. The rest of the code only knows
 * this interface, so the model can come from our own Claude API, later from the person's own ChatGPT
 * plan, or be a fake in tests.
 *
 * Nothing real leaves the app through here: items carry only a shop name and a scrubbed description
 * (see scrub.ts), and everything is referred to by opaque refs ("m1", "c3"), never database ids.
 */

export interface ClassifyItem {
  /** Opaque per request: "m1", "m2", ... */
  ref: string;
  /** The shop's merchant key (a short name, no numbers). */
  merchant: string;
  /** A short description with anything that identifies a person or an account removed; may be empty. */
  description: string;
}

export interface CategoryOption {
  /** Opaque per request: "c1", "c2", ... */
  ref: string;
  /** What the category is called to the person. */
  label: string;
}

export interface ClassifyAnswer {
  ref: string;
  /** A category ref from the options, or null to abstain. */
  category: string | null;
  /** Why the model is answering: it knows this shop, it is guessing from the words, or it has no idea. */
  basis: "known_merchant" | "words" | "none";
}

export interface ClassifyRequest {
  items: ClassifyItem[];
  options: CategoryOption[];
  signal: AbortSignal;
}

export interface ClassifyResult {
  answers: ClassifyAnswer[];
  usage?: { input: number; output: number };
}

export interface CategoriserProvider {
  readonly id: "claude" | "chatgpt-plan" | "fake";
  classify(request: ClassifyRequest): Promise<ClassifyResult>;
}

/** The provider cannot be used right now (not available for this account, no key, ...). */
export class ProviderUnavailable extends Error {}

/** Items per request: keeps answers short and a bad answer cheap. */
export const MAX_ITEMS_PER_CALL = 25;
