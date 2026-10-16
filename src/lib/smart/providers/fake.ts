import type { CategoriserProvider, ClassifyRequest, ClassifyResult } from "../provider";

type Script = (request: ClassifyRequest) => ClassifyResult | Promise<ClassifyResult>;

/**
 * A provider for tests: answers from a function, can be told to fail in the ways a real one does
 * (time out, return nonsense), and remembers what it was asked so tests can check what was sent.
 */
export class FakeProvider implements CategoriserProvider {
  readonly id = "fake" as const;
  readonly requests: ClassifyRequest[] = [];
  constructor(private readonly script: Script = () => ({ answers: [] })) {}

  async classify(request: ClassifyRequest): Promise<ClassifyResult> {
    this.requests.push(request);
    return await this.script(request);
  }

  /** Answers by merchant key: `{ "spar city": "Boodschappen" }` picks the option with that label. */
  static byMerchant(
    map: Record<string, string | null>,
    basis: "known_merchant" | "words" | "none" = "known_merchant",
  ): FakeProvider {
    return new FakeProvider((request) => ({
      answers: request.items.map((item) => {
        const label = map[item.merchant];
        const option = label ? request.options.find((o) => o.label === label) : undefined;
        return { ref: item.ref, category: option?.ref ?? null, basis: option ? basis : "none" };
      }),
      usage: { input: request.items.length * 20, output: request.items.length * 10 },
    }));
  }

  /** Never answers until the request is aborted (a timeout). */
  static hanging(): FakeProvider {
    return new FakeProvider(
      (request) =>
        new Promise((_resolve, reject) =>
          request.signal.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
  }

  /** Returns whatever it is given, for testing validation. */
  static returning(answers: unknown): FakeProvider {
    return new FakeProvider(() => ({ answers: answers as ClassifyResult["answers"] }));
  }
}
