import { describe, expect, it } from "vitest";
import {
  FOR_YOU_FULL_PAGE_ITEMS_PER_PAGE,
  FOR_YOU_PREVIEW_ITEMS_PER_PAGE,
  dedupeForYouRecommendations,
  getForYouRecommendationsPageQueryKey,
  getSharedForYouInfiniteQueryOptions,
  selectForYouPreviewRecommendations,
} from "@/lib/recommendationQueries";

type RecommendationStub = {
  id: number;
  title: string;
};

const recommendation = (id: number): RecommendationStub => ({
  id,
  title: `Title ${id}`,
});

describe("for-you query consistency", () => {
  it("uses the same query key as the full page configuration", () => {
    const userId = "test-user";
    const sharedOptions = getSharedForYouInfiniteQueryOptions(userId);

    expect(sharedOptions.queryKey).toEqual(
      getForYouRecommendationsPageQueryKey(userId, FOR_YOU_FULL_PAGE_ITEMS_PER_PAGE)
    );
  });
});

describe("for-you preview selection", () => {
  it("deduplicates recommendations while preserving first-seen order", () => {
    const raw = [recommendation(1), recommendation(2), recommendation(1), recommendation(3), recommendation(2)];

    const deduplicated = dedupeForYouRecommendations(raw);

    expect(deduplicated.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it("keeps home preview aligned with the first items shown on full for-you list", () => {
    const withDuplicates = [
      recommendation(1),
      recommendation(2),
      recommendation(2),
      recommendation(3),
      ...Array.from({ length: 40 }, (_, index) => recommendation(index + 4)),
    ];

    const fullPageResults = dedupeForYouRecommendations(withDuplicates);
    const homePreview = selectForYouPreviewRecommendations(withDuplicates);

    expect(homePreview).toHaveLength(FOR_YOU_PREVIEW_ITEMS_PER_PAGE);
    expect(homePreview).toEqual(fullPageResults.slice(0, FOR_YOU_PREVIEW_ITEMS_PER_PAGE));
  });

  it("returns all available recommendations when below preview limit", () => {
    const fewerThanPreview = [recommendation(7), recommendation(8), recommendation(8)];

    const homePreview = selectForYouPreviewRecommendations(fewerThanPreview);

    expect(homePreview).toEqual([recommendation(7), recommendation(8)]);
  });
});
